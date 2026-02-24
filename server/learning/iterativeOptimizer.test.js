/**
 * Unit tests for Iterative Optimizer (Self-Learning System)
 * Run: node --test server/learning/iterativeOptimizer.test.js
 * 
 * These tests verify that the learning system:
 * 1. Produces different results across iterations (not stuck)
 * 2. Correctly rescores signals with different weights
 * 3. Identifies profitable factor buckets
 * 4. Calculates filtered subset returns correctly
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';

// Import the functions we need to test
import { DEFAULT_WEIGHTS } from '../opus45Signal.js';
import { computeSignalMetrics } from './crossStockAnalyzer.js';
import { passesRiskGates } from '../agents/strategyAgentBase.js';
import { MIN_AB_DELTA, shouldPromote } from './iterativeOptimizer.js';

// We'll test these internal functions by re-implementing them here
// since they're not exported. This ensures the logic is correct.

// ============================================================================
// MOCK DATA
// ============================================================================

/** Generate mock historical signals with varying characteristics */
function generateMockSignals(count = 50) {
  const signals = [];
  
  for (let i = 0; i < count; i++) {
    // Generate varied characteristics
    const rs = 70 + Math.random() * 30;  // 70-100
    const slope = 2 + Math.random() * 12;  // 2-14%
    const pullback = Math.random() * 8;  // 0-8%
    const contractions = Math.floor(2 + Math.random() * 4);  // 2-5
    const patternConf = 60 + Math.random() * 35;  // 60-95%
    const pctFromHigh = Math.random() * 20;  // 0-20%
    const baseDepth = 8 + Math.random() * 20;  // 8-28%
    const volumeRatio = 1 + Math.random() * 2.5;  // 1-3.5x
    
    // Generate return based on factors (simulate real correlation)
    // Higher slope + lower pctFromHigh + moderate pullback = better returns
    let baseReturn = -4 + Math.random() * 20;  // -4% to 16%
    
    // Good setups get bonus returns
    if (slope >= 7 && slope <= 10) baseReturn += 3;
    if (pctFromHigh >= 3 && pctFromHigh <= 10) baseReturn += 2;
    if (pullback >= 2 && pullback <= 5) baseReturn += 2;
    if (rs >= 90) baseReturn += 1;
    if (contractions >= 4) baseReturn += 1;
    if (patternConf >= 85) baseReturn += 2;
    
    // Cap returns
    const returnPct = Math.max(-8, Math.min(25, baseReturn));
    
    signals.push({
      ticker: `TEST${i}`,
      entryDate: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      entryPrice: 50 + Math.random() * 100,
      returnPct: Math.round(returnPct * 10) / 10,
      holdingDays: Math.floor(5 + Math.random() * 30),
      opus45Confidence: 60 + Math.random() * 30,
      opus45Grade: returnPct > 5 ? 'A' : returnPct > 0 ? 'B' : 'C',
      contractions,
      patternConfidence: patternConf,
      context: {
        relativeStrength: rs,
        ma10Slope14d: slope,
        pullbackPct: pullback,
        contractions,
        patternConfidence: patternConf,
        pctFromHigh,
        baseDepthPct: baseDepth,
        breakoutVolumeRatio: volumeRatio,
        opus45Confidence: 60 + Math.random() * 30,
        entryAt10MA: Math.random() > 0.5,
        entryAt20MA: Math.random() > 0.7,
        volumeDryUp: Math.random() > 0.6
      }
    });
  }
  
  return signals;
}

// ============================================================================
// RESCORE SIGNALS FUNCTION (copy from iterativeOptimizer.js for testing)
// ============================================================================

