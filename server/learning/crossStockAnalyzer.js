/**
 * Cross-Stock Pattern Analyzer
 * 
 * This is the CORE learning engine that analyzes patterns ACROSS all stocks,
 * not just within a single stock. It finds what VCP setup characteristics
 * correlate with winning trades across the entire universe.
 * 
 * Key questions answered:
 * - What RS range produces the highest win rate?
 * - How many contractions are optimal?
 * - What pullback depth works best?
 * - What 10 MA slope predicts success?
 * - What breakout volume ratio is required?
 * - How does market regime affect outcomes?
 * 
 * This enables OPTIMIZATION of Minervini VCP setups based on real data.
 */

import { getSupabase, isSupabaseConfigured } from '../supabase.js';

/**
 * Factor definitions for analysis
 * Each factor is bucketed for comparison
 */
const FACTORS = {
  // Relative Strength buckets
  relativeStrength: {
    name: 'Relative Strength',
    buckets: [
      { label: '95+', test: v => v >= 95, ideal: true },
      { label: '90-95', test: v => v >= 90 && v < 95 },
      { label: '85-90', test: v => v >= 85 && v < 90 },
      { label: '80-85', test: v => v >= 80 && v < 85 },
      { label: '75-80', test: v => v >= 75 && v < 80 },
      { label: '70-75', test: v => v >= 70 && v < 75 },
      { label: '<70', test: v => v < 70 }
    ],
    higherIsBetter: true
  },
  
  // Contraction count
  contractions: {
    name: 'Contractions',
    buckets: [
      { label: '5+', test: v => v >= 5, ideal: true },
      { label: '4', test: v => v === 4 },
      { label: '3', test: v => v === 3 },
      { label: '2', test: v => v === 2 },
      { label: '1', test: v => v === 1 },
      { label: '0', test: v => v === 0 }
    ],
    higherIsBetter: true
  },
  
  // Base depth (pullback from high)
  baseDepthPct: {
    name: 'Base Depth',
    buckets: [
      { label: '<10%', test: v => v < 10, ideal: true },
      { label: '10-15%', test: v => v >= 10 && v < 15 },
      { label: '15-20%', test: v => v >= 15 && v < 20 },
      { label: '20-25%', test: v => v >= 20 && v < 25 },
      { label: '25-30%', test: v => v >= 25 && v < 30 },
      { label: '30-35%', test: v => v >= 30 && v < 35 },
      { label: '35%+', test: v => v >= 35 }
    ],
    higherIsBetter: false
  },
  
  // Pullback from recent high (entry quality)
  pullbackPct: {
    name: 'Pullback % (Entry Quality)',
    buckets: [
      { label: '0-2%', test: v => v >= 0 && v <= 2, ideal: true },
      { label: '2-4%', test: v => v > 2 && v <= 4 },
      { label: '4-6%', test: v => v > 4 && v <= 6 },
      { label: '6-8%', test: v => v > 6 && v <= 8 },
      { label: '8-10%', test: v => v > 8 && v <= 10 },
      { label: '10%+', test: v => v > 10 }
    ],
    higherIsBetter: false
  },
  
  // 10 MA slope (momentum)
  ma10Slope14d: {
    name: '10 MA Slope (14d)',
    buckets: [
      { label: '10%+', test: v => v >= 10, ideal: true },
      { label: '7-10%', test: v => v >= 7 && v < 10 },
      { label: '5-7%', test: v => v >= 5 && v < 7 },
      { label: '4-5%', test: v => v >= 4 && v < 5 },
      { label: '3-4%', test: v => v >= 3 && v < 4 },
      { label: '<3%', test: v => v < 3 }
    ],
    higherIsBetter: true
  },
  
  // Breakout volume ratio
  breakoutVolumeRatio: {
    name: 'Breakout Volume Ratio',
    buckets: [
      { label: '2.5x+', test: v => v >= 2.5, ideal: true },
      { label: '2.0-2.5x', test: v => v >= 2.0 && v < 2.5 },
      { label: '1.5-2.0x', test: v => v >= 1.5 && v < 2.0 },
      { label: '1.4-1.5x', test: v => v >= 1.4 && v < 1.5 },
      { label: '1.2-1.4x', test: v => v >= 1.2 && v < 1.4 },
      { label: '1.0-1.2x', test: v => v >= 1.0 && v < 1.2 },
      { label: '<1.0x', test: v => v < 1.0 }
    ],
    higherIsBetter: true
  },
  
  // Distance from 52-week high
  pctFromHigh: {
    name: '% From 52-Week High',
    buckets: [
      { label: '<5%', test: v => v < 5, ideal: true },
      { label: '5-10%', test: v => v >= 5 && v < 10 },
      { label: '10-15%', test: v => v >= 10 && v < 15 },
      { label: '15-20%', test: v => v >= 15 && v < 20 },
      { label: '20-25%', test: v => v >= 20 && v < 25 },
      { label: '25%+', test: v => v >= 25 }
    ],
    higherIsBetter: false
  },
  
  // Pattern confidence
  patternConfidence: {
    name: 'Pattern Confidence',
    buckets: [
      { label: '90%+', test: v => v >= 90, ideal: true },
      { label: '80-90%', test: v => v >= 80 && v < 90 },
      { label: '70-80%', test: v => v >= 70 && v < 80 },
      { label: '60-70%', test: v => v >= 60 && v < 70 },
      { label: '50-60%', test: v => v >= 50 && v < 60 },
      { label: '<50%', test: v => v < 50 }
    ],
    higherIsBetter: true
  },
  
  // Opus4.5 confidence
  opus45Confidence: {
    name: 'Opus4.5 Confidence',
    buckets: [
      { label: '90+', test: v => v >= 90, ideal: true },
      { label: '80-90', test: v => v >= 80 && v < 90 },
      { label: '70-80', test: v => v >= 70 && v < 80 },
      { label: '60-70', test: v => v >= 60 && v < 70 },
      { label: '50-60', test: v => v >= 50 && v < 60 },
      { label: '<50', test: v => v < 50 }
    ],
    higherIsBetter: true
  }
};

