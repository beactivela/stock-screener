/**
 * Auto-Populate Learning Database
 * 
 * This module automatically generates historical trades from Opus4.5 signals,
 * stores them in the learning database, runs cross-stock analysis, and
 * produces optimization recommendations for VCP setups.
 * 
 * NO MANUAL TRADE ENTRY REQUIRED.
 * 
 * Workflow:
 * 1. Get ticker universe (from DB or default list)
 * 2. Scan each ticker for past 5 years (60 months) of Opus4.5 signals
 * 3. Simulate each trade to exit (4% stop or 10 MA rule)
 * 4. Store full context + outcome in learning tables
 * 5. Run cross-stock pattern analysis
 * 6. Generate optimization recommendations
 * 7. Save analysis results for continuous learning
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scanMultipleTickers, getTickerList } from './historicalSignalScanner.js';
import { runCrossStockAnalysis, generateWeightRecommendations } from './crossStockAnalyzer.js';
import { getSupabase, isSupabaseConfigured } from '../supabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DEFAULT_SIGNAL_FAMILIES = ['opus45'];
const ALLOWED_SIGNAL_FAMILIES = new Set(['opus45', 'turtle']);

function ensureDataDir(dir) {
  if (process.env.VERCEL) return;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function resolveSignalsFile(opts = {}) {
  if (opts.signalsFile) return opts.signalsFile;
  const dataDir = opts.dataDir || DATA_DIR;
  return path.join(dataDir, 'historical_signals.json');
}

export function normalizeSignalFamilies(input) {
  if (!input) return [...DEFAULT_SIGNAL_FAMILIES];
  const raw = Array.isArray(input) ? input : [input];
  const normalized = [];
  for (const item of raw) {
    const value = String(item || '').trim();
    if (!value) continue;
    if (ALLOWED_SIGNAL_FAMILIES.has(value) && !normalized.includes(value)) {
      normalized.push(value);
    }
  }
  return normalized.length > 0 ? normalized : [...DEFAULT_SIGNAL_FAMILIES];
}

export function formatDiagnosticsSummary(diagnostics) {
  if (!diagnostics) return [];
  const lines = [];
  lines.push('🔍 DIAGNOSTICS (why signals may be missing):');
  lines.push(`   Tickers scanned: ${diagnostics.tickersScanned ?? 0}`);
  lines.push(`   Missing bars: ${diagnostics.barsMissing ?? 0}`);
  lines.push(`   Bars too short: ${diagnostics.barsTooShort ?? 0}`);
  if (diagnostics.turtle) {
    lines.push(`   Turtle checks: ${diagnostics.turtle.checks ?? 0}`);
    lines.push(`   Breakouts 20d: ${diagnostics.turtle.breakouts20 ?? 0}`);
    lines.push(`   Breakouts 55d: ${diagnostics.turtle.breakouts55 ?? 0}`);
    lines.push(`   No breakout: ${diagnostics.turtle.noBreakout ?? 0}`);
    lines.push(`   Turtle signals: ${diagnostics.turtle.signals ?? 0}`);
  }
  lines.push('');
  return lines;
}

export function storeSignalsToFile(signals = [], opts = {}) {
  try {
    if (process.env.VERCEL) return { stored: false, reason: 'vercel_read_only' };
    const dataDir = opts.dataDir || DATA_DIR;
    const filePath = resolveSignalsFile(opts);
    ensureDataDir(dataDir);
    const maxSignals = Number.isFinite(opts.maxSignals) ? Math.max(0, opts.maxSignals) : signals.length;
    const payload = {
      storedAt: new Date().toISOString(),
      total: signals.length,
      signals: Array.isArray(signals) ? signals.slice(0, maxSignals) : [],
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { stored: true, storage: 'file', filePath, count: payload.signals.length, total: payload.total };
  } catch (e) {
    return { stored: false, error: e.message };
  }
}

export function loadStoredSignalsFromFile(limit = 10000, opts = {}) {
  try {
    const filePath = resolveSignalsFile(opts);
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw || raw.trim() === '') return [];
    const parsed = JSON.parse(raw);
    const signals = Array.isArray(parsed) ? parsed : (parsed?.signals || []);
    return Array.isArray(signals) ? signals.slice(0, limit) : [];
  } catch {
    return [];
  }
}

/**
 * Store historical signals in learning database
 * 
 * @param {Array} signals - Signals from historical scanner
 * @returns {Promise<Object>} Insert statistics
 */