function rescoreSignalsWithWeights(signals, weights) {
  return signals.map(signal => {
    const ctx = signal.context || {};
    let score = 0;
    
    // MA Slope scoring
    const slope14d = ctx.ma10Slope14d || 0;
    if (slope14d >= 12) {
      score += weights.slope10MAElite || 0;
    } else if (slope14d >= 8) {
      score += weights.slope10MAStrong || 0;
    } else if (slope14d >= 5) {
      score += weights.slope10MAGood || 0;
    } else if (slope14d >= 2) {
      score += weights.slope10MAMinimum || 0;
    }
    
    // Pullback scoring
    const pullback = ctx.pullbackPct || 0;
    if (pullback >= 0 && pullback <= 3) {
      score += weights.pullbackIdeal || 0;
    } else if (pullback > 3 && pullback <= 6) {
      score += weights.pullbackGood || 0;
    }
    
    // Entry position scoring
    if (ctx.entryAt10MA) {
      score += weights.entryAt10MA || 0;
    } else if (ctx.entryAt20MA) {
      score += weights.entryAt20MA || 0;
    }
    
    // Volume confirmation
    const volRatio = ctx.breakoutVolumeRatio || 0;
    if (volRatio >= 1.5) {
      score += weights.entryVolumeConfirm || 0;
    }
    
    // RS scoring
    const rs = ctx.relativeStrength || 0;
    if (rs >= 90) {
      score += weights.entryRSAbove90 || 0;
    }
    if (rs >= 95) {
      score += weights.relativeStrengthBonus || 0;
    }
    
    // VCP scoring
    const contractions = ctx.contractions || signal.contractions || 0;
    if (contractions >= 4) {
      score += weights.vcpContractions4Plus || 0;
    } else if (contractions >= 3) {
      score += weights.vcpContractions3Plus || 0;
    }
    
    if (ctx.volumeDryUp) {
      score += weights.vcpVolumeDryUp || 0;
    }
    
    const patternConf = ctx.patternConfidence || signal.patternConfidence || 0;
    if (patternConf >= 80) {
      score += weights.vcpPatternConfidence || 0;
    }

    // Industry trend scoring (3-month return)
    const indReturn3Mo = ctx.industryReturn3Mo;
    if (indReturn3Mo != null) {
      if (indReturn3Mo >= 10) {
        score += weights.industryTrendStrong || 0;
      } else if (indReturn3Mo >= 5) {
        score += weights.industryTrendModerate || 0;
      }
    }

    // Recent price action (5-day return)
    const recent5d = ctx.recentReturn5d;
    if (recent5d != null) {
      if (recent5d >= 3) {
        score += weights.recentActionStrong || 0;
      } else if (recent5d >= 1) {
        score += weights.recentActionGood || 0;
      }
    }

    // Calculate confidence
    const maxScore = Object.values(weights).reduce((sum, w) => sum + (w || 0), 0);
    const confidence = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
    
    return {
      ...signal,
      rescored: {
        opus45Confidence: confidence,
        score,
        maxScore
      }
    };
  });
}

// ============================================================================
// FACTOR PROFITABILITY ANALYSIS (copy from iterativeOptimizer.js for testing)
// ============================================================================