/**
 * Get bucket label for a value
 */
function getBucketLabel(factorName, value) {
  if (value == null) return 'Unknown';
  
  const factor = FACTORS[factorName];
  if (!factor) return 'Unknown';
  
  for (const bucket of factor.buckets) {
    if (bucket.test(value)) return bucket.label;
  }
  return 'Unknown';
}

/**
 * Calculate expectancy for a set of signals:
 *   expectancy = (winRate/100) * avgWin + (1 - winRate/100) * avgLoss
 * avgLoss is negative, so this is the expected return per trade.
 */
export function calculateExpectancy(signals) {
  if (!signals || signals.length === 0) return 0;
  const winners = signals.filter(s => s.returnPct > 0);
  const losers = signals.filter(s => s.returnPct <= 0);
  const winRate = winners.length / signals.length;
  const avgWin = winners.length > 0
    ? winners.reduce((sum, s) => sum + s.returnPct, 0) / winners.length
    : 0;
  const avgLoss = losers.length > 0
    ? losers.reduce((sum, s) => sum + s.returnPct, 0) / losers.length
    : 0;
  return Math.round(((winRate * avgWin) + ((1 - winRate) * avgLoss)) * 100) / 100;
}

/**
 * Compute full metrics for a set of signals in one pass
 */
export function computeSignalMetrics(signals) {
  if (!signals || signals.length === 0) {
    return {
      totalSignals: 0,
      tradeCount: 0,
      winRate: 0,
      avgReturn: 0,
      avgWin: 0,
      avgLoss: 0,
      expectancy: 0,
      profitFactor: 0,
      maxDrawdownPct: 0,
      sharpe: 0,
      sortino: 0,
    };
  }
  const winners = signals.filter(s => s.returnPct > 0);
  const losers = signals.filter(s => s.returnPct <= 0);
  const winRate = Math.round((winners.length / signals.length) * 100 * 10) / 10;
  const avgReturn = Math.round(signals.reduce((sum, s) => sum + s.returnPct, 0) / signals.length * 10) / 10;
  const avgWin = winners.length > 0
    ? Math.round(winners.reduce((sum, s) => sum + s.returnPct, 0) / winners.length * 10) / 10
    : 0;
  const avgLoss = losers.length > 0
    ? Math.round(losers.reduce((sum, s) => sum + s.returnPct, 0) / losers.length * 10) / 10
    : 0;
  const expectancy = Math.round(((winRate / 100) * avgWin + (1 - winRate / 100) * avgLoss) * 100) / 100;
  const totalLoss = Math.abs(losers.reduce((sum, s) => sum + s.returnPct, 0));
  const totalWin = winners.reduce((sum, s) => sum + s.returnPct, 0);
  const profitFactor = totalLoss > 0 ? Math.round((totalWin / totalLoss) * 100) / 100 : 0;

  // Risk metrics
  const returns = signals.map(s => s.returnPct || 0);
  const mean = returns.reduce((sum, v) => sum + v, 0) / returns.length;
  const variance = returns.reduce((sum, v) => sum + (v - mean) ** 2, 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  const sharpe = stdDev > 0 ? Math.round((mean / stdDev) * 100) / 100 : 0;

  const downside = returns.filter(v => v < 0);
  const downsideVariance = downside.length > 0
    ? downside.reduce((sum, v) => sum + (v ** 2), 0) / downside.length
    : 0;
  const downsideDev = Math.sqrt(downsideVariance);
  const sortino = downsideDev > 0
    ? Math.round((mean / downsideDev) * 100) / 100
    : (mean > 0 ? 99 : 0);

  // Max drawdown from equity curve (ordered by entry date when available)
  const dated = signals.map((s, idx) => {
    const date = s.entryDate || s.entry_date || null;
    const ts = date ? new Date(date).getTime() : NaN;
    return { s, idx, ts };
  });
  dated.sort((a, b) => {
    const at = Number.isFinite(a.ts) ? a.ts : Number.POSITIVE_INFINITY;
    const bt = Number.isFinite(b.ts) ? b.ts : Number.POSITIVE_INFINITY;
    if (at === bt) return a.idx - b.idx;
    return at - bt;
  });

  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  for (const { s } of dated) {
    const r = (s.returnPct || 0) / 100;
    equity *= (1 + r);
    if (equity > peak) peak = equity;
    const drawdown = peak > 0 ? (peak - equity) / peak : 0;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }
  const maxDrawdownPct = Math.round(maxDrawdown * 10000) / 100;

  return {
    totalSignals: signals.length,
    tradeCount: signals.length,
    winners: winners.length,
    losers: losers.length,
    winRate,
    avgReturn,
    avgWin,
    avgLoss,
    expectancy,
    profitFactor,
    maxDrawdownPct,
    sharpe,
    sortino,
  };
}

/**
 * Analyze win rate by factor buckets across all signals
 * 
 * @param {Array} signals - All historical signals with outcomes
 * @param {string} factorName - Factor to analyze
 * @returns {Object} Win rate analysis by bucket
 */
export function analyzeFactorWinRate(signals, factorName) {
  const factor = FACTORS[factorName];
  if (!factor) return null;
  
  const bucketStats = {};
  
  // Initialize buckets
  for (const bucket of factor.buckets) {
    bucketStats[bucket.label] = {
      total: 0,
      wins: 0,
      losses: 0,
      totalReturn: 0,
      avgReturn: 0,
      winRate: 0,
      expectancy: 0,
      avgWin: 0,
      avgLoss: 0,
      ideal: bucket.ideal || false,
      _winReturns: [],
      _lossReturns: []
    };
  }
  
  // Categorize signals
  for (const signal of signals) {
    const value = signal.context?.[factorName];
    const label = getBucketLabel(factorName, value);
    
    if (!bucketStats[label]) continue;
    
    bucketStats[label].total++;
    bucketStats[label].totalReturn += signal.returnPct;
    
    if (signal.returnPct > 0) {
      bucketStats[label].wins++;
      bucketStats[label]._winReturns.push(signal.returnPct);
    } else {
      bucketStats[label].losses++;
      bucketStats[label]._lossReturns.push(signal.returnPct);
    }
  }
  
  // Calculate statistics including expectancy
  for (const label of Object.keys(bucketStats)) {
    const stats = bucketStats[label];
    if (stats.total > 0) {
      stats.winRate = Math.round((stats.wins / stats.total) * 100 * 10) / 10;
      stats.avgReturn = Math.round((stats.totalReturn / stats.total) * 10) / 10;
      stats.avgWin = stats._winReturns.length > 0
        ? Math.round(stats._winReturns.reduce((a, b) => a + b, 0) / stats._winReturns.length * 10) / 10
        : 0;
      stats.avgLoss = stats._lossReturns.length > 0
        ? Math.round(stats._lossReturns.reduce((a, b) => a + b, 0) / stats._lossReturns.length * 10) / 10
        : 0;
      const wr = stats.wins / stats.total;
      stats.expectancy = Math.round(((wr * stats.avgWin) + ((1 - wr) * stats.avgLoss)) * 100) / 100;
    }
    delete stats._winReturns;
    delete stats._lossReturns;
  }
  
  // Find optimal bucket
  let bestBucket = null;
  let bestWinRate = -1;
  
  for (const [label, stats] of Object.entries(bucketStats)) {
    if (stats.total >= 5 && stats.winRate > bestWinRate) {
      bestWinRate = stats.winRate;
      bestBucket = label;
    }
  }
  
  return {
    factor: factorName,
    factorName: factor.name,
    higherIsBetter: factor.higherIsBetter,
    buckets: bucketStats,
    bestBucket,
    bestWinRate,
    bestAvgReturn: bestBucket ? bucketStats[bestBucket].avgReturn : 0,
    bestExpectancy: bestBucket ? bucketStats[bestBucket].expectancy : 0,
    recommendation: generateFactorRecommendation(factorName, bucketStats, bestBucket)
  };
}

/**
 * Analyze factor buckets choosing the best bucket by a configurable objective.
 * 
 * @param {Array} signals - All historical signals with outcomes
 * @param {string} factorName - Factor to analyze
 * @param {'winRate'|'avgReturn'|'expectancy'} objective - Which metric to optimize
 * @returns {Object} Analysis with bestBucket chosen by the objective
 */
export function analyzeFactorByObjective(signals, factorName, objective = 'avgReturn') {
  const base = analyzeFactorWinRate(signals, factorName);
  if (!base) return null;

  let bestBucket = null;
  let bestValue = -Infinity;

  for (const [label, stats] of Object.entries(base.buckets)) {
    if (stats.total < 5) continue;
    const v = objective === 'expectancy' ? stats.expectancy
            : objective === 'avgReturn' ? stats.avgReturn
            : stats.winRate;
    if (v > bestValue) {
      bestValue = v;
      bestBucket = label;
    }
  }

  return {
    ...base,
    objective,
    bestBucket,
    bestWinRate: bestBucket ? base.buckets[bestBucket].winRate : base.bestWinRate,
    bestAvgReturn: bestBucket ? base.buckets[bestBucket].avgReturn : 0,
    bestExpectancy: bestBucket ? base.buckets[bestBucket].expectancy : 0,
    bestObjectiveValue: bestValue === -Infinity ? 0 : Math.round(bestValue * 100) / 100
  };
}

/**
 * Generate a recommendation based on factor analysis
 */
function generateFactorRecommendation(factorName, bucketStats, bestBucket) {
  const factor = FACTORS[factorName];
  if (!factor || !bestBucket) return null;
  
  const bestStats = bucketStats[bestBucket];
  
  // Find thresholds
  let recommendation = '';
  
  switch (factorName) {
    case 'relativeStrength':
      recommendation = `Require RS ${bestBucket} for highest win rate (${bestStats.winRate}%)`;
      break;
    case 'contractions':
      recommendation = `Require ${bestBucket} contractions for optimal results`;
      break;
    case 'baseDepthPct':
      recommendation = `Keep base depth ${bestBucket} for better outcomes`;
      break;
    case 'pullbackPct':
      recommendation = `Enter when pullback is ${bestBucket} for ideal timing`;
      break;
    case 'ma10Slope14d':
      recommendation = `Require 10 MA slope ${bestBucket} for momentum confirmation`;
      break;
    case 'breakoutVolumeRatio':
      recommendation = `Require volume ratio ${bestBucket} for breakout confirmation`;
      break;
    case 'pctFromHigh':
      recommendation = `Enter when ${bestBucket} from 52w high for lower overhead`;
      break;
    default:
      recommendation = `Optimal ${factor.name}: ${bestBucket}`;
  }
  
  return recommendation;
}

/**
 * Full cross-stock analysis of all factors
 * 
 * @param {Array} signals - All historical signals with outcomes
 * @param {'winRate'|'avgReturn'|'expectancy'} [objective='winRate'] - Metric to rank by
 * @returns {Object} Complete factor analysis
 */
export function analyzeAllFactors(signals, objective = 'winRate') {
  const results = {};
  
  for (const factorName of Object.keys(FACTORS)) {
    results[factorName] = objective === 'winRate'
      ? analyzeFactorWinRate(signals, factorName)
      : analyzeFactorByObjective(signals, factorName, objective);
  }
  
  // Rank factors by chosen objective
  const sortKey = objective === 'expectancy' ? 'bestExpectancy'
                : objective === 'avgReturn'  ? 'bestAvgReturn'
                : 'bestWinRate';

  const factorRanking = Object.entries(results)
    .filter(([_, r]) => r.bestBucket != null)
    .map(([name, result]) => ({
      factor: name,
      factorName: result.factorName,
      bestBucket: result.bestBucket,
      bestWinRate: result.bestWinRate,
      bestAvgReturn: result.bestAvgReturn || 0,
      bestExpectancy: result.bestExpectancy || 0,
      recommendation: result.recommendation
    }))
    .sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0));
  
  return {
    factorAnalysis: results,
    factorRanking,
    topFactors: factorRanking.slice(0, 5),
    objective
  };
}

