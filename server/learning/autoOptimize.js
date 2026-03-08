/**
 * Auto-Optimize Opus4.5 Weights
 * 
 * This module automatically updates the Opus4.5 buy signal weights
 * based on cross-stock historical analysis. It reads pattern analysis
 * results and applies data-driven adjustments to the scoring weights.
 * 
 * LEARNING LOOP:
 * 1. Historical scanner finds signals across many stocks
 * 2. Cross-stock analyzer identifies which factors predict wins
 * 3. This module translates those findings into weight adjustments
 * 4. Opus4.5Signal uses updated weights for future signals
 * 
 * NO MANUAL TUNING REQUIRED - the system self-optimizes.
 */

import { getSupabase, isSupabaseConfigured } from '../supabase.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_WEIGHTS, MANDATORY_THRESHOLDS } from '../opus45Signal.js';
import { analyzeAllFactors, computeSignalMetrics } from './crossStockAnalyzer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const LEARNING_RUNS_FILE = path.join(DATA_DIR, 'learning_runs.json');
const LEARNING_RUNS_ARCHIVE_FILE = path.join(DATA_DIR, 'learning_runs_archive.json');

function ensureDataDir() {
  if (process.env.VERCEL) return;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadLearningRunsFromFile() {
  try {
    if (!fs.existsSync(LEARNING_RUNS_FILE)) return [];
    const raw = fs.readFileSync(LEARNING_RUNS_FILE, 'utf8');
    if (!raw || raw.trim() === '') return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function storeLearningRunToFile(record) {
  try {
    if (process.env.VERCEL) return { stored: false, reason: 'vercel_read_only' };
    ensureDataDir();
    const existing = loadLearningRunsFromFile();
    const next = [record, ...existing].slice(0, 200);
    fs.writeFileSync(LEARNING_RUNS_FILE, JSON.stringify(next, null, 2), 'utf8');
    return { stored: true, storage: 'file' };
  } catch (e) {
    return { stored: false, error: e.message };
  }
}

function loadArchivedLearningRunsFromFile() {
  try {
    if (!fs.existsSync(LEARNING_RUNS_ARCHIVE_FILE)) return [];
    const raw = fs.readFileSync(LEARNING_RUNS_ARCHIVE_FILE, 'utf8');
    if (!raw || raw.trim() === '') return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function storeArchivedLearningRunsToFile(records) {
  try {
    if (process.env.VERCEL) return { stored: false, reason: 'vercel_read_only' };
    ensureDataDir();
    fs.writeFileSync(LEARNING_RUNS_ARCHIVE_FILE, JSON.stringify(records, null, 2), 'utf8');
    return { stored: true, storage: 'file' };
  } catch (e) {
    return { stored: false, error: e.message };
  }
}

/**
 * Weight mapping from cross-stock factors to Opus4.5 weight names
 */
const FACTOR_TO_WEIGHT_MAP = {
  relativeStrength: {
    targetWeight: 'entryRSAbove90',
    secondaryWeight: 'relativeStrengthBonus',
    // Translate bucket win rates to weight adjustments
    bucketToAdjustment: (bestBucket, bestWinRate, baselineWinRate) => {
      // If RS 95+ has significantly higher win rate, boost RS weight
      const winRateDiff = bestWinRate - baselineWinRate;
      if (bestBucket === '95+' && winRateDiff > 15) return { delta: +5, reason: `RS 95+ wins ${winRateDiff}% more` };
      if (bestBucket === '90-95' && winRateDiff > 10) return { delta: +3, reason: `RS 90-95 wins ${winRateDiff}% more` };
      if (bestWinRate < 35) return { delta: -3, reason: `RS factor underperforming (${bestWinRate}%)` };
      return { delta: 0, reason: 'RS factor performing as expected' };
    }
  },
  
  contractions: {
    targetWeight: 'vcpContractions3Plus',
    secondaryWeight: 'vcpContractions4Plus',
    bucketToAdjustment: (bestBucket, bestWinRate, baselineWinRate) => {
      const winRateDiff = bestWinRate - baselineWinRate;
      if (bestBucket === '5+' && winRateDiff > 10) return { delta: +4, reason: `5+ contractions wins ${winRateDiff}% more` };
      if (bestBucket === '4' && winRateDiff > 8) return { delta: +3, reason: `4 contractions is optimal` };
      if (bestBucket === '3' && winRateDiff > 5) return { delta: +2, reason: `3 contractions is optimal` };
      if (bestWinRate < 35) return { delta: -2, reason: `Contractions factor underperforming` };
      return { delta: 0, reason: 'Contractions performing as expected' };
    }
  },
  
  ma10Slope14d: {
    targetWeight: 'slope10MAElite',
    secondaryWeight: 'slope10MAStrong',
    tertiaryWeight: 'slope10MAGood',
    bucketToAdjustment: (bestBucket, bestWinRate, baselineWinRate) => {
      const winRateDiff = bestWinRate - baselineWinRate;
      if (bestBucket === '10%+' && winRateDiff > 15) return { delta: +6, reason: `10%+ slope wins ${winRateDiff}% more - ELITE` };
      if (bestBucket === '7-10%' && winRateDiff > 10) return { delta: +4, reason: `7-10% slope wins ${winRateDiff}% more` };
      if (bestBucket === '5-7%' && winRateDiff > 8) return { delta: +3, reason: `5-7% slope is optimal` };
      if (bestWinRate < 35) return { delta: -3, reason: `Slope factor underperforming` };
      return { delta: 0, reason: 'Slope performing as expected' };
    }
  },
  
  breakoutVolumeRatio: {
    targetWeight: 'entryVolumeConfirm',
    bucketToAdjustment: (bestBucket, bestWinRate, baselineWinRate) => {
      const winRateDiff = bestWinRate - baselineWinRate;
      if (bestBucket === '2.5x+' && winRateDiff > 12) return { delta: +4, reason: `Volume 2.5x+ wins ${winRateDiff}% more` };
      if (bestBucket === '2.0-2.5x' && winRateDiff > 8) return { delta: +3, reason: `Volume 2x+ wins ${winRateDiff}% more` };
      if (bestWinRate < 35) return { delta: -2, reason: `Volume confirmation underperforming` };
      return { delta: 0, reason: 'Volume confirmation performing as expected' };
    }
  },
  
  pullbackPct: {
    targetWeight: 'pullbackIdeal',
    secondaryWeight: 'pullbackGood',
    bucketToAdjustment: (bestBucket, bestWinRate, baselineWinRate) => {
      const winRateDiff = bestWinRate - baselineWinRate;
      if (bestBucket === '0-2%' && winRateDiff > 10) return { delta: +4, reason: `Tight pullback (0-2%) wins ${winRateDiff}% more` };
      if (bestBucket === '2-4%' && winRateDiff > 8) return { delta: +3, reason: `2-4% pullback is optimal` };
      if (bestWinRate < 35) return { delta: -2, reason: `Pullback quality underperforming` };
      return { delta: 0, reason: 'Pullback quality performing as expected' };
    }
  },
  
  baseDepthPct: {
    targetWeight: 'vcpPatternConfidence',
    bucketToAdjustment: (bestBucket, bestWinRate, baselineWinRate) => {
      const winRateDiff = bestWinRate - baselineWinRate;
      if (bestBucket === '<10%' && winRateDiff > 10) return { delta: +3, reason: `Shallow bases (<10%) win ${winRateDiff}% more` };
      if (bestWinRate < 35) return { delta: -2, reason: `Base depth factor underperforming` };
      return { delta: 0, reason: 'Base depth performing as expected' };
    }
  },
  
  pctFromHigh: {
    // This affects mandatory threshold, not weight
    targetThreshold: 'maxDistanceFromHigh',
    bucketToAdjustment: (bestBucket, bestWinRate, baselineWinRate) => {
      const winRateDiff = bestWinRate - baselineWinRate;
      if (bestBucket === '<5%' && winRateDiff > 15) return { thresholdDelta: -5, reason: `Entries <5% from high win ${winRateDiff}% more` };
      if (bestBucket === '5-10%' && winRateDiff > 10) return { thresholdDelta: -3, reason: `Entries 5-10% from high are optimal` };
      return { thresholdDelta: 0, reason: 'Distance from high performing as expected' };
    }
  },
  
  patternConfidence: {
    targetWeight: 'vcpPatternConfidence',
    bucketToAdjustment: (bestBucket, bestWinRate, baselineWinRate) => {
      const winRateDiff = bestWinRate - baselineWinRate;
      if (bestBucket === '90%+' && winRateDiff > 15) return { delta: +4, reason: `High confidence patterns win ${winRateDiff}% more` };
      if (bestBucket === '80-90%' && winRateDiff > 10) return { delta: +3, reason: `80%+ confidence patterns are optimal` };
      if (bestWinRate < 35) return { delta: -2, reason: `Pattern confidence underperforming` };
      return { delta: 0, reason: 'Pattern confidence performing as expected' };
    }
  }
};

/**
 * Avg-return-driven weight mapping.
 * Uses avg return deltas instead of win rate deltas.
 * Mirrors FACTOR_TO_WEIGHT_MAP structure but the decision function
 * compares bestAvgReturn of the bucket against baseline avgReturn.
 */
function avgReturnAdjustment(mapping, bestBucket, bestAvgReturn, baselineAvgReturn) {
  const diff = bestAvgReturn - baselineAvgReturn;
  if (diff > 5) return { delta: +5, reason: `${bestBucket} avg return is ${diff.toFixed(1)}% above baseline` };
  if (diff > 3) return { delta: +3, reason: `${bestBucket} avg return is ${diff.toFixed(1)}% above baseline` };
  if (diff > 1) return { delta: +2, reason: `${bestBucket} avg return is ${diff.toFixed(1)}% above baseline` };
  if (bestAvgReturn < -2) return { delta: -3, reason: `${bestBucket} avg return is negative (${bestAvgReturn}%)` };
  return { delta: 0, reason: 'Factor avg return near baseline' };
}

/**
 * Generate optimized weights from historical analysis
 * 
 * @param {Array} signals - Historical signals with outcomes
 * @param {Object} [options]
 * @param {'winRate'|'avgReturn'|'expectancy'} [options.objective='expectancy'] - What to optimize
 * @param {Object} [options.startingWeights] - Weights to start from (for compounding)
 * @returns {Object} Optimized weights and adjustments made
 */
export function generateOptimizedWeights(signals, options = {}) {
  const { objective = 'expectancy', startingWeights = null } = options;

  if (!signals || signals.length < 10) {
    return {
      weights: { ...(startingWeights || DEFAULT_WEIGHTS) },
      adjustments: [],
      source: 'default',
      reason: 'Not enough signals for optimization (need 10+)'
    };
  }
  
  // Run cross-stock analysis with the chosen objective
  const factors = analyzeAllFactors(signals, objective);
  
  // Compute full baseline metrics
  const baselineMetrics = computeSignalMetrics(signals);
  const totalWinRate = baselineMetrics.winRate;
  const baselineAvgReturn = baselineMetrics.avgReturn;
  const baselineExpectancy = baselineMetrics.expectancy;
  
  // Start from provided weights or defaults
  const optimizedWeights = { ...(startingWeights || DEFAULT_WEIGHTS) };
  const adjustments = [];
  
  // Apply adjustments for each factor
  for (const [factorName, mapping] of Object.entries(FACTOR_TO_WEIGHT_MAP)) {
    const factorAnalysis = factors.factorAnalysis?.[factorName];
    if (!factorAnalysis || !factorAnalysis.bestBucket) continue;

    let adjustment;
    if (objective === 'avgReturn' || objective === 'expectancy') {
      const bestMetric = objective === 'expectancy'
        ? (factorAnalysis.bestExpectancy || 0)
        : (factorAnalysis.bestAvgReturn || 0);
      const baseline = objective === 'expectancy' ? baselineExpectancy : baselineAvgReturn;
      adjustment = avgReturnAdjustment(mapping, factorAnalysis.bestBucket, bestMetric, baseline);
    } else {
      adjustment = mapping.bucketToAdjustment(
        factorAnalysis.bestBucket,
        factorAnalysis.bestWinRate,
        totalWinRate
      );
    }
    
    if (adjustment.delta && adjustment.delta !== 0) {
      if (mapping.targetWeight && optimizedWeights[mapping.targetWeight] !== undefined) {
        const oldValue = optimizedWeights[mapping.targetWeight];
        const newValue = Math.max(0, Math.min(30, oldValue + adjustment.delta));
        optimizedWeights[mapping.targetWeight] = newValue;
        
        adjustments.push({
          weight: mapping.targetWeight,
          factor: factorName,
          oldValue,
          newValue,
          delta: adjustment.delta,
          reason: adjustment.reason,
          bestBucket: factorAnalysis.bestBucket,
          bestWinRate: factorAnalysis.bestWinRate,
          bestAvgReturn: factorAnalysis.bestAvgReturn || 0,
          bestExpectancy: factorAnalysis.bestExpectancy || 0
        });
      }
      
      if (mapping.secondaryWeight && optimizedWeights[mapping.secondaryWeight] !== undefined) {
        const secondaryDelta = Math.round(adjustment.delta * 0.6);
        if (secondaryDelta !== 0) {
          const oldValue = optimizedWeights[mapping.secondaryWeight];
          const newValue = Math.max(0, Math.min(25, oldValue + secondaryDelta));
          optimizedWeights[mapping.secondaryWeight] = newValue;
          
          adjustments.push({
            weight: mapping.secondaryWeight,
            factor: factorName,
            oldValue,
            newValue,
            delta: secondaryDelta,
            reason: `Secondary adjustment from ${factorName}`,
            bestBucket: factorAnalysis.bestBucket,
            bestWinRate: factorAnalysis.bestWinRate
          });
        }
      }
    }
    
    if (adjustment.thresholdDelta && adjustment.thresholdDelta !== 0) {
      adjustments.push({
        threshold: mapping.targetThreshold,
        factor: factorName,
        suggestedDelta: adjustment.thresholdDelta,
        reason: adjustment.reason,
        bestBucket: factorAnalysis.bestBucket,
        bestWinRate: factorAnalysis.bestWinRate,
        applied: false,
        note: 'Threshold changes require manual review'
      });
    }
  }
  
  return {
    weights: optimizedWeights,
    adjustments,
    source: 'historical_optimization',
    objective,
    signalsAnalyzed: signals.length,
    baselineWinRate: Math.round(totalWinRate * 10) / 10,
    baselineAvgReturn: baselineAvgReturn,
    baselineExpectancy: baselineExpectancy,
    avgWin: baselineMetrics.avgWin,
    avgLoss: baselineMetrics.avgLoss,
    profitFactor: baselineMetrics.profitFactor,
    topFactors: factors.topFactors?.slice(0, 5) || [],
    generatedAt: new Date().toISOString()
  };
}

/**
 * Store optimized weights in database
 * 
 * @param {Object} optimizedWeights - Result from generateOptimizedWeights
 * @param {Object} [options]
 * @param {boolean} [options.activate=true] - Whether to set as active (false for A/B variant not yet promoted)
 * @returns {Promise<Object>} Storage result with the inserted record id
 */
export async function storeOptimizedWeights(optimizedWeights, options = {}) {
  const { activate = true, agentType = 'default' } = options;

  if (!isSupabaseConfigured()) {
    console.log('⚠️ Supabase not configured, cannot store optimized weights');
    return { stored: false, reason: 'Supabase not configured' };
  }
  
  const supabase = getSupabase();
  
  try {
    const record = {
      agent_type: agentType,
      weights: optimizedWeights.weights,
      adjustments: optimizedWeights.adjustments,
      signals_analyzed: optimizedWeights.signalsAnalyzed,
      baseline_win_rate: optimizedWeights.baselineWinRate,
      baseline_avg_return: optimizedWeights.baselineAvgReturn ?? null,
      baseline_expectancy: optimizedWeights.baselineExpectancy ?? null,
      avg_win: optimizedWeights.avgWin ?? null,
      avg_loss: optimizedWeights.avgLoss ?? null,
      profit_factor: optimizedWeights.profitFactor ?? null,
      top_factors: optimizedWeights.topFactors,
      generated_at: optimizedWeights.generatedAt,
      is_active: activate,
      created_at: new Date().toISOString()
    };
    
    // Only deactivate weights for the same agent_type
    if (activate) {
      await supabase
        .from('optimized_weights')
        .update({ is_active: false })
        .eq('is_active', true)
        .eq('agent_type', agentType);
    }
    
    const { data, error } = await supabase
      .from('optimized_weights')
      .insert(record)
      .select('id')
      .single();
    
    if (error) {
      console.warn(`Could not store weights: ${error.message}`);
      return { stored: false, error: error.message };
    }
    
    console.log(`✅ Optimized weights stored for ${agentType}${activate ? ' and activated' : ' (not activated)'}`);
    return { stored: true, id: data?.id, adjustments: (optimizedWeights.adjustments || []).length };
    
  } catch (e) {
    console.error('Error storing weights:', e);
    return { stored: false, error: e.message };
  }
}

/**
 * Load active optimized weights from database
 * 
 * @returns {Promise<Object>} Active weights or default
 */
export async function loadOptimizedWeights(agentType = 'default') {
  if (!isSupabaseConfigured()) {
    return { weights: DEFAULT_WEIGHTS, source: 'default', agentType };
  }
  
  const supabase = getSupabase();
  
  try {
    const { data, error } = await supabase
      .from('optimized_weights')
      .select('*')
      .eq('is_active', true)
      .eq('agent_type', agentType)
      .order('created_at', { ascending: false })
      .limit(1);
    
    if (error || !data || data.length === 0) {
      return { weights: DEFAULT_WEIGHTS, source: 'default', agentType };
    }
    
    const record = data[0];
    
    return {
      weights: record.weights,
      source: 'optimized',
      agentType: record.agent_type,
      signalsAnalyzed: record.signals_analyzed,
      baselineWinRate: record.baseline_win_rate,
      avgReturn: record.baseline_avg_return ?? null,
      expectancy: record.baseline_expectancy ?? null,
      avgWin: record.avg_win ?? null,
      avgLoss: record.avg_loss ?? null,
      profitFactor: record.profit_factor ?? null,
      adjustments: record.adjustments,
      generatedAt: record.generated_at,
      id: record.id
    };
    
  } catch (e) {
    console.warn('Error loading optimized weights:', e.message);
    return { weights: DEFAULT_WEIGHTS, source: 'default', agentType };
  }
}

/**
 * Store a learning run (A/B comparison record)
 */
export async function storeLearningRun(runData) {
  if (!isSupabaseConfigured()) {
    console.log('⚠️ Supabase not configured, storing learning run locally');
    const record = {
      run_number: null,
      system_name: runData.systemName || 'Opus Signal',
      agent_type: runData.agentType || 'default',
      ...(runData.regimeTag ? { regime_tag: runData.regimeTag } : {}),
      started_at: runData.startedAt || new Date().toISOString(),
      completed_at: runData.completedAt || new Date().toISOString(),
      iterations_run: runData.iterationsRun || 0,
      signals_evaluated: runData.signalsEvaluated || 0,
      objective: runData.objective || 'expectancy',
      control_weights: runData.controlWeights,
      control_source: runData.controlSource || 'default',
      control_avg_return: runData.controlMetrics?.avgReturn ?? null,
      control_expectancy: runData.controlMetrics?.expectancy ?? null,
      control_win_rate: runData.controlMetrics?.winRate ?? null,
      control_avg_win: runData.controlMetrics?.avgWin ?? null,
      control_avg_loss: runData.controlMetrics?.avgLoss ?? null,
      control_profit_factor: runData.controlMetrics?.profitFactor ?? null,
      control_signal_count: runData.controlMetrics?.totalSignals ?? null,
      variant_weights: runData.variantWeights,
      variant_avg_return: runData.variantMetrics?.avgReturn ?? null,
      variant_expectancy: runData.variantMetrics?.expectancy ?? null,
      variant_win_rate: runData.variantMetrics?.winRate ?? null,
      variant_avg_win: runData.variantMetrics?.avgWin ?? null,
      variant_avg_loss: runData.variantMetrics?.avgLoss ?? null,
      variant_profit_factor: runData.variantMetrics?.profitFactor ?? null,
      variant_signal_count: runData.variantMetrics?.totalSignals ?? null,
      delta_avg_return: (runData.variantMetrics?.avgReturn ?? 0) - (runData.controlMetrics?.avgReturn ?? 0),
      delta_expectancy: (runData.variantMetrics?.expectancy ?? 0) - (runData.controlMetrics?.expectancy ?? 0),
      delta_win_rate: (runData.variantMetrics?.winRate ?? 0) - (runData.controlMetrics?.winRate ?? 0),
      factor_changes: runData.factorChanges || [],
      top_factors: runData.topFactors || [],
      promoted: runData.promoted || false,
      promotion_reason: runData.promotionReason || null,
      min_improvement_threshold: runData.minImprovementThreshold ?? 0.25,
      criteria_summary: runData.criteriaSummary || null,
      created_at: runData.completedAt || new Date().toISOString(),
    };
    return storeLearningRunToFile(record);
  }

  const supabase = getSupabase();
  try {
    // Get next run number
    const { data: lastRun } = await supabase
      .from('learning_runs')
      .select('run_number')
      .order('run_number', { ascending: false })
      .limit(1);

    const runNumber = (lastRun?.[0]?.run_number || 0) + 1;

    const record = {
      run_number: runNumber,
      system_name: runData.systemName || 'Opus Signal',
      agent_type: runData.agentType || 'default',
      ...(runData.regimeTag ? { regime_tag: runData.regimeTag } : {}),
      started_at: runData.startedAt || new Date().toISOString(),
      completed_at: runData.completedAt || new Date().toISOString(),
      iterations_run: runData.iterationsRun || 0,
      signals_evaluated: runData.signalsEvaluated || 0,
      objective: runData.objective || 'expectancy',

      control_weights: runData.controlWeights,
      control_source: runData.controlSource || 'default',
      control_avg_return: runData.controlMetrics?.avgReturn ?? null,
      control_expectancy: runData.controlMetrics?.expectancy ?? null,
      control_win_rate: runData.controlMetrics?.winRate ?? null,
      control_avg_win: runData.controlMetrics?.avgWin ?? null,
      control_avg_loss: runData.controlMetrics?.avgLoss ?? null,
      control_profit_factor: runData.controlMetrics?.profitFactor ?? null,
      control_signal_count: runData.controlMetrics?.totalSignals ?? null,

      variant_weights: runData.variantWeights,
      variant_avg_return: runData.variantMetrics?.avgReturn ?? null,
      variant_expectancy: runData.variantMetrics?.expectancy ?? null,
      variant_win_rate: runData.variantMetrics?.winRate ?? null,
      variant_avg_win: runData.variantMetrics?.avgWin ?? null,
      variant_avg_loss: runData.variantMetrics?.avgLoss ?? null,
      variant_profit_factor: runData.variantMetrics?.profitFactor ?? null,
      variant_signal_count: runData.variantMetrics?.totalSignals ?? null,

      delta_avg_return: (runData.variantMetrics?.avgReturn ?? 0) - (runData.controlMetrics?.avgReturn ?? 0),
      delta_expectancy: (runData.variantMetrics?.expectancy ?? 0) - (runData.controlMetrics?.expectancy ?? 0),
      delta_win_rate: (runData.variantMetrics?.winRate ?? 0) - (runData.controlMetrics?.winRate ?? 0),

      factor_changes: runData.factorChanges || [],
      top_factors: runData.topFactors || [],

      promoted: runData.promoted || false,
      promotion_reason: runData.promotionReason || null,
      min_improvement_threshold: runData.minImprovementThreshold ?? 0.25,
      created_at: runData.completedAt || new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('learning_runs')
      .insert(record)
      .select('id, run_number')
      .single();

    if (error) {
      console.warn(`Could not store learning run: ${error.message}`);
      const fallback = storeLearningRunToFile(record);
      return { stored: false, error: error.message, fallback };
    }

    return { stored: true, id: data?.id, runNumber: data?.run_number };
  } catch (e) {
    console.error('Error storing learning run:', e);
    const fallback = storeLearningRunToFile({
      run_number: null,
      system_name: runData.systemName || 'Opus Signal',
      agent_type: runData.agentType || 'default',
      ...(runData.regimeTag ? { regime_tag: runData.regimeTag } : {}),
      started_at: runData.startedAt || new Date().toISOString(),
      completed_at: runData.completedAt || new Date().toISOString(),
      iterations_run: runData.iterationsRun || 0,
      signals_evaluated: runData.signalsEvaluated || 0,
      objective: runData.objective || 'expectancy',
      control_weights: runData.controlWeights,
      control_source: runData.controlSource || 'default',
      control_avg_return: runData.controlMetrics?.avgReturn ?? null,
      control_expectancy: runData.controlMetrics?.expectancy ?? null,
      control_win_rate: runData.controlMetrics?.winRate ?? null,
      control_avg_win: runData.controlMetrics?.avgWin ?? null,
      control_avg_loss: runData.controlMetrics?.avgLoss ?? null,
      control_profit_factor: runData.controlMetrics?.profitFactor ?? null,
      control_signal_count: runData.controlMetrics?.totalSignals ?? null,
      variant_weights: runData.variantWeights,
      variant_avg_return: runData.variantMetrics?.avgReturn ?? null,
      variant_expectancy: runData.variantMetrics?.expectancy ?? null,
      variant_win_rate: runData.variantMetrics?.winRate ?? null,
      variant_avg_win: runData.variantMetrics?.avgWin ?? null,
      variant_avg_loss: runData.variantMetrics?.avgLoss ?? null,
      variant_profit_factor: runData.variantMetrics?.profitFactor ?? null,
      variant_signal_count: runData.variantMetrics?.totalSignals ?? null,
      delta_avg_return: (runData.variantMetrics?.avgReturn ?? 0) - (runData.controlMetrics?.avgReturn ?? 0),
      delta_expectancy: (runData.variantMetrics?.expectancy ?? 0) - (runData.controlMetrics?.expectancy ?? 0),
      delta_win_rate: (runData.variantMetrics?.winRate ?? 0) - (runData.controlMetrics?.winRate ?? 0),
      factor_changes: runData.factorChanges || [],
      top_factors: runData.topFactors || [],
      promoted: runData.promoted || false,
      promotion_reason: runData.promotionReason || null,
      min_improvement_threshold: runData.minImprovementThreshold ?? 0.25,
      criteria_summary: runData.criteriaSummary || null,
      created_at: runData.completedAt || new Date().toISOString(),
    });
    return { stored: false, error: e.message, fallback };
  }
}

/**
 * Load latest learning run (most recent A/B result)
 */
export async function loadLatestLearningRun(agentType = null) {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();
  try {
    let query = supabase
      .from('learning_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1);
    if (agentType) query = query.eq('agent_type', agentType);
    const { data, error } = await query;
    if (error || !data || data.length === 0) return null;
    return data[0];
  } catch (e) {
    console.warn('Error loading latest learning run:', e.message);
    return null;
  }
}

/**
 * Load learning run history, optionally filtered by agent_type
 */
export async function loadLearningRunHistory(limit = 20, agentType = null) {
  if (!isSupabaseConfigured()) {
    const fileRuns = loadLearningRunsFromFile();
    return agentType ? fileRuns.filter((r) => r.agent_type === agentType).slice(0, limit) : fileRuns.slice(0, limit);
  }
  const supabase = getSupabase();
  try {
    let query = supabase
      .from('learning_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (agentType) query = query.eq('agent_type', agentType);
    const { data, error } = await query;
    if (error) {
      const fileRuns = loadLearningRunsFromFile();
      return agentType ? fileRuns.filter((r) => r.agent_type === agentType).slice(0, limit) : fileRuns.slice(0, limit);
    }
    if (data && data.length > 0) return data;
    const fileRuns = loadLearningRunsFromFile();
    return agentType ? fileRuns.filter((r) => r.agent_type === agentType).slice(0, limit) : fileRuns.slice(0, limit);
  } catch (e) {
    const fileRuns = loadLearningRunsFromFile();
    return agentType ? fileRuns.filter((r) => r.agent_type === agentType).slice(0, limit) : fileRuns.slice(0, limit);
  }
}

/**
 * Count learning runs, optionally filtered by agent_type.
 * Uses exact DB count when available, with local-file fallback.
 */
export async function countLearningRuns(agentType = null) {
  const countFromFile = () => {
    const fileRuns = loadLearningRunsFromFile();
    return agentType ? fileRuns.filter((r) => r.agent_type === agentType).length : fileRuns.length;
  };

  if (!isSupabaseConfigured()) {
    return countFromFile();
  }

  const supabase = getSupabase();
  try {
    let query = supabase
      .from('learning_runs')
      .select('id', { count: 'exact', head: true });
    if (agentType) query = query.eq('agent_type', agentType);
    const { count, error } = await query;
    if (error || typeof count !== 'number') return countFromFile();
    return count;
  } catch (e) {
    console.warn('Error counting learning runs:', e.message);
    return countFromFile();
  }
}

/**
 * Archive legacy runs whose objective differs from keepObjective.
 *
 * Supabase path:
 *   learning_runs -> learning_runs_archive -> delete from learning_runs
 *
 * Local fallback path:
 *   data/learning_runs.json -> data/learning_runs_archive.json
 */
export async function archiveLearningRuns(options = {}) {
  const {
    keepObjective = 'expectancy',
    dryRun = false,
    beforeDate = null,
    limit = 5000,
  } = options;

  const normalizeObjective = (value) => (typeof value === 'string' && value.trim() ? value.trim() : 'expectancy');
  const shouldArchive = (run) => {
    const objective = normalizeObjective(run?.objective);
    if (objective === keepObjective) return false;
    if (!beforeDate) return true;
    const createdAt = run?.created_at || run?.completed_at || null;
    if (!createdAt) return true;
    return new Date(createdAt).getTime() < new Date(beforeDate).getTime();
  };

  if (!isSupabaseConfigured()) {
    const fileRuns = loadLearningRunsFromFile();
    const toArchive = fileRuns.filter(shouldArchive);
    if (dryRun) {
      return {
        success: true,
        mode: 'file',
        dryRun: true,
        keepObjective,
        candidates: toArchive.length,
      };
    }

    const retained = fileRuns.filter((r) => !shouldArchive(r));
    const existingArchive = loadArchivedLearningRunsFromFile();
    const archivePayload = [
      ...toArchive.map((r) => ({
        ...r,
        archived_at: new Date().toISOString(),
        archive_reason: `objective!=${keepObjective}`,
      })),
      ...existingArchive,
    ].slice(0, 5000);

    const archivedWrite = storeArchivedLearningRunsToFile(archivePayload);
    if (!archivedWrite.stored) {
      return { success: false, mode: 'file', error: archivedWrite.error || archivedWrite.reason || 'archive_write_failed' };
    }

    ensureDataDir();
    fs.writeFileSync(LEARNING_RUNS_FILE, JSON.stringify(retained, null, 2), 'utf8');

    return {
      success: true,
      mode: 'file',
      dryRun: false,
      keepObjective,
      archived: toArchive.length,
      remaining: retained.length,
    };
  }

  const supabase = getSupabase();
  try {
    let query = supabase
      .from('learning_runs')
      .select('*')
      .neq('objective', keepObjective)
      .order('created_at', { ascending: true })
      .limit(Math.max(1, Math.min(10000, Number(limit) || 5000)));

    if (beforeDate) {
      query = query.lt('created_at', beforeDate);
    }

    const { data: rows, error } = await query;
    if (error) {
      return { success: false, mode: 'supabase', error: error.message };
    }

    const toArchive = rows || [];
    if (dryRun) {
      return {
        success: true,
        mode: 'supabase',
        dryRun: true,
        keepObjective,
        candidates: toArchive.length,
      };
    }
    if (toArchive.length === 0) {
      return {
        success: true,
        mode: 'supabase',
        dryRun: false,
        keepObjective,
        archived: 0,
      };
    }

    const archiveRows = toArchive.map((r) => ({
      ...r,
      archived_at: new Date().toISOString(),
      archive_reason: `objective!=${keepObjective}`,
    }));

    const { error: insertError } = await supabase
      .from('learning_runs_archive')
      .insert(archiveRows);
    if (insertError) {
      return {
        success: false,
        mode: 'supabase',
        error: insertError.message,
        hint: 'Create learning_runs_archive table first (see docs/supabase migration).',
      };
    }

    const ids = toArchive.map((r) => r.id).filter(Boolean);
    if (ids.length > 0) {
      const { error: deleteError } = await supabase
        .from('learning_runs')
        .delete()
        .in('id', ids);
      if (deleteError) {
        return { success: false, mode: 'supabase', error: deleteError.message, archivedInserted: toArchive.length };
      }
    }

    return {
      success: true,
      mode: 'supabase',
      dryRun: false,
      keepObjective,
      archived: toArchive.length,
    };
  } catch (e) {
    return { success: false, mode: 'supabase', error: e.message };
  }
}

/**
 * Run full optimization cycle:
 * 1. Load historical signals
 * 2. Run cross-stock analysis
 * 3. Generate optimized weights
 * 4. Store in database
 * 
 * @param {Object} options - Options
 * @param {'winRate'|'avgReturn'|'expectancy'} [options.objective='expectancy'] - Optimization target
 * @returns {Promise<Object>} Optimization results
 */
export async function runWeightOptimization(options = {}) {
  const { minSignals = 50, forceRun = false, objective = 'expectancy' } = options;
  
  console.log(`🔄 Running Opus4.5 weight optimization (objective: ${objective})...`);
  
  // Get stored signals
  let signals;
  if (isSupabaseConfigured()) {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('trade_context_snapshots')
      .select('*')
      .eq('source', 'historical_scan')
      .not('return_pct', 'is', null)
      .order('entry_date', { ascending: false })
      .limit(1000);
    
    signals = (data || []).map(row => ({
      ticker: row.ticker,
      returnPct: row.return_pct,
      context: {
        relativeStrength: row.relative_strength,
        contractions: row.contractions,
        ma10Slope14d: row.ma_10_slope_14d,
        breakoutVolumeRatio: row.breakout_volume_ratio,
        pullbackPct: row.pullback_pct,
        baseDepthPct: row.base_depth_pct,
        pctFromHigh: row.pct_from_high,
        patternConfidence: row.pattern_confidence,
        opus45Confidence: row.opus_45_confidence
      }
    }));
  } else {
    signals = [];
  }
  
  if (signals.length < minSignals && !forceRun) {
    console.log(`⚠️ Not enough signals for optimization (${signals.length}/${minSignals})`);
    return {
      success: false,
      reason: `Need at least ${minSignals} signals, have ${signals.length}`,
      suggestion: 'Run POST /api/learning/historical/run first to generate signals'
    };
  }
  
  // Load current active weights as starting point (compounding)
  let startingWeights = null;
  try {
    const stored = await loadOptimizedWeights();
    if (stored.source === 'optimized') {
      startingWeights = { ...DEFAULT_WEIGHTS, ...stored.weights };
    }
  } catch (_) { /* use defaults */ }

  const optimized = generateOptimizedWeights(signals, { objective, startingWeights });
  
  if (optimized.adjustments.length === 0) {
    console.log('ℹ️ No weight adjustments needed - current weights are optimal');
    return {
      success: true,
      adjustments: 0,
      reason: 'Current weights are performing well',
      weights: optimized.weights
    };
  }
  
  const storage = await storeOptimizedWeights(optimized);
  const summary = generateOptimizationSummary(optimized);
  
  console.log('✅ Weight optimization complete');
  console.log(summary);
  
  return {
    success: true,
    adjustments: optimized.adjustments.length,
    optimizedWeights: optimized.weights,
    adjustmentDetails: optimized.adjustments,
    signalsAnalyzed: signals.length,
    baselineWinRate: optimized.baselineWinRate,
    baselineAvgReturn: optimized.baselineAvgReturn,
    baselineExpectancy: optimized.baselineExpectancy,
    topFactors: optimized.topFactors,
    stored: storage.stored,
    objective,
    summary
  };
}

/**
 * Generate human-readable optimization summary
 */
function generateOptimizationSummary(optimized) {
  const lines = [];
  
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('          OPUS 4.5 WEIGHT OPTIMIZATION RESULTS                 ');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');
  lines.push(`Signals analyzed: ${optimized.signalsAnalyzed}`);
  lines.push(`Baseline win rate: ${optimized.baselineWinRate}%`);
  lines.push('');
  
  if (optimized.adjustments.length > 0) {
    lines.push('WEIGHT ADJUSTMENTS APPLIED:');
    lines.push('');
    
    for (const adj of optimized.adjustments) {
      if (adj.weight) {
        const direction = adj.delta > 0 ? '↑' : '↓';
        lines.push(`  ${direction} ${adj.weight}: ${adj.oldValue} → ${adj.newValue} (${adj.delta > 0 ? '+' : ''}${adj.delta})`);
        lines.push(`     Reason: ${adj.reason}`);
        lines.push(`     Based on: ${adj.factor} bucket "${adj.bestBucket}" = ${adj.bestWinRate}% win rate`);
        lines.push('');
      }
    }
  } else {
    lines.push('No weight adjustments needed - current weights are optimal.');
  }
  
  if (optimized.topFactors?.length > 0) {
    lines.push('TOP SUCCESS FACTORS:');
    for (const factor of optimized.topFactors) {
      lines.push(`  • ${factor.factorName}: ${factor.bestBucket} → ${factor.bestWinRate}% win rate`);
    }
  }
  
  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════');
  
  return lines.join('\n');
}

/**
 * Compare default weights vs optimized weights
 */
export function compareWeights() {
  const defaultW = DEFAULT_WEIGHTS;
  
  return {
    default: defaultW,
    description: 'Current default weights from opus45Signal.js',
    note: 'Run runWeightOptimization() to generate optimized weights from historical data'
  };
}

export { FACTOR_TO_WEIGHT_MAP };