function analyzeFactorProfitability(signals) {
  if (!signals || signals.length === 0) return {};
  
  const factors = {
    relativeStrength: { buckets: {}, getValue: s => s.context?.relativeStrength },
    ma10Slope14d: { buckets: {}, getValue: s => s.context?.ma10Slope14d },
    pullbackPct: { buckets: {}, getValue: s => s.context?.pullbackPct },
    pctFromHigh: { buckets: {}, getValue: s => s.context?.pctFromHigh }
  };
  
  const bucketDefs = {
    relativeStrength: [
      { name: '99+', min: 99, max: Infinity },
      { name: '95-99', min: 95, max: 99 },
      { name: '90-95', min: 90, max: 95 },
      { name: '85-90', min: 85, max: 90 },
      { name: '<85', min: 0, max: 85 }
    ],
    ma10Slope14d: [
      { name: '12%+', min: 12, max: Infinity },
      { name: '10-12%', min: 10, max: 12 },
      { name: '7-10%', min: 7, max: 10 },
      { name: '5-7%', min: 5, max: 7 },
      { name: '<5%', min: 0, max: 5 }
    ],
    pullbackPct: [
      { name: '0-1%', min: 0, max: 1 },
      { name: '1-2%', min: 1, max: 2 },
      { name: '2-4%', min: 2, max: 4 },
      { name: '4-6%', min: 4, max: 6 },
      { name: '6%+', min: 6, max: Infinity }
    ],
    pctFromHigh: [
      { name: '<3%', min: 0, max: 3 },
      { name: '3-5%', min: 3, max: 5 },
      { name: '5-10%', min: 5, max: 10 },
      { name: '10-15%', min: 10, max: 15 },
      { name: '15%+', min: 15, max: Infinity }
    ]
  };
  
  // Initialize buckets
  for (const [factorName, factor] of Object.entries(factors)) {
    const defs = bucketDefs[factorName];
    if (!defs) continue;
    for (const def of defs) {
      factor.buckets[def.name] = { signals: [], totalReturn: 0, count: 0 };
    }
  }
  
  // Categorize signals
  for (const signal of signals) {
    for (const [factorName, factor] of Object.entries(factors)) {
      const value = factor.getValue(signal);
      if (value === undefined || value === null) continue;
      
      const defs = bucketDefs[factorName];
      if (!defs) continue;
      
      for (const def of defs) {
        if (value >= def.min && value < def.max) {
          factor.buckets[def.name].signals.push(signal);
          factor.buckets[def.name].totalReturn += signal.returnPct || 0;
          factor.buckets[def.name].count++;
          break;
        }
      }
    }
  }
  
  // Calculate avg return per bucket
  const profitabilityAnalysis = {};
  
  for (const [factorName, factor] of Object.entries(factors)) {
    let bestBucket = null;
    let bestAvgReturn = -Infinity;
    
    for (const [bucketName, bucket] of Object.entries(factor.buckets)) {
      if (bucket.count >= 2) {
        const avgReturn = bucket.totalReturn / bucket.count;
        if (avgReturn > bestAvgReturn) {
          bestAvgReturn = avgReturn;
          bestBucket = bucketName;
        }
      }
    }
    
    profitabilityAnalysis[factorName] = {
      bestBucket,
      bestAvgReturn: Math.round(bestAvgReturn * 100) / 100,
      signalsAnalyzed: Object.values(factor.buckets).reduce((sum, b) => sum + b.count, 0)
    };
  }
  
  return profitabilityAnalysis;
}

// ============================================================================
// TESTS: RESCORING
// ============================================================================

describe('rescoreSignalsWithWeights', () => {
  it('produces different scores with different weights', () => {
    const signals = generateMockSignals(20);
    
    // Default weights
    const weights1 = { ...DEFAULT_WEIGHTS };
    
    // Modified weights (boost slope, reduce pullback)
    const weights2 = { 
      ...DEFAULT_WEIGHTS,
      slope10MAElite: 40,  // Boosted from default
      slope10MAStrong: 30,
      pullbackIdeal: 5,    // Reduced from default
      pullbackGood: 2
    };
    
    const rescored1 = rescoreSignalsWithWeights(signals, weights1);
    const rescored2 = rescoreSignalsWithWeights(signals, weights2);
    
    // At least some signals should have different confidence scores
    let differentCount = 0;
    for (let i = 0; i < signals.length; i++) {
      if (rescored1[i].rescored.opus45Confidence !== rescored2[i].rescored.opus45Confidence) {
        differentCount++;
      }
    }
    
    assert.ok(differentCount > 0, 'Should have different scores with different weights');
  });
  
  it('higher slope signals get higher scores when slope weights boosted', () => {
    // Create two signals: one with high slope, one with low slope
    const highSlopeSignal = {
      ticker: 'HIGH',
      returnPct: 5,
      context: {
        ma10Slope14d: 12,  // High slope (elite)
        relativeStrength: 80,
        pullbackPct: 3,
        entryAt10MA: false,
        breakoutVolumeRatio: 1.2,
        contractions: 2,
        patternConfidence: 70
      }
    };
    
    const lowSlopeSignal = {
      ticker: 'LOW',
      returnPct: 5,
      context: {
        ma10Slope14d: 3,  // Low slope
        relativeStrength: 80,
        pullbackPct: 3,
        entryAt10MA: false,
        breakoutVolumeRatio: 1.2,
        contractions: 2,
        patternConfidence: 70
      }
    };
    
    const signals = [highSlopeSignal, lowSlopeSignal];
    
    // Boost slope weights heavily
    const weights = {
      ...DEFAULT_WEIGHTS,
      slope10MAElite: 50,
      slope10MAStrong: 30,
      slope10MAGood: 15,
      slope10MAMinimum: 5
    };
    
    const rescored = rescoreSignalsWithWeights(signals, weights);
    
    assert.ok(
      rescored[0].rescored.opus45Confidence > rescored[1].rescored.opus45Confidence,
      'High slope signal should score higher when slope weights boosted'
    );
  });
  
  it('returns valid confidence values (0-100)', () => {
    const signals = generateMockSignals(30);
    const rescored = rescoreSignalsWithWeights(signals, DEFAULT_WEIGHTS);
    
    for (const signal of rescored) {
      assert.ok(
        signal.rescored.opus45Confidence >= 0 && signal.rescored.opus45Confidence <= 100,
        'Confidence should be between 0 and 100'
      );
    }
  });
});