/**
 * Find the optimal setup combination
 * 
 * @param {Array} signals - All historical signals
 * @returns {Object} Optimal setup parameters
 */
export function findOptimalSetup(signals) {
  const factorAnalysis = analyzeAllFactors(signals);
  
  // Extract optimal values for each factor
  const optimalSetup = {};
  
  for (const [factorName, analysis] of Object.entries(factorAnalysis.factorAnalysis)) {
    if (analysis.bestBucket) {
      optimalSetup[factorName] = {
        optimal: analysis.bestBucket,
        winRate: analysis.bestWinRate,
        recommendation: analysis.recommendation
      };
    }
  }
  
  // Calculate "ideal setup" win rate
  // Filter signals that match all optimal criteria
  const idealSignals = signals.filter(s => {
    const ctx = s.context;
    if (!ctx) return false;
    
    let matchCount = 0;
    let totalFactors = 0;
    
    for (const [factorName, analysis] of Object.entries(factorAnalysis.factorAnalysis)) {
      if (!analysis.bestBucket) continue;
      totalFactors++;
      
      const value = ctx[factorName];
      const bucket = getBucketLabel(factorName, value);
      if (bucket === analysis.bestBucket) matchCount++;
    }
    
    // At least 70% of factors match optimal
    return matchCount / totalFactors >= 0.7;
  });
  
  const idealWinRate = idealSignals.length > 0
    ? Math.round((idealSignals.filter(s => s.returnPct > 0).length / idealSignals.length) * 100)
    : null;
  
  return {
    optimalSetup,
    idealSignalsCount: idealSignals.length,
    idealWinRate,
    factorRanking: factorAnalysis.factorRanking,
    summary: generateOptimalSetupSummary(optimalSetup, idealWinRate)
  };
}

