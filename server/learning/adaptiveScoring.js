/**
 * Adaptive Scoring System
 * 
 * Enhances confidence scoring by learning from historical outcomes.
 * 
 * This module:
 * 1. Queries historical win rates for similar setups
 * 2. Adjusts confidence score based on historical performance
 * 3. Tracks setup win rates by bucket (RS, contractions, pullback, industry, regime)
 * 4. Automatically updates weights based on pattern analysis
 * 
 * The key insight: A setup with high technical scores but low historical
 * win rate should have reduced confidence. Conversely, a setup matching
 * a high-win-rate historical pattern deserves a confidence boost.
 */

import { getSupabase, isSupabaseConfigured } from '../supabase.js';
import { getLatestPatternAnalysis } from './lossAnalyzer.js';
import { DEFAULT_WEIGHTS } from '../opus45Signal.js';

/**
 * Bucket definitions for setup matching
 */
const BUCKETS = {
  rs: {
    '90+': (v) => v >= 90,
    '80-90': (v) => v >= 80 && v < 90,
    '70-80': (v) => v >= 70 && v < 80,
    '<70': (v) => v < 70
  },
  contractions: {
    '4+': (v) => v >= 4,
    '3': (v) => v === 3,
    '2': (v) => v === 2 || v < 2
  },
  pullback: {
    '0-2%': (v) => v >= 0 && v <= 2,
    '2-5%': (v) => v > 2 && v <= 5,
    '5-8%': (v) => v > 5 && v <= 8,
    '8%+': (v) => v > 8
  },
  industry: {
    'top20': (v) => v <= 20,
    'top40': (v) => v > 20 && v <= 40,
    'top80': (v) => v > 40 && v <= 80,
    'bottom': (v) => v > 80 || v == null
  },
  regime: {
    'BULL': (v) => v === 'BULL',
    'UNCERTAIN': (v) => v === 'UNCERTAIN',
    'CORRECTION': (v) => v === 'CORRECTION',
    'BEAR': (v) => v === 'BEAR'
  }
};

/**
 * Get the bucket label for a value
 */
function getBucket(type, value) {
  if (value == null) return null;
  
  const buckets = BUCKETS[type];
  if (!buckets) return null;
  
  for (const [label, test] of Object.entries(buckets)) {
    if (test(value)) return label;
  }
  return null;
}

/**
 * Get historical win rate for a similar setup
 * 
 * @param {Object} setup - The current setup parameters
 * @returns {Promise<Object>} Historical performance for similar setups
 */
export async function getHistoricalWinRate(setup) {
  const {
    relativeStrength,
    contractions,
    pullbackPct,
    industryRank,
    marketRegime
  } = setup;
  
  const buckets = {
    rs: getBucket('rs', relativeStrength),
    contractions: getBucket('contractions', contractions),
    pullback: getBucket('pullback', pullbackPct),
    industry: getBucket('industry', industryRank),
    regime: getBucket('regime', marketRegime)
  };
  
  if (!isSupabaseConfigured()) {
    return { 
      winRate: null, 
      sampleSize: 0, 
      buckets,
      confidence: 'low',
      reason: 'No database configured'
    };
  }
  
  const supabase = getSupabase();
  
  // Try exact match first
  const { data: exactMatch } = await supabase
    .from('setup_win_rates')
    .select('*')
    .eq('rs_bucket', buckets.rs)
    .eq('contractions_bucket', buckets.contractions)
    .eq('pullback_bucket', buckets.pullback)
    .eq('industry_bucket', buckets.industry)
    .eq('market_regime', buckets.regime)
    .single();
  
  if (exactMatch && exactMatch.sample_sufficient) {
    return {
      winRate: exactMatch.win_rate,
      sampleSize: exactMatch.total_trades,
      avgReturn: exactMatch.avg_return,
      buckets,
      matchType: 'exact',
      confidence: exactMatch.total_trades >= 20 ? 'high' : 'medium'
    };
  }
  
  // Fallback: Match on most important factors (RS + regime)
  const { data: partialMatch } = await supabase
    .from('setup_win_rates')
    .select('*')
    .eq('rs_bucket', buckets.rs)
    .eq('market_regime', buckets.regime);
  
  if (partialMatch && partialMatch.length > 0) {
    const totalTrades = partialMatch.reduce((sum, r) => sum + r.total_trades, 0);
    const totalWins = partialMatch.reduce((sum, r) => sum + r.winning_trades, 0);
    const winRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : null;
    
    return {
      winRate: Math.round(winRate),
      sampleSize: totalTrades,
      buckets,
      matchType: 'partial',
      confidence: totalTrades >= 10 ? 'medium' : 'low'
    };
  }
  
  return {
    winRate: null,
    sampleSize: 0,
    buckets,
    matchType: 'none',
    confidence: 'none'
  };
}

