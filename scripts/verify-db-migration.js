#!/usr/bin/env node
/**
 * Verify Supabase DB migration.
 * Queries each migrated table for counts, validates latest scan structure,
 * and checks fundamentals/tickers/trades for expected data.
 *
 * Usage: node scripts/verify-db-migration.js
 * Requires: SUPABASE_URL and SUPABASE_SERVICE_KEY in .env
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSupabase, isSupabaseConfigured } from '../server/supabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

async function getCount(supabase, table) {
  const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
  if (error) return { error: error.message };
  return { count };
}

async function main() {
  dotenv.config({ path: path.join(ROOT, '.env') });
  if (!isSupabaseConfigured()) {
    console.error('Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env');
    process.exit(1);
  }

  const supabase = getSupabase();
  const tables = [
    'tickers',
    'fundamentals',
    'industry_yahoo_returns',
    'industry_cache',
    'scan_runs',
    'scan_results',
    'bars_cache',
    'opus45_signals_cache',
    'trades',
    'trade_stats',
    'backtest_snapshots',
    'backtest_results',
    'regime_bars',
    'regime_models',
    'regime_current',
    'regime_backtest',
    'opus45_weights',
    'adaptive_strategy_params',
  ];

  console.log('\n=== DB Migration Verification ===\n');
  console.log('Table row counts:');
  console.log('-'.repeat(40));

  let hasErrors = false;
  const counts = {};

  for (const table of tables) {
    const result = await getCount(supabase, table);
    if (result.error) {
      console.log(`  ${table}: ERROR - ${result.error}`);
      hasErrors = true;
    } else {
      counts[table] = result.count ?? 0;
      console.log(`  ${table}: ${counts[table]}`);
    }
  }

  // Validate latest scan structure (expected API shape)
  console.log('\n--- Latest scan structure check ---');
  const { data: run, error: runErr } = await supabase
    .from('scan_runs')
    .select('*')
    .order('scanned_at', { ascending: false })
    .limit(1)
    .single();

  if (runErr || !run) {
    console.log('  No scan runs found (OK if no scan has been run yet)');
  } else {
    const { data: results, error: resErr } = await supabase
      .from('scan_results')
      .select('data')
      .eq('scan_run_id', run.id)
      .order('enhanced_score', { ascending: false, nullsFirst: false })
      .limit(5);

    if (resErr) {
      console.log('  scan_results fetch error:', resErr.message);
      hasErrors = true;
    } else if (results && results.length > 0) {
      const sample = results[0].data;
      const expectedFields = ['ticker', 'vcpBullish', 'score', 'enhancedScore', 'enhancedGrade'];
      const missing = expectedFields.filter((f) => !(f in (sample || {})));
      if (missing.length > 0) {
        console.log('  WARNING: Sample result missing fields:', missing.join(', '));
      } else {
        console.log('  Scan structure OK: run + results with expected fields (ticker, vcpBullish, score, etc.)');
      }
      console.log(`  Latest scan: ${run.scanned_at}, ${results.length}+ results`);
    }
  }

  // Assert non-empty where files typically had data
  console.log('\n--- Data presence checks ---');
  if (counts.tickers === 0) console.log('  WARNING: tickers is empty (run populate-tickers or import first)');
  else console.log(`  tickers: ${counts.tickers} rows`);

  if (counts.fundamentals === 0) console.log('  NOTE: fundamentals is empty (optional; populated by fetch)');
  else console.log(`  fundamentals: ${counts.fundamentals} rows`);

  if (counts.trades === 0) console.log('  NOTE: trades is empty (no recorded trades yet)');
  else console.log(`  trades: ${counts.trades} rows`);

  if (counts['scan_results'] === 0) console.log('  NOTE: scan_results empty (run a scan first)');
  else console.log(`  scan_results: ${counts['scan_results']} rows`);

  console.log('\n=== Verification complete ===\n');
  process.exit(hasErrors ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