async function storeSignalsInDatabase(signals) {
  if (!isSupabaseConfigured()) {
    console.log('⚠️ Supabase not configured, storing signals locally');
    const local = storeSignalsToFile(signals);
    return { stored: local.count || 0, skipped: Math.max(0, signals.length - (local.count || 0)), storage: 'file', skipReason: 'no_supabase' };
  }
  
  const supabase = getSupabase();
  const BATCH_SIZE = 100;  // Supabase batch insert limit
  let stored = 0;
  let skipped = 0;
  
  // Prepare all records for batch insert
  const records = signals.map(signal => ({
    ticker: signal.ticker,
    entry_date: signal.entryDate,
    entry_price: signal.entryPrice,
    exit_date: signal.exitDate,
    exit_price: signal.exitPrice,
    return_pct: signal.returnPct,
    holding_days: signal.holdingDays,
    exit_type: signal.exitType,
    max_gain: signal.maxGain,
    max_drawdown: signal.maxDrawdown,
    opus45_confidence: signal.opus45Confidence,
    opus45_grade: signal.opus45Grade,
    signal_type: signal.signalType,
    pattern: signal.pattern,
    pattern_confidence: signal.patternConfidence,
    contractions: signal.contractions,
    source: 'historical_scan',
    // Store full context as JSONB so agents can rescore with different weights
    context: signal.context || null,
    scan_type: signal.scanType || 'deep_historical',
    lookback_months: signal.lookbackMonths || 60,
    exit_strategy_version: signal.exitStrategyVersion || 2,
  }));
  
  // Try batch insert into historical_trades table
  console.log(`📦 Batch inserting ${records.length} signals...`);
  
  try {
    // Insert in batches of BATCH_SIZE
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      
      const { error } = await supabase
        .from('historical_trades')
        .upsert(batch, { 
          onConflict: 'ticker,entry_date',
          ignoreDuplicates: true 
        });
      
      if (error) {
        // If table doesn't exist, skip storage entirely
        if (error.message.includes('does not exist')) {
          console.log('⚠️ historical_trades table not found. Run the migration SQL first.');
          console.log('   File: docs/supabase/migration-add-source-column.sql');
          return { stored: 0, skipped: signals.length, skipReason: 'table_not_found' };
        }
        
        // For other errors, log and continue
        console.warn(`Batch insert error (batch ${Math.floor(i/BATCH_SIZE) + 1}): ${error.message}`);
        skipped += batch.length;
      } else {
        stored += batch.length;
      }
      
      // Progress logging for large batches
      if (records.length > BATCH_SIZE && i % (BATCH_SIZE * 5) === 0 && i > 0) {
        console.log(`   Progress: ${i}/${records.length} records processed`);
      }
    }
    
    console.log(`✅ Stored ${stored} signals, skipped ${skipped}`);
    return { stored, skipped };
    
  } catch (e) {
    console.warn(`Exception during batch insert: ${e.message}`);
    return { stored, skipped: signals.length - stored, error: e.message };
  }
}

/**
 * Store cross-stock analysis results
 * 
 * @param {Object} analysis - Results from runCrossStockAnalysis
 * @returns {Promise<void>}
 */
async function storeAnalysisResults(analysis) {
  if (!isSupabaseConfigured()) {
    console.log('⚠️ Supabase not configured, skipping analysis storage');
    return;
  }
  
  const supabase = getSupabase();
  
  try {
    const analysisRecord = {
      analysis_date: new Date().toISOString(),
      total_signals: analysis.overallStats.totalSignals,
      win_rate: analysis.overallStats.winRate,
      avg_return: analysis.overallStats.avgReturn,
      profit_factor: analysis.overallStats.profitFactor,
      
      // Store complex data as JSON
      top_factors: analysis.topFactors,
      optimal_setup: analysis.optimalSetup,
      ideal_win_rate: analysis.idealWinRate,
      pattern_analysis: analysis.patternAnalysis,
      exit_analysis: analysis.exitAnalysis,
      weight_recommendations: analysis.weightRecommendations,
      
      summary: analysis.optimalSummary
    };
    
    const { error } = await supabase
      .from('pattern_analysis')
      .insert(analysisRecord);
    
    if (error) {
      console.warn(`Could not store analysis: ${error.message}`);
    } else {
      console.log('✅ Analysis results stored in database');
    }
    
  } catch (e) {
    console.warn(`Error storing analysis: ${e.message}`);
  }
}