/**
 * Generate human-readable optimal setup summary
 */
function generateOptimalSetupSummary(optimalSetup, idealWinRate) {
  const lines = ['OPTIMAL VCP SETUP PARAMETERS:'];
  lines.push('');
  
  const priorityOrder = [
    'relativeStrength',
    'ma10Slope14d',
    'breakoutVolumeRatio',
    'contractions',
    'pullbackPct',
    'baseDepthPct',
    'pctFromHigh',
    'patternConfidence'
  ];
  
  for (const factor of priorityOrder) {
    if (optimalSetup[factor]) {
      const name = FACTORS[factor]?.name || factor;
      lines.push(`• ${name}: ${optimalSetup[factor].optimal} (${optimalSetup[factor].winRate}% win rate)`);
    }
  }
  
  if (idealWinRate) {
    lines.push('');
    lines.push(`Setups matching 70%+ of optimal criteria: ${idealWinRate}% win rate`);
  }
  
  return lines.join('\n');
}

/**
 * Analyze pattern types (VCP vs Flat Base vs Cup-with-Handle)
 * 
 * @param {Array} signals - All historical signals
 * @returns {Object} Win rate by pattern type
 */
export function analyzePatternTypes(signals) {
  const byPattern = {};
  
  for (const signal of signals) {
    const pattern = signal.pattern || signal.context?.patternType || 'Unknown';
    
    if (!byPattern[pattern]) {
      byPattern[pattern] = { total: 0, wins: 0, totalReturn: 0 };
    }
    
    byPattern[pattern].total++;
    byPattern[pattern].totalReturn += signal.returnPct;
    if (signal.returnPct > 0) byPattern[pattern].wins++;
  }
  
  // Calculate stats
  const results = [];
  for (const [pattern, stats] of Object.entries(byPattern)) {
    results.push({
      pattern,
      total: stats.total,
      wins: stats.wins,
      winRate: stats.total > 0 ? Math.round((stats.wins / stats.total) * 100) : 0,
      avgReturn: stats.total > 0 ? Math.round((stats.totalReturn / stats.total) * 10) / 10 : 0
    });
  }
  
  results.sort((a, b) => b.winRate - a.winRate);
  
  return {
    byPattern: results,
    bestPattern: results[0]?.pattern,
    bestPatternWinRate: results[0]?.winRate
  };
}