/**
 * Adjust confidence score based on historical performance
 * 
 * @param {number} baseConfidence - Original Opus4.5 confidence (0-100)
 * @param {Object} setup - Current setup parameters
 * @returns {Promise<Object>} Adjusted confidence with breakdown
 */
export async function adjustConfidenceFromHistory(baseConfidence, setup) {
  const historical = await getHistoricalWinRate(setup);
  
  if (historical.winRate == null || historical.confidence === 'none') {
    return {
      originalConfidence: baseConfidence,
      adjustedConfidence: baseConfidence,
      adjustment: 0,
      reason: 'No historical data for this setup',
      historical
    };
  }
  
  // Calculate adjustment based on historical win rate
  // Expected win rate (baseline): ~35% for properly filtered setups
  const expectedWinRate = 35;
  const winRateDiff = historical.winRate - expectedWinRate;
  
  // Adjustment: +/- up to 15 points based on historical performance
  // Scaled by confidence in the data
  let adjustment = 0;
  if (historical.confidence === 'high') {
    adjustment = Math.round(winRateDiff * 0.3); // Max +/- 15 for 50% diff
  } else if (historical.confidence === 'medium') {
    adjustment = Math.round(winRateDiff * 0.2); // Max +/- 10
  } else {
    adjustment = Math.round(winRateDiff * 0.1); // Max +/- 5
  }
  
  // Clamp adjustment
  adjustment = Math.max(-15, Math.min(15, adjustment));
  
  const adjustedConfidence = Math.max(0, Math.min(100, baseConfidence + adjustment));
  
  // Generate reason
  let reason = '';
  if (adjustment > 0) {
    reason = `Historical win rate ${historical.winRate}% is above average (${historical.sampleSize} similar trades)`;
  } else if (adjustment < 0) {
    reason = `Historical win rate ${historical.winRate}% is below average (${historical.sampleSize} similar trades)`;
  } else {
    reason = `Historical win rate ${historical.winRate}% is near expected`;
  }
  
  return {
    originalConfidence: baseConfidence,
    adjustedConfidence,
    adjustment,
    reason,
    historical
  };
}

/**
 * Update setup win rates from trade history
 * 
 * This should be called periodically (e.g., weekly) to refresh
 * the historical win rate data from actual trade outcomes.
 */