/**
 * Store setup win rates for adaptive scoring
 * 
 * @param {Array} signals - All historical signals
 * @returns {Promise<void>}
 */
async function updateSetupWinRates(signals) {
  if (!isSupabaseConfigured()) return;
  
  const supabase = getSupabase();
  
  // Group by pattern type
  const byPattern = {};
  for (const signal of signals) {
    const pattern = signal.pattern || 'unknown';
    if (!byPattern[pattern]) {
      byPattern[pattern] = { total: 0, wins: 0 };
    }
    byPattern[pattern].total++;
    if (signal.returnPct > 0) byPattern[pattern].wins++;
  }
  
  // Upsert win rates
  for (const [pattern, stats] of Object.entries(byPattern)) {
    const winRate = stats.total > 0 ? (stats.wins / stats.total) * 100 : 0;
    
    try {
      const { error } = await supabase
        .from('setup_win_rates')
        .upsert({
          setup_type: pattern,
          total_trades: stats.total,
          winning_trades: stats.wins,
          win_rate: Math.round(winRate * 10) / 10,
          last_updated: new Date().toISOString()
        }, { onConflict: 'setup_type' });
      
      if (error) {
        console.warn(`Could not update win rate for ${pattern}: ${error.message}`);
      }
    } catch (e) {
      console.warn(`Error updating win rate: ${e.message}`);
    }
  }
  
  console.log(`📈 Updated win rates for ${Object.keys(byPattern).length} pattern types`);
}

/**
 * Main function: Run full historical analysis pipeline
 * 
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} Complete results
 */
export async function runHistoricalAnalysis(options = {}) {
  const {
    tickers = null,           // Specific tickers or null for full universe
    lookbackMonths = 60,      // How far back to scan (60 = 5 years for WFO)
    tickerLimit = 0,          // Limit number of tickers (0 = all)
    storeInDatabase = true,   // Save to Supabase
    relaxedThresholds = false,
    seedMode = false,
    signalFamilies = null,
    onProgress = null         // Progress callback
  } = options;

  console.log('🚀 Starting historical analysis pipeline...');
  console.log(`   Lookback: ${lookbackMonths} months`);

  // Step 1: Get ticker list (with optional limit)
  let tickerList = tickers || await getTickerList();
  
  // Apply ticker limit if specified
  if (tickerLimit > 0 && tickerList.length > tickerLimit) {
    tickerList = tickerList.slice(0, tickerLimit);
    console.log(`   Tickers: ${tickerList.length} (limited from full universe)`);
  } else {
    console.log(`   Tickers: ${tickerList.length}`);
  }
  
  // Step 2: Scan for historical signals
  const thresholdOverrides = relaxedThresholds
    ? {
        minRelativeStrength: 60,
        minContractions: 1,
        maxDistanceFromHigh: 35,
        minPatternConfidence: 30,
        min10MASlopePct14d: 2,
        min10MASlopePct5d: 0.2,
        maTolerance: 3.0,
      }
    : null;

  const scanResults = await scanMultipleTickers(tickerList, lookbackMonths, onProgress, {
    thresholdOverrides,
    seedMode,
    signalFamilies: normalizeSignalFamilies(signalFamilies),
  });
  
  if (scanResults.signals.length === 0) {
    console.log('⚠️ No signals found');
    return {
      success: false,
      message: 'No historical signals found',
      scanResults
    };
  }
  
  console.log(`📊 Found ${scanResults.signals.length} historical signals`);
  
  // Step 3: Store signals in database
  let storageStats = null;
  if (storeInDatabase) {
    storageStats = await storeSignalsInDatabase(scanResults.signals);
  }
  
  // Step 4: Run cross-stock analysis
  const analysis = runCrossStockAnalysis(scanResults.signals);
  
  // Step 5: Store analysis results
  if (storeInDatabase) {
    await storeAnalysisResults(analysis);
    await updateSetupWinRates(scanResults.signals);
  }
  
  // Step 6: Generate optimization report
  const report = generateOptimizationReport(scanResults, analysis);
  
  console.log('✅ Historical analysis pipeline complete!');
  
  return {
    success: true,
    
    // Scan statistics
    totalTickers: tickerList.length,
    totalSignals: scanResults.signals.length,
    scanStats: scanResults.stats,
    diagnostics: scanResults.diagnostics,
    
    // Analysis results
    overallStats: analysis.overallStats,
    topFactors: analysis.topFactors,
    optimalSetup: analysis.optimalSetup,
    idealWinRate: analysis.idealWinRate,
    patternAnalysis: analysis.patternAnalysis,
    exitAnalysis: analysis.exitAnalysis,
    weightRecommendations: analysis.weightRecommendations,
    
    // Storage stats
    storageStats,
    
    // Human-readable report
    report,
    
    // Raw data (for further analysis)
    signals: scanResults.signals,
    fullAnalysis: analysis
  };
}