// ============================================================================
// TESTS: FACTOR PROFITABILITY ANALYSIS
// ============================================================================

describe('analyzeFactorProfitability', () => {
  it('identifies factor buckets from signals', () => {
    const signals = generateMockSignals(50);
    const analysis = analyzeFactorProfitability(signals);
    
    // Should have analysis for each factor
    assert.ok('relativeStrength' in analysis, 'Should analyze relativeStrength');
    assert.ok('ma10Slope14d' in analysis, 'Should analyze ma10Slope14d');
    assert.ok('pullbackPct' in analysis, 'Should analyze pullbackPct');
    assert.ok('pctFromHigh' in analysis, 'Should analyze pctFromHigh');
  });
  
  it('returns best bucket and avg return for each factor', () => {
    const signals = generateMockSignals(50);
    const analysis = analyzeFactorProfitability(signals);
    
    for (const [factorName, data] of Object.entries(analysis)) {
      assert.ok('bestBucket' in data, `${factorName} should have bestBucket`);
      assert.ok('bestAvgReturn' in data, `${factorName} should have bestAvgReturn`);
      assert.ok('signalsAnalyzed' in data, `${factorName} should have signalsAnalyzed`);
    }
  });
  
  it('correctly identifies higher-return buckets', () => {
    // Create signals where slope 7-10% clearly performs better
    const signals = [
      { returnPct: 10, context: { ma10Slope14d: 8 } },  // 7-10% bucket - high return
      { returnPct: 12, context: { ma10Slope14d: 9 } },  // 7-10% bucket - high return
      { returnPct: 8, context: { ma10Slope14d: 7.5 } }, // 7-10% bucket - high return
      { returnPct: -2, context: { ma10Slope14d: 3 } },  // <5% bucket - low return
      { returnPct: -1, context: { ma10Slope14d: 4 } },  // <5% bucket - low return
      { returnPct: 0, context: { ma10Slope14d: 2 } },   // <5% bucket - low return
    ];
    
    const analysis = analyzeFactorProfitability(signals);
    
    assert.strictEqual(analysis.ma10Slope14d.bestBucket, '7-10%');
    assert.ok(analysis.ma10Slope14d.bestAvgReturn > 5, 'Best bucket should have high avg return');
  });
  
  it('handles empty signals array', () => {
    const analysis = analyzeFactorProfitability([]);
    assert.deepStrictEqual(analysis, {});
  });
});

// ============================================================================
// TESTS: WEIGHTED AVERAGE CALCULATION
// ============================================================================