/**
 * Analyze exit types to understand what's causing losses
 * 
 * @param {Array} signals - All historical signals
 * @returns {Object} Exit type analysis
 */
export function analyzeExitTypes(signals) {
  const byExit = {};
  
  for (const signal of signals) {
    const exitType = signal.exitType || 'Unknown';
    
    if (!byExit[exitType]) {
      byExit[exitType] = { total: 0, totalReturn: 0, avgHoldingDays: 0, totalDays: 0 };
    }
    
    byExit[exitType].total++;
    byExit[exitType].totalReturn += signal.returnPct;
    byExit[exitType].totalDays += signal.holdingDays || 0;
  }
  
  const results = [];
  for (const [exitType, stats] of Object.entries(byExit)) {
    results.push({
      exitType,
      total: stats.total,
      percentage: Math.round((stats.total / signals.length) * 100),
      avgReturn: stats.total > 0 ? Math.round((stats.totalReturn / stats.total) * 10) / 10 : 0,
      avgHoldingDays: stats.total > 0 ? Math.round(stats.totalDays / stats.total) : 0
    });
  }
  
  results.sort((a, b) => b.total - a.total);
  
  return {
    byExitType: results,
    mostCommonExit: results[0]?.exitType
  };
}

/**
 * Generate weight adjustment recommendations based on analysis
 * 
 * @param {Object} factorAnalysis - Results from analyzeAllFactors
 * @returns {Array} Weight adjustment recommendations
 */
