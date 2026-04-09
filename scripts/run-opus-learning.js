#!/usr/bin/env node
/**
 * Run Opus4.5 learning pipeline and apply suggested weight changes.
 *
 * Two modes:
 *   --retro (default): Uses HISTORICAL retrospective backtest - looks back in time to find
 *     when signals would have triggered, measures outcomes, learns weights. No saved snapshots needed.
 *   (no --retro): Uses prospective backtest - requires a scan snapshot 30+ days old.
 *
 * Prerequisites:
 * - Server running (npm run dev or npm run server)
 * - For retro: tickers from scan or data/tickers.txt
 * - For prospective: at least one scan snapshot 30+ days old
 *
 * Usage:
 *   node scripts/run-opus-learning.js              # Retro (default): historic signals → learn → apply
 *   node scripts/run-opus-learning.js --retro      # Same as default
 *   node scripts/run-opus-learning.js --dry-run    # Run learning, do NOT apply
 *   node scripts/run-opus-learning.js --retro --lookback=18  # 18 months lookback (default 12)
 *   node scripts/run-opus-learning.js --retro --hold=90      # 90-day hold (default 60)
 *   node scripts/run-opus-learning.js --prospective          # Use saved snapshot (needs 30+ days old)
 *   node scripts/run-opus-learning.js --scan=2025-01-15      # Use specific scan date (prospective)
 *   node scripts/run-opus-learning.js --days=60              # 60-day forward (prospective)
 *
 * API base: http://localhost:5174 (dev) or http://localhost:3001 (server)
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { listScanSnapshots } from '../server/backtest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const API_BASE = process.env.API_BASE || 'http://localhost:5174';

async function fetchJson(url, options = {}) {
  const { timeout: timeoutMs = 0, ...fetchOptions } = options;
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timeoutId =
    controller && timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

  try {
    const res = await fetch(url, {
      ...fetchOptions,
      signal: controller?.signal,
      headers: { 'Content-Type': 'application/json', ...fetchOptions.headers },
    });
    if (timeoutId) clearTimeout(timeoutId);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.message || res.statusText);
    return data;
  } catch (e) {
    if (timeoutId) clearTimeout(timeoutId);
    if (e.name === 'AbortError') throw new Error('Request Timeout');
    throw e;
  }
}

async function runRetroLearning(dryRun, lookbackMonths, holdingPeriod, topN) {
  console.log(`   Mode: RETROSPECTIVE (${lookbackMonths}mo lookback, ${holdingPeriod}d hold, top ${topN} tickers)`);
  console.log('   This may take several minutes (fetches bars for each ticker)...\n');

  const result = await fetchJson(
    `${API_BASE}/api/opus45/learning/run-retro`,
    {
      method: 'POST',
      body: JSON.stringify({
        lookbackMonths,
        holdingPeriod,
        topN,
        autoApply: !dryRun,
      }),
      timeout: 600000, // 10 minutes for retro backtest (fetches bars per ticker)
    }
  );

  return result;
}

async function runProspectiveLearning(dryRun, scanDate, daysForward, topN) {
  const snapshots = await listScanSnapshots();
  if (!snapshots?.length) {
    throw new Error('No scan snapshots. Run a scan first, or use --retro for historic learning.');
  }

  const today = new Date();
  const eligible = snapshots.filter((s) => {
    const d = new Date(s.date);
    const daysAgo = Math.floor((today - d) / (1000 * 60 * 60 * 24));
    return daysAgo >= daysForward;
  });

  let targetScanDate = scanDate;
  if (!targetScanDate) {
    if (eligible.length === 0) {
      throw new Error(`No snapshots ${daysForward}+ days old. Use --retro or run --days=7 for newer snapshots.`);
    }
    targetScanDate = eligible[0].date;
    console.log(`   Using snapshot: ${targetScanDate} (${eligible[0].tickerCount} tickers)`);
  } else {
    const found = snapshots.find((s) => s.date === targetScanDate);
    if (!found) throw new Error(`Snapshot not found: ${targetScanDate}`);
    const daysAgo = Math.floor((today - new Date(targetScanDate)) / (1000 * 60 * 60 * 24));
    if (daysAgo < daysForward) throw new Error(`Snapshot only ${daysAgo} days old. Need ${daysForward}+.`);
  }

  return fetchJson(`${API_BASE}/api/opus45/learning/run`, {
    method: 'POST',
    body: JSON.stringify({
      scanDate: targetScanDate,
      daysForward,
      topN,
      autoApply: !dryRun,
    }),
  });
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const useRetro = args.includes('--retro') || !args.includes('--prospective');
  const scanArg = args.find((a) => a.startsWith('--scan='));
  const daysArg = args.find((a) => a.startsWith('--days='));
  const lookbackArg = args.find((a) => a.startsWith('--lookback='));
  const holdArg = args.find((a) => a.startsWith('--hold='));
  const topNArg = args.find((a) => a.startsWith('--top='));

  const scanDate = scanArg ? scanArg.split('=')[1] : null;
  const daysForward = daysArg ? parseInt(daysArg.split('=')[1], 10) : 30;
  const lookbackMonths = lookbackArg ? parseInt(lookbackArg.split('=')[1], 10) : 12;
  const holdingPeriod = holdArg ? parseInt(holdArg.split('=')[1], 10) : 60;
  const topN = topNArg ? parseInt(topNArg.split('=')[1], 10) : 100;

  console.log('\n🧠 Opus4.5 Learning Pipeline\n');
  console.log(`   API: ${API_BASE}`);
  console.log(`   Mode: ${dryRun ? 'DRY RUN (no apply)' : 'Run + Apply if confident'}`);
  console.log(`   Source: ${useRetro ? 'Retrospective (historic signals)' : 'Prospective (saved snapshot)'}\n`);

  try {
    let result;
    if (useRetro) {
      result = await runRetroLearning(dryRun, lookbackMonths, holdingPeriod, topN);
    } else {
      result = await runProspectiveLearning(dryRun, scanDate, daysForward, topN);
    }

    if (result.error) {
      console.error('❌', result.error, result.message || '');
      if (result.retro) console.log('   Retro summary:', result.retro.summary);
      process.exit(1);
    }

    const { backtest, retro, learning } = result;

    // 3. Print backtest summary
    if (retro) {
      const s = retro.summary || {};
      console.log('📊 Retrospective Backtest Summary');
      console.log(`   Signals found: ${retro.signalsFound || 0}`);
      console.log(`   Win rate: ${s.winRate ?? '?'}%`);
      console.log(`   Avg return: ${s.avgReturn ?? '?'}%`);
      console.log(`   Avg hold: ${s.avgHoldTime ?? '?'} days`);
      console.log('');
    } else if (backtest) {
      console.log('📊 Backtest Summary');
      console.log('   Strategy: 10 MA exit');
      for (const [bucket, stats] of Object.entries(backtest)) {
        if (stats && typeof stats === 'object' && stats.count > 0) {
          console.log(`   ${bucket}: ${stats.count} trades, ${stats.winRate}% win rate`);
        }
      }
      console.log('');
    }

    // 4. Print learning results
    if (learning?.error) {
      console.error('❌ Learning:', learning.error, learning.message || '');
      process.exit(1);
    }

    console.log('📈 Factor Analysis');
    console.log(`   Trades analyzed: ${learning.totalTrades}`);
    console.log(`   Overall win rate: ${learning.overallWinRate}%`);
    if (learning.factorAnalysis?.topPositive?.length) {
      console.log('   Top positive factors:');
      learning.factorAnalysis.topPositive.slice(0, 3).forEach((f) => {
        console.log(`     - ${f.factor}: +${f.winRateLift}% win rate lift`);
      });
    }
    if (learning.factorAnalysis?.topNegative?.length) {
      console.log('   Top negative factors:');
      learning.factorAnalysis.topNegative.slice(0, 2).forEach((f) => {
        console.log(`     - ${f.factor}: ${f.winRateLift}% drag`);
      });
    }
    console.log('');

    // 5. Weight adjustments
    const adj = learning.weightAdjustments;
    if (adj?.adjustments?.length) {
      console.log('⚖️ Weight Adjustments');
      adj.adjustments.forEach((a) => {
        const dir = a.suggestedChange > 0 ? '↑' : '↓';
        console.log(`   ${dir} ${a.weightKey}: ${a.currentWeight} → ${a.newWeight} (${a.reason})`);
      });
      console.log('');

      if (learning.applied) {
        console.log('✅ Weights applied successfully.');
      } else if (dryRun) {
        console.log('   (Dry run: weights NOT applied. Run without --dry-run to apply.)');
      } else {
        console.log('   (Not auto-applied: need 2+ high-confidence adjustments and >50% win rate.)');
        console.log('   To apply manually: POST /api/opus45/learning/apply-weights with newWeights from report.');
      }
    } else {
      console.log('   No weight adjustments suggested.');
    }

    // 6. Report location
    const reportName = useRetro ? 'retro' : (scanDate || 'snapshot');
    console.log('\n📄 Full report: data/opus45-learning/report-' + reportName + '.json\n');
  } catch (e) {
    console.error('❌', e.message);
    if (e.message?.includes('fetch')) {
      console.error('   Is the server running? Try: npm run dev');
    }
    process.exit(1);
  }
}

main();