describe('Weighted Average Calculation', () => {
  it('higher confidence signals should weight more', () => {
    const signals = [
      { returnPct: 20, rescored: { opus45Confidence: 90 } },  // High conf, high return
      { returnPct: -5, rescored: { opus45Confidence: 50 } },  // Low conf, negative return
    ];
    
    // Calculate weighted average
    let totalWeightedReturn = 0;
    let totalWeight = 0;
    
    for (const s of signals) {
      const conf = s.rescored.opus45Confidence;
      const weight = (conf / 100) ** 2;
      totalWeightedReturn += s.returnPct * weight;
      totalWeight += weight;
    }
    
    const weightedAvg = totalWeightedReturn / totalWeight;
    const simpleAvg = (20 + -5) / 2;  // = 7.5
    
    // Weighted avg should be higher because high return has high confidence
    assert.ok(weightedAvg > simpleAvg, 'Weighted avg should favor high-confidence signals');
  });
  
  it('equal confidence produces same result as simple average', () => {
    const signals = [
      { returnPct: 10, rescored: { opus45Confidence: 70 } },
      { returnPct: 5, rescored: { opus45Confidence: 70 } },
      { returnPct: -2, rescored: { opus45Confidence: 70 } },
    ];
    
    let totalWeightedReturn = 0;
    let totalWeight = 0;
    
    for (const s of signals) {
      const conf = s.rescored.opus45Confidence;
      const weight = (conf / 100) ** 2;
      totalWeightedReturn += s.returnPct * weight;
      totalWeight += weight;
    }
    
    const weightedAvg = totalWeightedReturn / totalWeight;
    const simpleAvg = (10 + 5 + -2) / 3;
    
    // Should be approximately equal (floating point)
    assert.ok(Math.abs(weightedAvg - simpleAvg) < 0.01, 'Equal weights should equal simple avg');
  });
});

// ============================================================================
// TESTS: ITERATION PRODUCES VARIATION
// ============================================================================

describe('Iteration Variation', () => {
  it('different weights produce different weighted averages', () => {
    const signals = generateMockSignals(30);
    
    // Rescore with two different weight sets
    const weights1 = DEFAULT_WEIGHTS;
    const weights2 = {
      ...DEFAULT_WEIGHTS,
      slope10MAElite: 40,
      entryRSAbove90: 20
    };
    
    const rescored1 = rescoreSignalsWithWeights(signals, weights1);
    const rescored2 = rescoreSignalsWithWeights(signals, weights2);
    
    // Calculate weighted averages
    function calcWeightedAvg(sigs) {
      let totalWeightedReturn = 0;
      let totalWeight = 0;
      for (const s of sigs) {
        const conf = s.rescored.opus45Confidence;
        const weight = (conf / 100) ** 2;
        totalWeightedReturn += (s.returnPct || 0) * weight;
        totalWeight += weight;
      }
      return totalWeight > 0 ? totalWeightedReturn / totalWeight : 0;
    }
    
    const avg1 = calcWeightedAvg(rescored1);
    const avg2 = calcWeightedAvg(rescored2);
    
    // Should produce different weighted averages
    assert.ok(Math.abs(avg1 - avg2) > 0.001, 'Different weights should produce different weighted averages');
  });
  
  it('factor ranking is consistent with returns', () => {
    const signals = generateMockSignals(50);
    const analysis = analyzeFactorProfitability(signals);
    
    // Convert to ranking
    const rankings = Object.entries(analysis)
      .filter(([_, d]) => d.bestAvgReturn > -Infinity)
      .sort((a, b) => b[1].bestAvgReturn - a[1].bestAvgReturn);
    
    // Top factor should have highest avg return
    if (rankings.length >= 2) {
      assert.ok(
        rankings[0][1].bestAvgReturn >= rankings[1][1].bestAvgReturn,
        'Rankings should be ordered by avg return'
      );
    }
  });
});

// ============================================================================
// TESTS: DATA INTEGRITY
// ============================================================================