export function generateWeightRecommendations(factorAnalysis) {
  const recommendations = [];
  
  for (const [factorName, analysis] of Object.entries(factorAnalysis.factorAnalysis)) {
    if (!analysis.bestBucket) continue;
    
    // Map factors to Opus4.5 weights
    const weightMap = {
      relativeStrength: ['entryRSAbove90', 'relativeStrengthBonus'],
      contractions: ['vcpContractions3Plus', 'vcpContractions4Plus'],
      ma10Slope14d: ['slope10MAElite', 'slope10MAStrong', 'slope10MAGood'],
      breakoutVolumeRatio: ['entryVolumeConfirm'],
      pullbackPct: ['pullbackIdeal', 'pullbackGood'],
      patternConfidence: ['vcpPatternConfidence']
    };
    
    const weights = weightMap[factorName];
    if (!weights) continue;
    
    // Recommend increase for high win-rate factors
    if (analysis.bestWinRate >= 50) {
      for (const weight of weights) {
        recommendations.push({
          weight,
          factor: factorName,
          action: 'increase',
          reason: `${FACTORS[factorName].name} ${analysis.bestBucket} has ${analysis.bestWinRate}% win rate`,
          suggestedDelta: '+5'
        });
      }
    }
    
    // Recommend decrease for low win-rate factors
    if (analysis.bestWinRate < 30) {
      for (const weight of weights) {
        recommendations.push({
          weight,
          factor: factorName,
          action: 'decrease',
          reason: `${FACTORS[factorName].name} has low predictive value (${analysis.bestWinRate}%)`,
          suggestedDelta: '-3'
        });
      }
    }
  }
  
  return recommendations;
}

