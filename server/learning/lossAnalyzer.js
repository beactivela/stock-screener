/**
 * Loss Analysis Engine
 * 
 * This is the core learning loop of the self-learning trading system.
 * 
 * For every LOSING trade, the system:
 * 1. Pulls the full trade context at entry
 * 2. Classifies the failure reason
 * 3. Stores the analysis
 * 4. After every 10 trades, runs pattern analysis
 * 5. Adjusts confidence scoring based on historical outcomes
 * 
 * The goal: Turn every loss into a lesson that improves future signals.
 */

import { getSupabase, isSupabaseConfigured } from '../supabase.js';
import { getContextSnapshotByTradeId, getContextSnapshots } from './tradeContext.js';
import { classifyFailure, getClassificationStats } from './failureClassifier.js';
import { getAllTrades } from '../trades.js';

/**
 * Analyze a single losing trade
 * 
 * This is called automatically when a trade is closed with a loss.
 * 
 * @param {Object} trade - The closed losing trade
 * @returns {Promise<Object>} Analysis result
 */
export async function analyzeLoss(trade) {
  if (!trade || trade.returnPct >= 0) {
    return { skipped: true, reason: 'Not a losing trade' };
  }
  
  console.log(`📊 Analyzing loss: ${trade.ticker} (${trade.returnPct}%)`);
  
  // Step 1: Get context snapshot
  const context = await getContextSnapshotByTradeId(trade.id);
  
  if (!context) {
    console.warn(`No context snapshot found for trade ${trade.id}`);
    return {
      tradeId: trade.id,
      ticker: trade.ticker,
      returnPct: trade.returnPct,
      analysis: 'NO_CONTEXT',
      message: 'Context snapshot not captured at entry'
    };
  }
  
  // Step 2: Classify failure
  const classification = await classifyFailure(trade);
  
  // Step 3: Generate insights
  const insights = generateInsights(context, trade, classification);
  
  // Step 4: Check if we need to run pattern analysis
  const shouldAnalyzePatterns = await checkPatternAnalysisTrigger();
  
  const result = {
    tradeId: trade.id,
    ticker: trade.ticker,
    returnPct: trade.returnPct,
    holdingDays: trade.holdingDays,
    classification: classification.primaryCategory,
    confidence: classification.classificationConfidence,
    insights,
    shouldAnalyzePatterns
  };
  
  console.log(`✅ Loss analysis complete: ${classification.primaryCategory}`);
  
  return result;
}

/**
 * Generate human-readable insights from the analysis
 */
function generateInsights(context, trade, classification) {
  const insights = [];
  
  // Insight based on primary failure category
  switch (classification.primaryCategory) {
    case 'MARKET_CONDITION':
      insights.push({
        type: 'warning',
        message: 'Avoid new longs when market shows weakness',
        action: 'Check distribution day count before entering',
        data: {
          distributionDays: context.spyDistributionDays,
          marketRegime: context.marketRegime
        }
      });
      break;
      
    case 'FALSE_BREAKOUT':
      insights.push({
        type: 'rule',
        message: 'Volume confirmation is critical',
        action: 'Require 40%+ above average volume on breakout',
        data: {
          breakoutVolume: context.breakoutVolumeRatio,
          confirmed: context.breakoutConfirmed
        }
      });
      break;
      
    case 'WEAK_BASE':
      insights.push({
        type: 'filter',
        message: 'Base quality matters more than pattern recognition',
        action: 'Require minimum 5 weeks and <35% depth',
        data: {
          baseDepth: context.baseDepthPct,
          baseDuration: context.baseDurationDays
        }
      });
      break;
      
    case 'LOW_RS':
      insights.push({
        type: 'filter',
        message: 'RS < 80 has lower win rate',
        action: 'Prioritize RS 90+ stocks',
        data: {
          rs: context.relativeStrength
        }
      });
      break;
      
    case 'EARLY_ENTRY':
      insights.push({
        type: 'timing',
        message: 'Wait for proper pivot completion',
        action: 'Do not enter below pivot price',
        data: {
          entryVsPivot: context.entryVsPivotPct,
          patternConfidence: context.patternConfidence
        }
      });
      break;
      
    case 'STOP_LOSS_TOO_TIGHT':
      insights.push({
        type: 'sizing',
        message: 'This may be normal volatility, not a setup failure',
        action: 'Consider if setup was correct but stop too tight',
        data: {
          returnPct: trade.returnPct,
          holdingDays: trade.holdingDays
        }
      });
      break;
      
    default:
      insights.push({
        type: 'review',
        message: 'Manual review recommended',
        action: 'Check chart and entry criteria manually'
      });
  }
  
  // Additional context-specific insights
  if (context.marketInCorrection && classification.primaryCategory !== 'MARKET_CONDITION') {
    insights.push({
      type: 'note',
      message: 'Market was in correction - this may have contributed',
      severity: 'medium'
    });
  }
  
  if (context.industryRank > 50) {
    insights.push({
      type: 'note',
      message: `Industry rank was weak (#${context.industryRank})`,
      severity: 'low'
    });
  }
  
  return insights;
}