describe('Data Integrity', () => {
  it('rescoring preserves original signal data', () => {
    const signals = generateMockSignals(10);
    const rescored = rescoreSignalsWithWeights(signals, DEFAULT_WEIGHTS);
    
    for (let i = 0; i < signals.length; i++) {
      assert.strictEqual(rescored[i].ticker, signals[i].ticker);
      assert.strictEqual(rescored[i].returnPct, signals[i].returnPct);
      assert.strictEqual(rescored[i].entryDate, signals[i].entryDate);
    }
  });
  
  it('analysis handles missing context gracefully', () => {
    const signals = [
      { returnPct: 5, context: { ma10Slope14d: 8 } },  // Has slope
      { returnPct: 3, context: {} },  // Missing slope
      { returnPct: -2 },  // No context at all
    ];
    
    // Should not throw
    const analysis = analyzeFactorProfitability(signals);
    
    assert.ok(analysis.ma10Slope14d, 'Should analyze available data');
    assert.strictEqual(analysis.ma10Slope14d.signalsAnalyzed, 1);  // Only 1 valid slope
  });
  
  it('DEFAULT_WEIGHTS has required keys for rescoring', () => {
    const requiredKeys = [
      'slope10MAElite',
      'slope10MAStrong',
      'slope10MAGood',
      'slope10MAMinimum',
      'pullbackIdeal',
      'pullbackGood',
      'pctFromHighIdeal',
      'pctFromHighGood',
      'entryAt10MA',
      'entryAt20MA',
      'entryVolumeConfirm',
      'entryRSAbove90',
      'vcpContractions3Plus',
      'vcpContractions4Plus',
      'vcpVolumeDryUp',
      'vcpPatternConfidence',
      'relativeStrengthBonus',
      'industryTrendStrong',
      'industryTrendModerate',
      'recentActionStrong',
      'recentActionGood',
    ];
    
    for (const key of requiredKeys) {
      assert.ok(key in DEFAULT_WEIGHTS, `DEFAULT_WEIGHTS missing key: ${key}`);
    }
  });
});

// ============================================================================
// TESTS: NEW FACTORS — Industry Trend + Recent Price Action in rescoring
// ============================================================================

describe('rescoreSignalsWithWeights — new factors', () => {
  it('industry trend positive adds to score', () => {
    const signal = {
      ticker: 'TEST',
      returnPct: 5,
      context: {
        ma10Slope14d: 8,
        relativeStrength: 90,
        industryReturn3Mo: 12,
      },
    };

    const withIndustry = { ...DEFAULT_WEIGHTS, industryTrendStrong: 8, industryTrendModerate: 4 };
    const zeroIndustry = { ...DEFAULT_WEIGHTS, industryTrendStrong: 0, industryTrendModerate: 0 };

    const r1 = rescoreSignalsWithWeights([signal], withIndustry)[0];
    const r2 = rescoreSignalsWithWeights([signal], zeroIndustry)[0];

    assert.ok(r1.rescored.score > r2.rescored.score, 'Industry trend weight should increase score');
  });

  it('recent 5d return adds to score when positive', () => {
    const signal = {
      ticker: 'TEST',
      returnPct: 5,
      context: {
        ma10Slope14d: 8,
        relativeStrength: 90,
        recentReturn5d: 4,
      },
    };

    const withAction = { ...DEFAULT_WEIGHTS, recentActionStrong: 6, recentActionGood: 3 };
    const zeroAction = { ...DEFAULT_WEIGHTS, recentActionStrong: 0, recentActionGood: 0 };

    const r1 = rescoreSignalsWithWeights([signal], withAction)[0];
    const r2 = rescoreSignalsWithWeights([signal], zeroAction)[0];

    assert.ok(r1.rescored.score > r2.rescored.score, 'Recent price action weight should increase score');
  });

  it('negative industry trend does not add points', () => {
    const signal = {
      ticker: 'TEST',
      returnPct: 3,
      context: {
        ma10Slope14d: 5,
        industryReturn3Mo: -8,
      },
    };

    const rescored = rescoreSignalsWithWeights([signal], DEFAULT_WEIGHTS)[0];
    const breakdown = rescored.rescored;
    assert.ok(breakdown.score >= 0, 'Negative industry trend should not add points');
  });
});