export async function updateSetupWinRates() {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase required for win rate updates');
  }
  
  const supabase = getSupabase();
  
  // Get all closed trades with context snapshots
  const { data: trades, error: tradeError } = await supabase
    .from('trades')
    .select('id, return_pct, holding_days')
    .neq('status', 'open')
    .not('return_pct', 'is', null);
  
  if (tradeError) throw new Error(tradeError.message);
  
  const tradeIds = (trades || []).map(t => t.id);
  
  if (tradeIds.length === 0) {
    return { updated: 0, message: 'No closed trades' };
  }
  
  // Get context snapshots for these trades
  const { data: contexts, error: contextError } = await supabase
    .from('trade_context_snapshots')
    .select('*')
    .in('trade_id', tradeIds);
  
  if (contextError) throw new Error(contextError.message);
  
  // Create a map of trade_id -> context
  const contextMap = new Map((contexts || []).map(c => [c.trade_id, c]));
  
  // Aggregate by bucket combination
  const bucketAggregates = new Map();
  
  for (const trade of trades) {
    const context = contextMap.get(trade.id);
    if (!context) continue;
    
    const buckets = {
      rs: getBucket('rs', context.relative_strength),
      contractions: getBucket('contractions', context.contractions),
      pullback: getBucket('pullback', context.base_depth_pct),
      industry: getBucket('industry', context.industry_rank),
      regime: context.market_regime
    };
    
    // Skip if any critical bucket is null
    if (!buckets.rs || !buckets.regime) continue;
    
    const key = `${buckets.rs}|${buckets.contractions}|${buckets.pullback}|${buckets.industry}|${buckets.regime}`;
    
    if (!bucketAggregates.has(key)) {
      bucketAggregates.set(key, {
        buckets,
        totalTrades: 0,
        winningTrades: 0,
        totalReturn: 0,
        totalHoldingDays: 0
      });
    }
    
    const agg = bucketAggregates.get(key);
    agg.totalTrades++;
    if (trade.return_pct > 0) agg.winningTrades++;
    agg.totalReturn += trade.return_pct;
    agg.totalHoldingDays += trade.holding_days || 0;
  }
  
  // Upsert into setup_win_rates table
  const rows = [];
  for (const [_, agg] of bucketAggregates) {
    rows.push({
      rs_bucket: agg.buckets.rs,
      contractions_bucket: agg.buckets.contractions,
      pullback_bucket: agg.buckets.pullback,
      industry_bucket: agg.buckets.industry,
      market_regime: agg.buckets.regime,
      total_trades: agg.totalTrades,
      winning_trades: agg.winningTrades,
      win_rate: Math.round((agg.winningTrades / agg.totalTrades) * 100 * 10) / 10,
      avg_return: Math.round((agg.totalReturn / agg.totalTrades) * 10) / 10,
      avg_holding_days: Math.round(agg.totalHoldingDays / agg.totalTrades),
      sample_sufficient: agg.totalTrades >= 10,
      last_updated: new Date().toISOString()
    });
  }
  
  if (rows.length > 0) {
    const { error: upsertError } = await supabase
      .from('setup_win_rates')
      .upsert(rows, { 
        onConflict: 'rs_bucket,contractions_bucket,pullback_bucket,industry_bucket,market_regime' 
      });
    
    if (upsertError) throw new Error(upsertError.message);
  }
  
  console.log(`✅ Updated ${rows.length} setup win rate buckets`);
  
  return {
    updated: rows.length,
    totalTrades: trades.length
  };
}

/**
 * Apply learned weight adjustments from pattern analysis
 * 
 * @returns {Promise<Object>} New weights with changes tracked
 */
export async function applyLearnedWeights() {
  const analysis = await getLatestPatternAnalysis();
  
  if (!analysis || !analysis.suggested_weight_changes) {
    return {
      applied: false,
      reason: 'No weight suggestions available',
      weights: DEFAULT_WEIGHTS
    };
  }
  
  // Start with default weights
  const newWeights = { ...DEFAULT_WEIGHTS };
  const changes = [];
  
  // Apply suggested changes (conservatively)
  for (const suggestion of analysis.suggested_weight_changes) {
    const { weight, suggestedChange, reason } = suggestion;
    
    if (!weight || !newWeights.hasOwnProperty(weight)) continue;
    
    // Parse change (e.g., "+5 points" -> 5)
    const match = suggestedChange?.match(/([+-]?\d+)/);
    if (!match) continue;
    
    const delta = parseInt(match[1], 10);
    const oldValue = newWeights[weight];
    
    // Apply with 50% dampening (conservative)
    const actualDelta = Math.round(delta * 0.5);
    newWeights[weight] = Math.max(0, oldValue + actualDelta);
    
    changes.push({
      weight,
      oldValue,
      newValue: newWeights[weight],
      suggestedDelta: delta,
      appliedDelta: actualDelta,
      reason
    });
  }
  
  if (changes.length === 0) {
    return {
      applied: false,
      reason: 'No applicable weight changes',
      weights: DEFAULT_WEIGHTS
    };
  }
  
  // Save to weight history
  if (isSupabaseConfigured()) {
    await saveWeightHistory(DEFAULT_WEIGHTS, newWeights, changes, analysis.id);
  }
  
  return {
    applied: true,
    changes,
    previousWeights: DEFAULT_WEIGHTS,
    newWeights
  };
}