/**
 * Check if we should trigger pattern analysis
 * (Every 10 closed trades)
 */
async function checkPatternAnalysisTrigger() {
  if (!isSupabaseConfigured()) return false;
  
  const supabase = getSupabase();
  
  // Count closed trades
  const { count } = await supabase
    .from('trades')
    .select('*', { count: 'exact', head: true })
    .neq('status', 'open');
  
  // Get last pattern analysis
  const { data: lastAnalysis } = await supabase
    .from('pattern_analysis')
    .select('total_trades_analyzed')
    .order('analysis_date', { ascending: false })
    .limit(1);
  
  const lastCount = lastAnalysis?.[0]?.total_trades_analyzed || 0;
  
  // Trigger if 10+ new trades since last analysis
  return (count - lastCount) >= 10;
}

/**
 * Analyze patterns across all losing trades
 * 
 * This runs after every 10 trades to find:
 * - Which failure categories are most common
 * - What conditions correlate with wins vs losses
 * - Suggested weight adjustments
 * 
 * @returns {Promise<Object>} Pattern analysis results
 */
export async function analyzePatterns() {
  console.log('📈 Running pattern analysis across all trades...');
  
  // Get all closed trades with context
  const trades = await getAllTrades();
  const closedTrades = trades.filter(t => t.status !== 'open' && t.returnPct != null);
  
  if (closedTrades.length < 10) {
    return {
      error: 'Need at least 10 closed trades for pattern analysis',
      tradesAvailable: closedTrades.length
    };
  }
  
  const winners = closedTrades.filter(t => t.returnPct > 0);
  const losers = closedTrades.filter(t => t.returnPct <= 0);
  
  // Get failure classification stats
  const failureStats = await getClassificationStats();
  
  // Get all context snapshots
  const contexts = await getContextSnapshots();
  const contextByTradeId = new Map(contexts.map(c => [c.tradeId, c]));
  
  // Analyze correlations
  const correlations = analyzeCorrelations(closedTrades, contextByTradeId);
  
  // Find optimal ranges for entry criteria
  const optimalRanges = findOptimalRanges(winners, losers, contextByTradeId);
  
  // Analyze market condition impact
  const marketImpact = analyzeMarketImpact(closedTrades, contextByTradeId);
  
  // Generate weight adjustment suggestions
  const suggestedWeights = suggestWeightAdjustments(correlations, failureStats);
  
  // Generate insights summary
  const insightsSummary = generatePatternInsights(
    failureStats,
    correlations,
    optimalRanges,
    marketImpact
  );
  
  const analysis = {
    analysisDate: new Date().toISOString().slice(0, 10),
    analysisType: 'periodic',
    totalTradesAnalyzed: closedTrades.length,
    winningTrades: winners.length,
    losingTrades: losers.length,
    winRate: Math.round((winners.length / closedTrades.length) * 100 * 10) / 10,
    failureCategoryCounts: failureStats?.byCategory || {},
    winCorrelations: correlations.winFactors,
    lossCorrelations: correlations.lossFactors,
    topWinPredictors: correlations.topWinPredictors,
    topLossPredictors: correlations.topLossPredictors,
    optimalRsRange: optimalRanges.rs,
    optimalContractions: optimalRanges.contractions,
    optimalPullbackDepth: optimalRanges.pullbackDepth,
    optimalBaseDuration: optimalRanges.baseDuration,
    optimalIndustryRank: optimalRanges.industryRank,
    marketConditionImpact: marketImpact,
    suggestedWeightChanges: suggestedWeights,
    insightsSummary,
    sampleSize: closedTrades.length,
    statisticalConfidence: calculateStatisticalConfidence(closedTrades.length)
  };
  
  // Save to database
  if (isSupabaseConfigured()) {
    await savePatternAnalysis(analysis);
  }
  
  console.log('✅ Pattern analysis complete');
  
  return analysis;
}

/**
 * Analyze what factors correlate with wins vs losses
 */