/**
 * Generate human-readable optimization report
 */
function generateOptimizationReport(scanResults, analysis) {
  const lines = [];
  
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('           HISTORICAL VCP SIGNAL ANALYSIS REPORT               ');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');
  
  // Overall stats
  lines.push('📊 OVERALL PERFORMANCE:');
  lines.push(`   Total Signals Analyzed: ${analysis.overallStats.totalSignals}`);
  lines.push(`   Win Rate: ${analysis.overallStats.winRate}%`);
  lines.push(`   Average Return: ${analysis.overallStats.avgReturn}%`);
  lines.push(`   Avg Win: +${analysis.overallStats.avgWin}%  |  Avg Loss: ${analysis.overallStats.avgLoss}%`);
  if (analysis.overallStats.profitFactor) {
    lines.push(`   Profit Factor: ${analysis.overallStats.profitFactor}`);
  }
  lines.push('');
  
  // Top factors
  lines.push('🎯 TOP FACTORS FOR SUCCESS (by win rate):');
  for (const factor of analysis.topFactors.slice(0, 5)) {
    lines.push(`   ${factor.factorName}: ${factor.bestBucket} → ${factor.bestWinRate}% win rate`);
  }
  lines.push('');

  // Diagnostics
  lines.push(...formatDiagnosticsSummary(scanResults.diagnostics));
  
  // Optimal setup
  lines.push('⭐ OPTIMAL VCP SETUP:');
  lines.push(analysis.optimalSummary || 'No optimal setup identified');
  lines.push('');
  
  // Pattern analysis
  lines.push('📈 PERFORMANCE BY PATTERN TYPE:');
  for (const pattern of analysis.patternAnalysis.byPattern.slice(0, 5)) {
    lines.push(`   ${pattern.pattern}: ${pattern.winRate}% win rate (${pattern.total} signals)`);
  }
  lines.push('');
  
  // Exit analysis
  lines.push('🚪 EXIT TYPE BREAKDOWN:');
  for (const exit of analysis.exitAnalysis.byExitType) {
    lines.push(`   ${exit.exitType}: ${exit.percentage}% of exits (avg ${exit.avgReturn}% return)`);
  }
  lines.push('');
  
  // Weight recommendations
  if (analysis.weightRecommendations.length > 0) {
    lines.push('🔧 WEIGHT ADJUSTMENT RECOMMENDATIONS:');
    for (const rec of analysis.weightRecommendations.slice(0, 5)) {
      const action = rec.action === 'increase' ? '↑' : '↓';
      lines.push(`   ${action} ${rec.weight}: ${rec.reason}`);
    }
    lines.push('');
  }
  
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push(`Generated: ${new Date().toISOString()}`);
  
  return lines.join('\n');
}

/**
 * Quick analysis: Run on a specific set of tickers (faster)
 */
export async function quickAnalysis(tickers, lookbackMonths = 6) {
  return runHistoricalAnalysis({
    tickers,
    lookbackMonths,
    storeInDatabase: false
  });
}

/**
 * Get latest analysis results from database
 */
export async function getLatestAnalysis() {
  if (!isSupabaseConfigured()) {
    return null;
  }
  
  const supabase = getSupabase();
  
  const { data, error } = await supabase
    .from('pattern_analysis')
    .select('*')
    .order('analysis_date', { ascending: false })
    .limit(1);
  
  if (error || !data || data.length === 0) {
    return null;
  }
  
  return data[0];
}

/**
 * Get historical signals from database (for re-analysis)
 * Tries historical_trades table first, then falls back to trade_context_snapshots
 */