/**
 * Save weight change history to database
 */
async function saveWeightHistory(before, after, changes, analysisId) {
  const supabase = getSupabase();
  if (!supabase) return;
  
  const row = {
    change_date: new Date().toISOString(),
    change_reason: 'Pattern analysis recommendation',
    weights_before: before,
    weights_after: after,
    changes,
    triggered_by_analysis_id: analysisId
  };
  
  const { error } = await supabase
    .from('learning_weight_history')
    .insert(row);
  
  if (error) {
    console.error('Failed to save weight history:', error.message);
  }
}

/**
 * Get current effective weights (defaults + any applied adjustments)
 */
export async function getEffectiveWeights() {
  if (!isSupabaseConfigured()) {
    return {
      weights: DEFAULT_WEIGHTS,
      source: 'default',
      lastUpdated: null
    };
  }
  
  const supabase = getSupabase();
  
  // Check for recent weight changes
  const { data: history } = await supabase
    .from('learning_weight_history')
    .select('weights_after, change_date')
    .order('change_date', { ascending: false })
    .limit(1);
  
  if (history && history.length > 0) {
    return {
      weights: history[0].weights_after,
      source: 'learned',
      lastUpdated: history[0].change_date
    };
  }
  
  return {
    weights: DEFAULT_WEIGHTS,
    source: 'default',
    lastUpdated: null
  };
}

/**
 * Calculate confidence with full adaptive scoring
 * 
 * This is the main entry point that combines:
 * 1. Base Opus4.5 confidence
 * 2. Historical win rate adjustment
 * 3. Market condition modifier
 * 
 * @param {number} baseConfidence - Original confidence
 * @param {Object} setup - Full setup parameters
 * @returns {Promise<Object>} Final confidence with full breakdown
 */
export async function calculateAdaptiveConfidence(baseConfidence, setup) {
  const adjustments = [];
  let finalConfidence = baseConfidence;
  
  // Adjustment 1: Historical win rate
  const historyAdjustment = await adjustConfidenceFromHistory(baseConfidence, setup);
  if (historyAdjustment.adjustment !== 0) {
    finalConfidence += historyAdjustment.adjustment;
    adjustments.push({
      type: 'historical',
      delta: historyAdjustment.adjustment,
      reason: historyAdjustment.reason
    });
  }
  
  // Adjustment 2: Market condition
  if (setup.marketRegime === 'CORRECTION') {
    const marketPenalty = -15;
    finalConfidence += marketPenalty;
    adjustments.push({
      type: 'market',
      delta: marketPenalty,
      reason: 'Market in correction (-15)'
    });
  } else if (setup.marketRegime === 'BEAR') {
    const marketPenalty = -10;
    finalConfidence += marketPenalty;
    adjustments.push({
      type: 'market',
      delta: marketPenalty,
      reason: 'Market in bear regime (-10)'
    });
  } else if (setup.marketInCorrection || setup.distributionDays >= 5) {
    const marketPenalty = -10;
    finalConfidence += marketPenalty;
    adjustments.push({
      type: 'market',
      delta: marketPenalty,
      reason: `${setup.distributionDays} distribution days (-10)`
    });
  }
  
  // Clamp to 0-100
  finalConfidence = Math.max(0, Math.min(100, Math.round(finalConfidence)));
  
  return {
    baseConfidence,
    finalConfidence,
    totalAdjustment: finalConfidence - baseConfidence,
    adjustments,
    historicalData: historyAdjustment.historical
  };
}

export { getBucket, BUCKETS };