function analyzeCorrelations(trades, contextByTradeId) {
  const factors = [
    'relativeStrength',
    'contractions',
    'baseDepthPct',
    'baseDurationDays',
    'breakoutVolumeRatio',
    'industryRank',
    'ma10Slope14d',
    'patternConfidence',
    'opus45Confidence'
  ];
  
  const winFactors = {};
  const lossFactors = {};
  
  for (const factor of factors) {
    const winValues = [];
    const lossValues = [];
    
    for (const trade of trades) {
      const context = contextByTradeId.get(trade.id);
      if (!context || context[factor] == null) continue;
      
      if (trade.returnPct > 0) {
        winValues.push(context[factor]);
      } else {
        lossValues.push(context[factor]);
      }
    }
    
    if (winValues.length > 0 && lossValues.length > 0) {
      const winAvg = winValues.reduce((a, b) => a + b, 0) / winValues.length;
      const lossAvg = lossValues.reduce((a, b) => a + b, 0) / lossValues.length;
      
      winFactors[factor] = Math.round(winAvg * 10) / 10;
      lossFactors[factor] = Math.round(lossAvg * 10) / 10;
    }
  }
  
  // Rank by correlation strength
  const correlationStrength = [];
  for (const factor of factors) {
    if (winFactors[factor] != null && lossFactors[factor] != null) {
      const diff = winFactors[factor] - lossFactors[factor];
      const avgValue = (winFactors[factor] + lossFactors[factor]) / 2;
      const normalizedDiff = avgValue !== 0 ? Math.abs(diff / avgValue) : 0;
      
      correlationStrength.push({
        factor,
        winAvg: winFactors[factor],
        lossAvg: lossFactors[factor],
        diff,
        strength: Math.round(normalizedDiff * 100)
      });
    }
  }
  
  correlationStrength.sort((a, b) => b.strength - a.strength);
  
  return {
    winFactors,
    lossFactors,
    topWinPredictors: correlationStrength.filter(c => c.diff > 0).slice(0, 5),
    topLossPredictors: correlationStrength.filter(c => c.diff < 0).slice(0, 5)
  };
}

/**
 * Find optimal ranges for entry criteria based on winning trades
 */
function findOptimalRanges(winners, losers, contextByTradeId) {
  const getValues = (trades, factor) => {
    return trades
      .map(t => contextByTradeId.get(t.id)?.[factor])
      .filter(v => v != null);
  };
  
  const calculateOptimal = (winValues, lossValues) => {
    if (winValues.length === 0) return null;
    
    winValues.sort((a, b) => a - b);
    const min = winValues[Math.floor(winValues.length * 0.1)];
    const max = winValues[Math.floor(winValues.length * 0.9)];
    const ideal = winValues[Math.floor(winValues.length * 0.5)];
    
    return {
      min: Math.round(min * 10) / 10,
      max: Math.round(max * 10) / 10,
      ideal: Math.round(ideal * 10) / 10,
      sampleSize: winValues.length
    };
  };
  
  return {
    rs: calculateOptimal(
      getValues(winners, 'relativeStrength'),
      getValues(losers, 'relativeStrength')
    ),
    contractions: calculateOptimal(
      getValues(winners, 'contractions'),
      getValues(losers, 'contractions')
    ),
    pullbackDepth: calculateOptimal(
      getValues(winners, 'baseDepthPct'),
      getValues(losers, 'baseDepthPct')
    ),
    baseDuration: calculateOptimal(
      getValues(winners, 'baseDurationDays'),
      getValues(losers, 'baseDurationDays')
    ),
    industryRank: {
      maxAcceptable: 40,
      idealMax: 20
    }
  };
}

/**
 * Analyze how market regime affects win rate
 */
function analyzeMarketImpact(trades, contextByTradeId) {
  const byRegime = {};
  
  for (const trade of trades) {
    const context = contextByTradeId.get(trade.id);
    if (!context?.marketRegime) continue;
    
    const regime = context.marketRegime;
    if (!byRegime[regime]) {
      byRegime[regime] = { total: 0, wins: 0, totalReturn: 0 };
    }
    
    byRegime[regime].total++;
    if (trade.returnPct > 0) byRegime[regime].wins++;
    byRegime[regime].totalReturn += trade.returnPct;
  }
  
  const result = {};
  for (const [regime, data] of Object.entries(byRegime)) {
    result[regime] = {
      trades: data.total,
      winRate: Math.round((data.wins / data.total) * 100),
      avgReturn: Math.round((data.totalReturn / data.total) * 10) / 10
    };
  }
  
  return result;
}

/**
 * Suggest weight adjustments based on analysis
 */