export async function getStoredSignals(limit = 10000, opts = {}) {
  if (!isSupabaseConfigured()) {
    return loadStoredSignalsFromFile(limit, opts);
  }
  
  const supabase = getSupabase();
  
  // Try the dedicated historical_trades table first (new schema)
  try {
    const { data, error } = await supabase
      .from('historical_trades')
      .select('*')
      .order('entry_date', { ascending: false })
      .limit(limit);
    
    if (!error && data && data.length > 0) {
      return data.map(row => ({
        ticker: row.ticker,
        entryDate: row.entry_date,
        entryPrice: row.entry_price,
        exitDate: row.exit_date,
        exitPrice: row.exit_price,
        returnPct: row.return_pct,
        holdingDays: row.holding_days,
        exitType: row.exit_type,
        maxGain: row.max_gain,
        maxDrawdown: row.max_drawdown,
        pattern: row.pattern,
        patternConfidence: row.pattern_confidence,
        contractions: row.contractions,
        opus45Confidence: row.opus45_confidence,
        opus45Grade: row.opus45_grade,
        signalType: row.signal_type,
        // Restore full context so agents can rescore with different weight hypotheses
        context: row.context || {},
        source: 'historical_trades',
        scanType: row.scan_type || 'deep_historical',
        lookbackMonths: row.lookback_months || 60,
        exitStrategyVersion: row.exit_strategy_version || 2,
      }));
    }
  } catch (e) {
    // Table may not exist yet - continue to fallback
  }
  
  // Fallback: try trade_context_snapshots with source filter
  try {
    const { data, error } = await supabase
      .from('trade_context_snapshots')
      .select('*')
      .order('entry_date', { ascending: false })
      .limit(limit);
    
    if (error) {
      // Column or table may not exist - this is expected before migration
      if (error.message.includes('does not exist')) {
        // Silent fail - database schema needs to be updated
        return loadStoredSignalsFromFile(limit, opts);
      }
      console.warn(`Error fetching stored signals: ${error.message}`);
      return loadStoredSignalsFromFile(limit, opts);
    }
    
    if (!data || data.length === 0) return loadStoredSignalsFromFile(limit, opts);
    
    // Filter to historical scans if source column exists, otherwise return all
    const filtered = data.filter(row => 
      !row.source || row.source === 'historical_scan'
    );
    
    const mapped = filtered.map(row => ({
      ticker: row.ticker,
      entryDate: row.entry_date,
      entryPrice: row.entry_price,
      exitDate: row.exit_date,
      exitPrice: row.exit_price,
      returnPct: row.return_pct,
      holdingDays: row.holding_days,
      exitType: row.exit_type,
      maxGain: row.max_gain,
      maxDrawdown: row.max_drawdown,
      pattern: row.pattern_type,
      patternConfidence: row.pattern_confidence,
      contractions: row.contractions,
      opus45Confidence: row.opus_45_confidence,
      context: {
        sma10: row.sma_10,
        sma20: row.sma_20,
        sma50: row.sma_50,
        sma150: row.sma_150,
        sma200: row.sma_200,
        maAlignmentValid: row.ma_alignment_valid,
        priceAboveAllMAs: row.price_above_all_mas,
        ma200Rising: row.ma_200_rising,
        ma10Slope14d: row.ma_10_slope_14d,
        vcpValid: row.vcp_valid,
        contractions: row.contractions,
        baseDepthPct: row.base_depth_pct,
        patternType: row.pattern_type,
        patternConfidence: row.pattern_confidence,
        breakoutVolumeRatio: row.breakout_volume_ratio,
        pctFromHigh: row.pct_from_high,
        relativeStrength: row.relative_strength,
        opus45Confidence: row.opus_45_confidence
      },
      source: 'trade_context_snapshots'
    }));
    return mapped.length > 0 ? mapped : loadStoredSignalsFromFile(limit, opts);
  } catch (e) {
    // Handle network errors or other issues gracefully
    console.warn(`Exception fetching stored signals: ${e.message}`);
    return loadStoredSignalsFromFile(limit, opts);
  }
}

/**
 * Get the most recent time we wrote historical signals (Harry fetch / deep scan).
 * Used for "Last fetch" on the Agents page.
 *
 * @returns {Promise<string|null>} ISO timestamp of latest row in historical_trades, or null
 */
export async function getLastHarryFetchAt() {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('historical_trades')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data?.created_at) return null;
    return data.created_at;
  } catch (e) {
    return null;
  }
}

export { storeSignalsInDatabase, storeAnalysisResults };
