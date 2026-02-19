#!/usr/bin/env node
/**
 * Import all flat JSON data into Supabase tables.
 * Run after schema migration. Requires SUPABASE_URL + SUPABASE_SERVICE_KEY in .env.
 *
 * Usage: npm run import:supabase
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSupabase, isSupabaseConfigured } from '../server/supabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const BARS_DIR = path.join(DATA_DIR, 'bars');
const BACKTEST_DIR = path.join(DATA_DIR, 'backtests');
const REGIME_DIR = path.join(DATA_DIR, 'regime');
const OPUS45_LEARNING_DIR = path.join(DATA_DIR, 'opus45-learning');
const ADAPTIVE_STRATEGY_DIR = path.join(DATA_DIR, 'adaptive-strategy');

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function readTickers() {
  const p = path.join(DATA_DIR, 'tickers.txt');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split(/\r?\n/).map((s) => s.trim().toUpperCase()).filter(Boolean);
}

async function main() {
  dotenv.config({ path: path.join(ROOT, '.env') });
  if (!isSupabaseConfigured()) {
    console.error('Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env');
    process.exit(1);
  }
  const supabase = getSupabase();
  const stats = {};

  // 1. Tickers
  const tickers = readTickers();
  if (tickers.length > 0) {
    const rows = tickers.map((t) => ({ ticker: t }));
    const { error } = await supabase.from('tickers').upsert(rows, { onConflict: 'ticker' });
    if (error) console.error('tickers:', error.message);
    else {
      stats.tickers = tickers.length;
      console.log('Tickers:', tickers.length);
    }
  } else console.log('Tickers: skipped (no data)');

  // 2. Fundamentals
  const fund = readJson(path.join(DATA_DIR, 'fundamentals.json'));
  if (fund && typeof fund === 'object') {
    const rows = Object.entries(fund).map(([ticker, v]) => ({
      ticker,
      pct_held_by_inst: v?.pctHeldByInst ?? null,
      qtr_earnings_yoy: v?.qtrEarningsYoY ?? null,
      profit_margin: v?.profitMargin ?? null,
      operating_margin: v?.operatingMargin ?? null,
      industry: v?.industry ?? null,
      sector: v?.sector ?? null,
      company_name: v?.companyName ?? null,
      fetched_at: v?.fetchedAt ?? null,
      raw: v ?? null,
    }));
    if (rows.length > 0) {
      const { error } = await supabase.from('fundamentals').upsert(rows, { onConflict: 'ticker' });
      if (error) console.error('fundamentals:', error.message);
      else {
        stats.fundamentals = rows.length;
        console.log('Fundamentals:', rows.length);
      }
    }
  } else console.log('Fundamentals: skipped');

  // 3. Industry Yahoo returns
  const iyr = readJson(path.join(DATA_DIR, 'industry-yahoo-returns.json'));
  if (iyr && typeof iyr === 'object') {
    const rows = Object.entries(iyr).map(([industry_name, v]) => ({
      industry_name,
      return_1y: v?.return1Y ?? v?.return_1y ?? null,
      return_3m: v?.return3M ?? v?.return_3m ?? null,
      return_ytd: v?.returnYTD ?? v?.return_ytd ?? null,
      data: v ?? null,
    }));
    if (rows.length > 0) {
      const { error } = await supabase.from('industry_yahoo_returns').upsert(rows, { onConflict: 'industry_name' });
      if (error) console.error('industry_yahoo_returns:', error.message);
      else {
        stats.industry_yahoo_returns = rows.length;
        console.log('Industry Yahoo returns:', rows.length);
      }
    }
  } else console.log('Industry Yahoo returns: skipped');

  // 4. Industry cache (industrials, all-industries, sectors)
  for (const key of ['industrials', 'all-industries', 'sectors']) {
    const file = key === 'industrials' ? 'industrials.json' : key === 'all-industries' ? 'all-industries.json' : 'sectors.json';
    const data = readJson(path.join(DATA_DIR, file));
    if (data) {
      const fetchedAt = data.fetchedAt ?? null;
      const { error } = await supabase.from('industry_cache').upsert(
        { key, data, fetched_at: fetchedAt, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );
      if (error) console.error(`industry_cache ${key}:`, error.message);
      else {
        stats[`industry_cache.${key}`] = 1;
        console.log(`Industry cache ${key}: upserted`);
      }
    }
  }

  // 5. Scan runs + scan results
  const scanData = readJson(path.join(DATA_DIR, 'scan-results.json'));
  if (scanData && Array.isArray(scanData.results) && scanData.results.length > 0) {
    const { data: runRow, error: runErr } = await supabase
      .from('scan_runs')
      .insert({
        scanned_at: scanData.scannedAt ?? new Date().toISOString(),
        date_from: scanData.from ?? null,
        date_to: scanData.to ?? null,
        total_tickers: scanData.totalTickers ?? scanData.results.length,
        vcp_bullish_count: scanData.vcpBullishCount ?? 0,
      })
      .select('id')
      .single();
    if (runErr) {
      console.error('scan_runs:', runErr.message);
    } else {
      const runId = runRow.id;
      const results = scanData.results.map((r) => ({
        scan_run_id: runId,
        ticker: r.ticker,
        vcp_bullish: r.vcpBullish ?? null,
        contractions: r.contractions ?? null,
        last_close: r.lastClose ?? null,
        relative_strength: r.relativeStrength ?? null,
        score: r.score ?? null,
        enhanced_score: r.enhancedScore ?? r.score ?? null,
        industry_name: r.industryName ?? null,
        industry_rank: r.industryRank ?? null,
        data: r,
      }));
      const batchSize = 500;
      for (let i = 0; i < results.length; i += batchSize) {
        const batch = results.slice(i, i + batchSize);
        const { error } = await supabase.from('scan_results').insert(batch);
        if (error) console.error('scan_results batch:', error.message);
      }
      stats.scan_runs = 1;
      stats.scan_results = results.length;
      console.log('Scan runs: 1, scan results:', results.length);
    }
  } else console.log('Scan results: skipped');

  // 6. Bars cache
  if (fs.existsSync(BARS_DIR)) {
    const files = fs.readdirSync(BARS_DIR).filter((f) => f.endsWith('.json'));
    let barsCount = 0;
    for (const f of files) {
      const raw = readJson(path.join(BARS_DIR, f));
      if (!raw || !raw.results) continue;
      const m = f.match(/^(.+?)(?:_(1d|1w))?\.json$/);
      const base = m ? m[1] : f.replace('.json', '');
      const interval = m?.[2] || '1d';
      const ticker = raw.ticker || base;
      const row = {
        ticker,
        interval,
        date_from: raw.from,
        date_to: raw.to,
        fetched_at: raw.fetchedAt ?? new Date().toISOString(),
        results: raw.results,
      };
      const { error } = await supabase.from('bars_cache').upsert(row, { onConflict: 'ticker,interval' });
      if (!error) barsCount++;
    }
    stats.bars_cache = barsCount;
    console.log('Bars cache:', barsCount, 'files');
  } else console.log('Bars cache: skipped');

  // 7. Opus45 signals
  const opusData = readJson(path.join(DATA_DIR, 'opus45-signals.json'));
  if (opusData && (opusData.signals || opusData.computedAt)) {
    const { error } = await supabase.from('opus45_signals_cache').insert({
      computed_at: opusData.computedAt ?? new Date().toISOString(),
      signals: opusData.signals ?? [],
      stats: opusData.stats ?? null,
      total: opusData.total ?? (opusData.signals?.length ?? 0),
    });
    if (error) console.error('opus45_signals_cache:', error.message);
    else {
      stats.opus45_signals = 1;
      console.log('Opus45 signals: inserted');
    }
  } else console.log('Opus45 signals: skipped');

  // 8. Trades
  const tradesData = readJson(path.join(DATA_DIR, 'trades.json'));
  if (tradesData && Array.isArray(tradesData.trades) && tradesData.trades.length > 0) {
    const rows = tradesData.trades.map((t) => ({
      id: t.id,
      ticker: t.ticker,
      company_name: t.companyName ?? null,
      entry_date: t.entryDate ?? null,
      entry_price: t.entryPrice,
      entry_metrics: t.entryMetrics ?? null,
      conviction: t.conviction ?? null,
      notes: t.notes ?? null,
      exit_date: t.exitDate ?? null,
      exit_price: t.exitPrice ?? null,
      exit_type: t.exitType ?? null,
      exit_notes: t.exitNotes ?? null,
      status: t.status ?? 'open',
      return_pct: t.returnPct ?? null,
      holding_days: t.holdingDays ?? null,
      stop_loss_price: t.stopLossPrice ?? null,
      target_price: t.targetPrice ?? null,
      last_checked_date: t.lastCheckedDate ?? null,
      created_at: t.createdAt ?? null,
      updated_at: t.updatedAt ?? null,
    }));
    const { error } = await supabase.from('trades').upsert(rows, { onConflict: 'id' });
    if (error) console.error('trades:', error.message);
    else {
      stats.trades = rows.length;
      console.log('Trades:', rows.length);
    }
    if (tradesData.stats) {
      await supabase.from('trade_stats').insert({
        total_trades: tradesData.stats.totalTrades ?? 0,
        open_trades: tradesData.stats.openTrades ?? 0,
        closed_trades: tradesData.stats.closedTrades ?? 0,
        win_rate: tradesData.stats.winRate ?? null,
        avg_return: tradesData.stats.avgReturn ?? null,
        avg_win: tradesData.stats.avgWin ?? null,
        avg_loss: tradesData.stats.avgLoss ?? null,
        stats_json: tradesData.stats,
        last_updated: tradesData.lastUpdated ?? new Date().toISOString(),
      });
    }
  } else console.log('Trades: skipped');

  // 9. Backtest snapshots
  if (fs.existsSync(BACKTEST_DIR)) {
    const scanFiles = fs.readdirSync(BACKTEST_DIR).filter((f) => f.startsWith('scan-') && f.endsWith('.json'));
    for (const f of scanFiles) {
      const snap = readJson(path.join(BACKTEST_DIR, f));
      if (!snap) continue;
      const scanDate = snap.scanDate ?? f.replace('scan-', '').replace('.json', '');
      const { error } = await supabase.from('backtest_snapshots').upsert(
        {
          scan_date: scanDate,
          scan_time: snap.scanTime ?? null,
          ticker_count: snap.tickerCount ?? 0,
          tickers: snap.tickers ?? [],
        },
        { onConflict: 'scan_date' }
      );
      if (!error) stats.backtest_snapshots = (stats.backtest_snapshots || 0) + 1;
    }
    const btFiles = fs.readdirSync(BACKTEST_DIR).filter((f) => f.startsWith('backtest-') && f.endsWith('.json'));
    for (const f of btFiles) {
      const bt = readJson(path.join(BACKTEST_DIR, f));
      if (!bt) continue;
      const m = f.match(/backtest-(\d{4}-\d{2}-\d{2})-(\d+)d/);
      const scanDate = m ? m[1] : bt.scanDate ?? '2025-01-01';
      const holdingDays = m ? parseInt(m[2], 10) : bt.daysForward ?? 30;
      const { error } = await supabase.from('backtest_results').upsert(
        { scan_date: scanDate, holding_days: holdingDays, result: bt },
        { onConflict: 'scan_date,holding_days' }
      );
      if (!error) stats.backtest_results = (stats.backtest_results || 0) + 1;
    }
    if (stats.backtest_snapshots || stats.backtest_results) {
      console.log('Backtest snapshots:', stats.backtest_snapshots || 0, ', results:', stats.backtest_results || 0);
    }
  }

  // 10. Regime
  if (fs.existsSync(REGIME_DIR)) {
    for (const ticker of ['spy', 'qqq']) {
      const raw = readJson(path.join(REGIME_DIR, `${ticker}_5y.json`));
      if (raw) {
        await supabase.from('regime_bars').upsert(
          {
            ticker: ticker.toUpperCase(),
            date_from: raw.from ?? null,
            date_to: raw.to ?? null,
            fetched_at: raw.fetchedAt ?? null,
            results: raw.results ?? [],
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'ticker' }
        );
        stats.regime_bars = (stats.regime_bars || 0) + 1;
      }
    }
    for (const ticker of ['spy', 'qqq']) {
      for (const [table, file] of [
        ['regime_models', `model_${ticker}.json`],
        ['regime_current', `current_${ticker}.json`],
        ['regime_backtest', `backtest_${ticker}.json`],
      ]) {
        const raw = readJson(path.join(REGIME_DIR, file));
        if (raw) {
          const tUpper = ticker.toUpperCase();
          if (table === 'regime_models') {
            await supabase.from(table).upsert({ ticker: tUpper, model_json: raw, trained_at: raw.trainedAt ?? null, updated_at: new Date().toISOString() }, { onConflict: 'ticker' });
          } else if (table === 'regime_current') {
            await supabase.from(table).upsert(
              {
                ticker: tUpper,
                state_labels: raw.state_labels ?? null,
                predictions: raw.predictions ?? null,
                current_state: raw.current_state ?? raw.currentState ?? null,
                state_to_label: raw.state_to_label ?? raw.stateToLabel ?? null,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'ticker' }
            );
          } else {
            await supabase.from(table).upsert({ ticker: tUpper, backtest_json: raw, updated_at: new Date().toISOString() }, { onConflict: 'ticker' });
          }
          stats[table] = (stats[table] || 0) + 1;
        }
      }
    }
    if (stats.regime_bars || stats.regime_models || stats.regime_current || stats.regime_backtest) {
      console.log('Regime data: imported');
    }
  }

  // 11. Opus45 weights
  const ow = readJson(path.join(OPUS45_LEARNING_DIR, 'optimized-weights.json'));
  if (ow) {
    await supabase.from('opus45_weights').upsert(
      {
        id: 'default',
        weights: ow.weights ?? ow,
        last_optimized: ow.lastOptimized ?? ow.last_optimized ?? null,
        based_on_trades: ow.basedOnTrades ?? ow.based_on_trades ?? null,
        overall_win_rate: ow.overallWinRate ?? ow.overall_win_rate ?? null,
        improvements: ow.improvements ?? null,
        version: ow.version ?? 1,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );
    stats.opus45_weights = 1;
    console.log('Opus45 weights: upserted');
  }

  // 12. Adaptive strategy
  const asp = readJson(path.join(ADAPTIVE_STRATEGY_DIR, 'learned-params.json'));
  if (asp) {
    await supabase.from('adaptive_strategy_params').upsert(
      { id: 'default', params: asp, updated_at: new Date().toISOString() },
      { onConflict: 'id' }
    );
    stats.adaptive_strategy_params = 1;
    console.log('Adaptive strategy params: upserted');
  }

  console.log('\nImport complete.', stats);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