function suggestWeightAdjustments(correlations, failureStats) {
  const suggestions = [];
  
  // If FALSE_BREAKOUT is top failure, increase volume confirmation weight
  if (failureStats?.byCategory?.FALSE_BREAKOUT?.percentage > 25) {
    suggestions.push({
      weight: 'entryVolumeConfirm',
      currentImpact: 'low',
      suggestedChange: '+5 points',
      reason: `${failureStats.byCategory.FALSE_BREAKOUT.percentage}% of failures are false breakouts`
    });
  }
  
  // If RS shows strong win correlation, increase RS weights
  const rsCorr = correlations.topWinPredictors.find(p => p.factor === 'relativeStrength');
  if (rsCorr && rsCorr.strength > 20) {
    suggestions.push({
      weight: 'entryRSAbove90',
      currentImpact: 'medium',
      suggestedChange: '+3 points',
      reason: `RS shows ${rsCorr.strength}% correlation with wins`
    });
  }
  
  // If MARKET_CONDITION is top failure, suggest regime filtering
  if (failureStats?.byCategory?.MARKET_CONDITION?.percentage > 20) {
    suggestions.push({
      weight: 'marketRegimeFilter',
      currentImpact: 'none',
      suggestedChange: 'Add -20 points in CORRECTION',
      reason: `${failureStats.byCategory.MARKET_CONDITION.percentage}% of failures due to market`
    });
  }
  
  // If slope shows strong correlation, adjust slope weights
  const slopeCorr = correlations.topWinPredictors.find(p => p.factor === 'ma10Slope14d');
  if (slopeCorr && slopeCorr.strength > 15) {
    suggestions.push({
      weight: 'slope10MAElite',
      currentImpact: 'high',
      suggestedChange: '+5 points',
      reason: `Slope shows ${slopeCorr.strength}% correlation with wins`
    });
  }
  
  return suggestions;
}

/**
 * Generate human-readable insights from pattern analysis
 */
function generatePatternInsights(failureStats, correlations, optimalRanges, marketImpact) {
  const insights = [];
  
  // Top failure category insight
  if (failureStats?.topCategory) {
    insights.push(`Most common failure: ${failureStats.topCategory} (${failureStats.byCategory[failureStats.topCategory]?.percentage}%)`);
  }
  
  // Top win predictor
  if (correlations.topWinPredictors[0]) {
    const top = correlations.topWinPredictors[0];
    insights.push(`Best win predictor: ${top.factor} (winners avg ${top.winAvg} vs losers ${top.lossAvg})`);
  }
  
  // Market impact
  const bestRegime = Object.entries(marketImpact)
    .sort((a, b) => b[1].winRate - a[1].winRate)[0];
  if (bestRegime) {
    insights.push(`Best market regime: ${bestRegime[0]} (${bestRegime[1].winRate}% win rate)`);
  }
  
  // Optimal RS
  if (optimalRanges.rs) {
    insights.push(`Optimal RS range: ${optimalRanges.rs.min}-${optimalRanges.rs.max} (ideal: ${optimalRanges.rs.ideal})`);
  }
  
  return insights.join('\n');
}

/**
 * Calculate statistical confidence based on sample size
 */
function calculateStatisticalConfidence(sampleSize) {
  if (sampleSize < 10) return 10;
  if (sampleSize < 30) return 30;
  if (sampleSize < 50) return 50;
  if (sampleSize < 100) return 70;
  return 90;
}

/**
 * Save pattern analysis to database
 */
async function savePatternAnalysis(analysis) {
  const supabase = getSupabase();
  if (!supabase) return;
  
  const row = {
    analysis_date: analysis.analysisDate,
    analysis_type: analysis.analysisType,
    total_trades_analyzed: analysis.totalTradesAnalyzed,
    winning_trades: analysis.winningTrades,
    losing_trades: analysis.losingTrades,
    win_rate: analysis.winRate,
    failure_category_counts: analysis.failureCategoryCounts,
    win_correlations: analysis.winCorrelations,
    loss_correlations: analysis.lossCorrelations,
    top_win_predictors: analysis.topWinPredictors,
    top_loss_predictors: analysis.topLossPredictors,
    optimal_rs_range: analysis.optimalRsRange,
    optimal_contractions: analysis.optimalContractions,
    optimal_pullback_depth: analysis.optimalPullbackDepth,
    optimal_base_duration: analysis.optimalBaseDuration,
    optimal_industry_rank: analysis.optimalIndustryRank,
    market_condition_impact: analysis.marketConditionImpact,
    suggested_weight_changes: analysis.suggestedWeightChanges,
    insights_summary: analysis.insightsSummary,
    sample_size: analysis.sampleSize,
    statistical_confidence: analysis.statisticalConfidence
  };
  
  const { error } = await supabase
    .from('pattern_analysis')
    .insert(row);
  
  if (error) {
    console.error('Failed to save pattern analysis:', error.message);
  }
}

/**
 * Get latest pattern analysis
 */
export async function getLatestPatternAnalysis() {
  if (!isSupabaseConfigured()) return null;
  
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('pattern_analysis')
    .select('*')
    .order('analysis_date', { ascending: false })
    .limit(1)
    .single();
  
  if (error) return null;
  return data;
}

export { generateInsights, analyzeCorrelations, findOptimalRanges };