/**
 * Run complete cross-stock analysis and generate report
 * 
 * @param {Array} signals - All historical signals from scanner
 * @param {'winRate'|'avgReturn'|'expectancy'} [objective='winRate'] - Metric to optimize
 * @returns {Object} Complete analysis report
 */
export function runCrossStockAnalysis(signals, objective = 'winRate') {
  console.log(`📊 Running cross-stock analysis on ${signals.length} signals (objective: ${objective})...`);
  
  const factorAnalysis = analyzeAllFactors(signals, objective);
  const optimalSetup = findOptimalSetup(signals);
  const patternAnalysis = analyzePatternTypes(signals);
  const exitAnalysis = analyzeExitTypes(signals);
  const weightRecommendations = generateWeightRecommendations(factorAnalysis);
  
  const overallStats = computeSignalMetrics(signals);
  
  console.log(`✅ Analysis complete: ${overallStats.winRate}% win rate, ${overallStats.avgReturn}% avg return, ${overallStats.expectancy}% expectancy`);
  
  return {
    overallStats,
    factorAnalysis: factorAnalysis.factorAnalysis,
    factorRanking: factorAnalysis.factorRanking,
    topFactors: factorAnalysis.topFactors,
    optimalSetup: optimalSetup.optimalSetup,
    idealWinRate: optimalSetup.idealWinRate,
    optimalSummary: optimalSetup.summary,
    patternAnalysis,
    exitAnalysis,
    weightRecommendations,
    objective,
    analysisDate: new Date().toISOString()
  };
}

export { FACTORS, getBucketLabel };