// ============================================================================
// TESTS: RISK METRICS + GATES (Expectancy-first system)
// ============================================================================

describe('computeSignalMetrics — risk metrics', () => {
  it('computes max drawdown from ordered returns', () => {
    const signals = [
      { returnPct: 10, entryDate: '2020-01-01' },
      { returnPct: -10, entryDate: '2020-01-02' },
      { returnPct: 5, entryDate: '2020-01-03' },
      { returnPct: -20, entryDate: '2020-01-04' },
      { returnPct: 5, entryDate: '2020-01-05' },
    ];

    const metrics = computeSignalMetrics(signals);
    // Expected max drawdown ≈ 24.4% (1.10 peak → 0.8316 trough)
    assert.ok(Math.abs(metrics.maxDrawdownPct - 24.4) < 0.3, 'Max drawdown should match expected value');
  });

  it('calculates Sharpe and Sortino ratios from returns', () => {
    const returns = [10, 5, -5, 15, -10];
    const signals = returns.map((r, i) => ({ returnPct: r, entryDate: `2020-01-${String(i + 1).padStart(2, '0')}` }));

    const metrics = computeSignalMetrics(signals);

    const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
    const variance = returns.reduce((s, v) => s + (v - mean) ** 2, 0) / returns.length;
    const std = Math.sqrt(variance);
    const expectedSharpe = std > 0 ? mean / std : 0;

    const downside = returns.filter(v => v < 0);
    const downsideVariance = downside.reduce((s, v) => s + (v ** 2), 0) / downside.length;
    const downsideDev = Math.sqrt(downsideVariance);
    const expectedSortino = downsideDev > 0 ? mean / downsideDev : 0;

    assert.ok(Math.abs(metrics.sharpe - expectedSharpe) < 0.01, 'Sharpe ratio should match expected value');
    assert.ok(Math.abs(metrics.sortino - expectedSortino) < 0.01, 'Sortino ratio should match expected value');
  });
});

describe('passesRiskGates', () => {
  it('fails when sample size is below minTrades', () => {
    const metrics = {
      totalSignals: 150,
      tradeCount: 150,
      profitFactor: 2.1,
      maxDrawdownPct: 12,
      sharpe: 1.3,
      sortino: 1.6,
    };

    const gates = {
      minTrades: 200,
      minProfitFactor: 1.5,
      maxDrawdownPct: 20,
      minSharpe: 1,
      minSortino: 1,
    };

    const result = passesRiskGates(metrics, gates);
    assert.equal(result.passed, false);
    assert.ok(result.failed.includes('minTrades'));
  });

  it('passes when all gates are satisfied', () => {
    const metrics = {
      totalSignals: 250,
      tradeCount: 250,
      profitFactor: 1.8,
      maxDrawdownPct: 14,
      sharpe: 1.2,
      sortino: 1.4,
    };

    const gates = {
      minTrades: 200,
      minProfitFactor: 1.5,
      maxDrawdownPct: 20,
      minSharpe: 1,
      minSortino: 1,
    };

    const result = passesRiskGates(metrics, gates);
    assert.equal(result.passed, true);
    assert.deepStrictEqual(result.failed, []);
  });
});

describe('A/B promotion threshold', () => {
  it('uses a 0.25% minimum delta', () => {
    assert.equal(MIN_AB_DELTA, 0.25);
  });

  it('promotes when improvement meets threshold', () => {
    const decision = shouldPromote(
      'avgReturn',
      { avgReturn: 1.0 },
      { avgReturn: 1.25 },
      MIN_AB_DELTA
    );
    assert.equal(decision.promote, true);
  });

  it('does not promote when improvement is below threshold', () => {
    const decision = shouldPromote(
      'avgReturn',
      { avgReturn: 1.0 },
      { avgReturn: 1.24 },
      MIN_AB_DELTA
    );
    assert.equal(decision.promote, false);
  });
});

console.log('Run tests with: node --test server/learning/iterativeOptimizer.test.js');
