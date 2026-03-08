/**
 * Iterative Profitability Optimizer
 * 
 * Runs multiple optimization loops targeting a specific profit goal.
 * Unlike win-rate optimization, this focuses on AVERAGE RETURN PER TRADE.
 * 
 * STRATEGY:
 * 1. Run historical analysis on top 200 stocks
 * 2. Analyze which factors correlate with HIGH RETURNS (not just wins)
 * 3. Adjust weights to favor high-profit setups
 * 4. Repeat until target profit (8%) is achieved or max loops reached
 * 
 * LEARNING APPROACH:
 * - Group signals by factor buckets
 * - Calculate avg return (not just win rate) for each bucket
 * - Boost weights for factors that produce highest avg returns
 * - Reduce weights for factors that don't correlate with profitability
 */

import { DEFAULT_WEIGHTS, normalizeRs, normalizeIndustryRank } from '../opus45Signal.js';
import { scanMultipleTickers, getTickerList } from './historicalSignalScanner.js';
import { runCrossStockAnalysis, computeSignalMetrics } from './crossStockAnalyzer.js';
import { getStoredSignals, storeSignalsInDatabase } from './autoPopulate.js';
import { loadOptimizedWeights, storeOptimizedWeights, storeLearningRun } from './autoOptimize.js';
import { getSupabase, isSupabaseConfigured } from '../supabase.js';

// Learning system name
const SYSTEM_NAME = 'Opus Signal';

// A/B promotion threshold (percentage points)
export const MIN_AB_DELTA = 0.25;

// Bump this when exit rules change to invalidate cached signals whose returnPct
// was computed under old rules (e.g., 4% stop → 7% stop, 2-day → 3-day 10 MA).
// Stored signals in the database have baked-in returns from simulateTrade();
// changing exit logic means those returns are stale and must be re-scanned.
const EXIT_STRATEGY_VERSION = 2; // v1 = 4% stop/2-day/60d, v2 = 7% stop/3-day/90d + profit lock

// Cache for signals to avoid refetching within same optimization run
let signalCache = {
  signals: null,
  fetchedAt: null,
  tickerCount: 0,
  lookbackMonths: 0,
  exitVersion: 0
};

/**
 * Check if cached signals are still fresh (less than maxAgeDays old)
 */
function isCacheFresh(maxAgeDays = 7) {
  if (!signalCache.signals || !signalCache.fetchedAt) return false;
  
  const ageMs = Date.now() - signalCache.fetchedAt;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  
  return ageDays < maxAgeDays;
}

/**
 * Get signals from database or fetch fresh if needed
 * This dramatically speeds up optimization by reusing stored data
 */
async function getSignalsWithCaching(tickerList, lookbackMonths, options = {}) {
  const {
    maxCacheAgeDays = 7,
    forceRefresh = false,
    iteration = 1,
    onTickerProgress = null
  } = options;
  
  // For iteration > 1, always use cache (don't refetch within same run)
  if (iteration > 1 && signalCache.signals && signalCache.signals.length > 0 && signalCache.exitVersion === EXIT_STRATEGY_VERSION) {
    console.log(`   📦 Using cached signals (${signalCache.signals.length} signals from iteration 1)`);
    if (onTickerProgress) {
      onTickerProgress({ phase: 'cache', message: 'Using cached signals', fromCache: true });
    }
    return { signals: signalCache.signals, stats: signalCache.stats, fromCache: true };
  }
  
  // Check if we should use stored database signals
  if (!forceRefresh && isSupabaseConfigured()) {
    try {
      if (onTickerProgress) {
        onTickerProgress({ phase: 'checking_db', message: 'Checking database for cached signals...' });
      }
      
      // Check database for recent signals
      const storedSignals = await getStoredSignals(2000);
      
      if (storedSignals && storedSignals.length > 0) {
        const latestSignal = storedSignals[0];
        const scanDate = latestSignal.scanDate || latestSignal.created_at;
        
        // Check if stored signals were computed with current exit strategy
        const storedExitVersion = latestSignal.exitStrategyVersion || 1;
        const exitVersionMatch = storedExitVersion >= EXIT_STRATEGY_VERSION;
        
        if (scanDate && exitVersionMatch) {
          const scanTime = new Date(scanDate).getTime();
          const ageMs = Date.now() - scanTime;
          const ageDays = ageMs / (1000 * 60 * 60 * 24);
          
          if (ageDays < maxCacheAgeDays) {
            console.log(`   📦 Using ${storedSignals.length} signals from database (${ageDays.toFixed(1)} days old, exit v${storedExitVersion})`);
            
            if (onTickerProgress) {
              onTickerProgress({ 
                phase: 'db_cache', 
                message: `Using ${storedSignals.length} signals from database (${ageDays.toFixed(1)} days old)`,
                signalCount: storedSignals.length,
                cacheAge: ageDays,
                fromCache: true
              });
            }
            
            signalCache = {
              signals: storedSignals,
              fetchedAt: Date.now(),
              tickerCount: tickerList.length,
              lookbackMonths,
              stats: calculateSignalStats(storedSignals),
              exitVersion: EXIT_STRATEGY_VERSION
            };
            
            return { 
              signals: storedSignals, 
              stats: signalCache.stats, 
              fromCache: true,
              cacheAge: ageDays
            };
          } else {
            console.log(`   ⏰ Database signals are ${ageDays.toFixed(1)} days old, fetching fresh data...`);
            if (onTickerProgress) {
              onTickerProgress({ 
                phase: 'stale', 
                message: `Database signals are ${ageDays.toFixed(1)} days old, fetching fresh data...`
              });
            }
          }
        } else if (!exitVersionMatch) {
          console.log(`   🔄 Database signals use exit strategy v${storedExitVersion}, current is v${EXIT_STRATEGY_VERSION} — re-scanning...`);
          if (onTickerProgress) {
            onTickerProgress({ 
              phase: 'version_mismatch', 
              message: `Exit strategy updated (v${storedExitVersion} → v${EXIT_STRATEGY_VERSION}), re-scanning with new exit rules...`
            });
          }
        }
      }
    } catch (e) {
      console.warn(`   ⚠️ Could not check database cache: ${e.message}`);
    }
  }
  
  // Fetch fresh data from Yahoo Finance
  console.log(`   🌐 Fetching fresh data from Yahoo Finance...`);
  if (onTickerProgress) {
    onTickerProgress({ phase: 'fetching', message: 'Fetching data from Yahoo Finance...', current: 0, total: tickerList.length });
  }
  
  // Wrap progress callback to add phase info for frontend
  const scanProgressCallback = onTickerProgress 
    ? (progress) => {
        onTickerProgress({
          phase: 'scanning',
          ...progress,
          message: `Scanning ${progress.ticker}... (${progress.current}/${progress.total})`
        });
      }
    : null;
  
  const scanResults = await scanMultipleTickers(tickerList, lookbackMonths, scanProgressCallback);
  
  // Store in database for future use
  if (isSupabaseConfigured() && scanResults.signals && scanResults.signals.length > 0) {
    console.log(`   💾 Saving ${scanResults.signals.length} signals to database...`);
    if (onTickerProgress) {
      onTickerProgress({ phase: 'saving', message: `Saving ${scanResults.signals.length} signals to database...` });
    }
    await storeSignalsInDatabase(scanResults.signals);
  }
  
  // Cache for subsequent iterations (tag with exit strategy version)
  signalCache = {
    signals: scanResults.signals,
    fetchedAt: Date.now(),
    tickerCount: tickerList.length,
    lookbackMonths,
    stats: scanResults.stats,
    exitVersion: EXIT_STRATEGY_VERSION
  };
  
  return { 
    signals: scanResults.signals, 
    stats: scanResults.stats, 
    fromCache: false 
  };
}

/**
 * Calculate basic stats from signals array (including expectancy)
 */
function calculateSignalStats(signals) {
  if (!signals || signals.length === 0) {
    return { totalSignals: 0, winRate: 0, avgReturn: 0, expectancy: 0 };
  }
  
  const winners = signals.filter(s => s.returnPct > 0);
  const losers = signals.filter(s => s.returnPct <= 0);
  const winRate = Math.round((winners.length / signals.length) * 100 * 10) / 10;
  const avgWin = winners.length > 0 
    ? Math.round(winners.reduce((sum, s) => sum + s.returnPct, 0) / winners.length * 10) / 10 
    : 0;
  const avgLoss = losers.length > 0 
    ? Math.round(losers.reduce((sum, s) => sum + s.returnPct, 0) / losers.length * 10) / 10 
    : 0;
  const wr = winRate / 100;
  const expectancy = Math.round(((wr * avgWin) + ((1 - wr) * avgLoss)) * 100) / 100;

  return {
    totalSignals: signals.length,
    winners: winners.length,
    losers: losers.length,
    winRate,
    avgReturn: Math.round(signals.reduce((sum, s) => sum + (s.returnPct || 0), 0) / signals.length * 10) / 10,
    avgWin,
    avgLoss,
    expectancy
  };
}

/**
 * Clear the signal cache (call at start of new optimization run)
 */
export function clearSignalCache() {
  signalCache = {
    signals: null,
    fetchedAt: null,
    tickerCount: 0,
    lookbackMonths: 0,
    exitVersion: 0
  };
}

/**
 * Re-score signals using provided weights
 * This is critical for making iterations produce different results
 * 
 * Each signal has captured context (RS, slope, contractions, etc.)
 * We use this context to recalculate the confidence score with new weights
 */
/**
 * Calculate what returns would be if we only took signals matching top factors
 * This is the key insight: "if we had been more selective, returns = X%"
 */
function calculateFilteredSubsetReturn(signals, profitAnalysis, factorRankings) {
  if (!factorRankings || factorRankings.length === 0) {
    return { avgReturn: 0, signalCount: 0, winRate: 0 };
  }
  
  // Get top 3 most profitable factors and their best buckets
  const topFactors = factorRankings.slice(0, 3);
  
  // Filter signals to only those matching AT LEAST 2 of the top 3 factor criteria
  const matchingSignals = signals.filter(signal => {
    const ctx = signal.context || {};
    let matchCount = 0;
    
    for (const [factorName, data] of topFactors) {
      const bestBucket = data.bestBucket;
      const value = getFactorValue(ctx, signal, factorName);
      
      if (value !== null && isInBucket(value, factorName, bestBucket)) {
        matchCount++;
      }
    }
    
    return matchCount >= 2;  // Must match at least 2 of top 3 factors
  });
  
  if (matchingSignals.length === 0) {
    return { avgReturn: 0, signalCount: 0, winRate: 0, topFactors: topFactors.map(([n, d]) => ({ name: n, bucket: d.bestBucket })) };
  }
  
  const totalReturn = matchingSignals.reduce((sum, s) => sum + (s.returnPct || 0), 0);
  const avgReturn = totalReturn / matchingSignals.length;
  const winRate = matchingSignals.filter(s => s.returnPct > 0).length / matchingSignals.length * 100;
  
  return {
    avgReturn: Math.round(avgReturn * 100) / 100,
    signalCount: matchingSignals.length,
    winRate: Math.round(winRate * 10) / 10,
    topFactors: topFactors.map(([n, d]) => ({ name: n, bucket: d.bestBucket, avgReturn: d.bestAvgReturn }))
  };
}

/**
 * Get factor value from signal context
 */
function getFactorValue(ctx, signal, factorName) {
  switch (factorName) {
    case 'relativeStrength': return ctx.relativeStrength;
    case 'contractions': return ctx.contractions || signal.contractions;
    case 'ma10Slope14d': return ctx.ma10Slope14d;
    case 'breakoutVolumeRatio': return ctx.breakoutVolumeRatio;
    case 'pullbackPct': return ctx.pullbackPct;
    case 'baseDepthPct': return ctx.baseDepthPct;
    case 'pctFromHigh': return ctx.pctFromHigh;
    case 'patternConfidence': return ctx.patternConfidence || signal.patternConfidence;
    case 'opus45Confidence': return ctx.opus45Confidence || signal.opus45Confidence;
    default: return null;
  }
}

/**
 * Check if a value falls within a named bucket
 */
function isInBucket(value, factorName, bucketName) {
  const bucketRanges = {
    relativeStrength: {
      '99+': [99, Infinity], '95-99': [95, 99], '90-95': [90, 95], '85-90': [85, 90], '<85': [0, 85]
    },
    contractions: {
      '6+': [6, Infinity], '5': [5, 6], '4': [4, 5], '3': [3, 4], '<3': [0, 3]
    },
    ma10Slope14d: {
      '12%+': [12, Infinity], '10-12%': [10, 12], '7-10%': [7, 10], '5-7%': [5, 7], '<5%': [0, 5]
    },
    breakoutVolumeRatio: {
      '3x+': [3, Infinity], '2.5-3x': [2.5, 3], '2-2.5x': [2, 2.5], '1.5-2x': [1.5, 2], '<1.5x': [0, 1.5]
    },
    pullbackPct: {
      '0-1%': [0, 1], '1-2%': [1, 2], '2-4%': [2, 4], '4-6%': [4, 6], '6%+': [6, Infinity]
    },
    baseDepthPct: {
      '<10%': [0, 10], '10-15%': [10, 15], '15-20%': [15, 20], '20-25%': [20, 25], '25%+': [25, Infinity]
    },
    pctFromHigh: {
      '<3%': [0, 3], '3-5%': [3, 5], '5-10%': [5, 10], '10-15%': [10, 15], '15%+': [15, Infinity]
    },
    patternConfidence: {
      '95%+': [95, Infinity], '90-95%': [90, 95], '80-90%': [80, 90], '70-80%': [70, 80], '<70%': [0, 70]
    },
    opus45Confidence: {
      '90+': [90, Infinity], '80-90': [80, 90], '70-80': [70, 80], '60-70': [60, 70], '<60': [0, 60]
    }
  };
  
  const ranges = bucketRanges[factorName];
  if (!ranges || !ranges[bucketName]) return false;
  
  const [min, max] = ranges[bucketName];
  return value >= min && value < max;
}

function rescoreSignalsWithWeights(signals, weights) {
  return signals.map(signal => {
    const ctx = signal.context || {};
    
    // Build score components based on current weights
    let score = 0;
    const components = [];
    
    // MA Slope scoring
    const slope14d = ctx.ma10Slope14d || 0;
    if (slope14d >= 12) {
      score += weights.slope10MAElite || 0;
      components.push({ name: 'slope10MAElite', value: weights.slope10MAElite || 0 });
    } else if (slope14d >= 8) {
      score += weights.slope10MAStrong || 0;
      components.push({ name: 'slope10MAStrong', value: weights.slope10MAStrong || 0 });
    } else if (slope14d >= 5) {
      score += weights.slope10MAGood || 0;
      components.push({ name: 'slope10MAGood', value: weights.slope10MAGood || 0 });
    } else if (slope14d >= 2) {
      score += weights.slope10MAMinimum || 0;
      components.push({ name: 'slope10MAMinimum', value: weights.slope10MAMinimum || 0 });
    }
    
    // Pullback scoring
    const pullback = ctx.pullbackPct || 0;
    if (pullback >= 0 && pullback <= 3) {
      score += weights.pullbackIdeal || 0;
      components.push({ name: 'pullbackIdeal', value: weights.pullbackIdeal || 0 });
    } else if (pullback > 3 && pullback <= 6) {
      score += weights.pullbackGood || 0;
      components.push({ name: 'pullbackGood', value: weights.pullbackGood || 0 });
    }

    // Distance from 52w high (so pctFromHigh top factor can change rescored confidence)
    const pctFromHigh = ctx.pctFromHigh;
    if (pctFromHigh != null) {
      if (pctFromHigh < 5) {
        score += weights.pctFromHighIdeal || 0;
        components.push({ name: 'pctFromHighIdeal', value: weights.pctFromHighIdeal || 0 });
      } else if (pctFromHigh < 10) {
        score += weights.pctFromHighGood || 0;
        components.push({ name: 'pctFromHighGood', value: weights.pctFromHighGood || 0 });
      }
    }

    // Entry position scoring
    if (ctx.entryAt10MA) {
      score += weights.entryAt10MA || 0;
      components.push({ name: 'entryAt10MA', value: weights.entryAt10MA || 0 });
    } else if (ctx.entryAt20MA) {
      score += weights.entryAt20MA || 0;
      components.push({ name: 'entryAt20MA', value: weights.entryAt20MA || 0 });
    }
    
    // Volume confirmation
    const volRatio = ctx.breakoutVolumeRatio || 0;
    if (volRatio >= 1.5) {
      score += weights.entryVolumeConfirm || 0;
      components.push({ name: 'entryVolumeConfirm', value: weights.entryVolumeConfirm || 0 });
    }
    
    // RS scoring (continuous, aligned with production scoring)
    const rs = ctx.relativeStrength || 0;
    const rsNormalized = normalizeRs(rs);
    const rsPrimary = rsNormalized * (weights.entryRSAbove90 || 0);
    const rsSecondary = rsNormalized * (weights.relativeStrengthBonus || 0);
    if (rsPrimary > 0) {
      score += rsPrimary;
      components.push({ name: 'entryRSAbove90', value: rsPrimary });
    }
    if (rsSecondary > 0) {
      score += rsSecondary;
      components.push({ name: 'relativeStrengthBonus', value: rsSecondary });
    }

    // Industry rank scoring (continuous, aligned with production scoring)
    const industryRank = ctx.industryRank;
    const industryTotalCount = ctx.industryTotalCount;
    const industryNormalized = normalizeIndustryRank(industryRank, industryTotalCount);
    const industryMax = (weights.industryTop20 || 0) + (weights.industryTop40 || 0);
    const industryPoints = industryNormalized * industryMax;
    if (industryPoints > 0) {
      score += industryPoints;
      components.push({ name: 'industryRankScore', value: industryPoints });
    }
    
    // VCP scoring
    const contractions = ctx.contractions || signal.contractions || 0;
    if (contractions >= 4) {
      score += weights.vcpContractions4Plus || 0;
      components.push({ name: 'vcpContractions4Plus', value: weights.vcpContractions4Plus || 0 });
    } else if (contractions >= 3) {
      score += weights.vcpContractions3Plus || 0;
      components.push({ name: 'vcpContractions3Plus', value: weights.vcpContractions3Plus || 0 });
    }
    
    if (ctx.volumeDryUp) {
      score += weights.vcpVolumeDryUp || 0;
      components.push({ name: 'vcpVolumeDryUp', value: weights.vcpVolumeDryUp || 0 });
    }
    
    const patternConf = ctx.patternConfidence || signal.patternConfidence || 0;
    if (patternConf >= 80) {
      score += weights.vcpPatternConfidence || 0;
      components.push({ name: 'vcpPatternConfidence', value: weights.vcpPatternConfidence || 0 });
    }

    // Industry trend scoring (3-month return of stock's industry group)
    const indReturn3Mo = ctx.industryReturn3Mo;
    if (indReturn3Mo != null) {
      if (indReturn3Mo >= 10) {
        score += weights.industryTrendStrong || 0;
        components.push({ name: 'industryTrendStrong', value: weights.industryTrendStrong || 0 });
      } else if (indReturn3Mo >= 5) {
        score += weights.industryTrendModerate || 0;
        components.push({ name: 'industryTrendModerate', value: weights.industryTrendModerate || 0 });
      }
    }

    // Recent price action (5-day return heading into setup)
    const recent5d = ctx.recentReturn5d;
    if (recent5d != null) {
      if (recent5d >= 3) {
        score += weights.recentActionStrong || 0;
        components.push({ name: 'recentActionStrong', value: weights.recentActionStrong || 0 });
      } else if (recent5d >= 1) {
        score += weights.recentActionGood || 0;
        components.push({ name: 'recentActionGood', value: weights.recentActionGood || 0 });
      }
    }

    // Max possible score = sum of ALL weights (not just those hit).
    // This gives a true 0-100% confidence that varies across weight configurations —
    // a momentum-heavy set gives high scores to steep-slope signals,
    // while a vcp-heavy set gives high scores to multi-contraction signals.
    const maxScore = Object.values(weights).reduce((sum, w) => sum + Math.max(0, w || 0), 0);
    const confidence = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
    
    // Determine grade
    let grade = 'F';
    if (confidence >= 90) grade = 'A+';
    else if (confidence >= 85) grade = 'A';
    else if (confidence >= 80) grade = 'A-';
    else if (confidence >= 75) grade = 'B+';
    else if (confidence >= 70) grade = 'B';
    else if (confidence >= 65) grade = 'B-';
    else if (confidence >= 60) grade = 'C+';
    else if (confidence >= 55) grade = 'C';
    else if (confidence >= 50) grade = 'C-';
    
    return {
      ...signal,
      rescored: {
        opus45Confidence: confidence,
        opus45Grade: grade,
        score,
        maxScore,
        components
      }
    };
  });
}

/**
 * Analyze factor impact on PROFITABILITY (not just win rate)
 * This is the key difference from win-rate optimization
 */
function analyzeFactorProfitability(signals) {
  if (!signals || signals.length === 0) return {};
  
  const factors = {
    relativeStrength: { buckets: {}, getValue: s => s.context?.relativeStrength },
    contractions: { buckets: {}, getValue: s => s.context?.contractions || s.contractions },
    ma10Slope14d: { buckets: {}, getValue: s => s.context?.ma10Slope14d },
    breakoutVolumeRatio: { buckets: {}, getValue: s => s.context?.breakoutVolumeRatio },
    pullbackPct: { buckets: {}, getValue: s => s.context?.pullbackPct },
    baseDepthPct: { buckets: {}, getValue: s => s.context?.baseDepthPct },
    pctFromHigh: { buckets: {}, getValue: s => s.context?.pctFromHigh },
    patternConfidence: { buckets: {}, getValue: s => s.context?.patternConfidence || s.patternConfidence },
    opus45Confidence: { buckets: {}, getValue: s => s.context?.opus45Confidence || s.opus45Confidence }
  };
  
  // Bucket definitions for each factor
  const bucketDefs = {
    relativeStrength: [
      { name: '99+', min: 99, max: Infinity },
      { name: '95-99', min: 95, max: 99 },
      { name: '90-95', min: 90, max: 95 },
      { name: '85-90', min: 85, max: 90 },
      { name: '<85', min: 0, max: 85 }
    ],
    contractions: [
      { name: '6+', min: 6, max: Infinity },
      { name: '5', min: 5, max: 6 },
      { name: '4', min: 4, max: 5 },
      { name: '3', min: 3, max: 4 },
      { name: '<3', min: 0, max: 3 }
    ],
    ma10Slope14d: [
      { name: '12%+', min: 12, max: Infinity },
      { name: '10-12%', min: 10, max: 12 },
      { name: '7-10%', min: 7, max: 10 },
      { name: '5-7%', min: 5, max: 7 },
      { name: '<5%', min: 0, max: 5 }
    ],
    breakoutVolumeRatio: [
      { name: '3x+', min: 3, max: Infinity },
      { name: '2.5-3x', min: 2.5, max: 3 },
      { name: '2-2.5x', min: 2, max: 2.5 },
      { name: '1.5-2x', min: 1.5, max: 2 },
      { name: '<1.5x', min: 0, max: 1.5 }
    ],
    pullbackPct: [
      { name: '0-1%', min: 0, max: 1 },
      { name: '1-2%', min: 1, max: 2 },
      { name: '2-4%', min: 2, max: 4 },
      { name: '4-6%', min: 4, max: 6 },
      { name: '6%+', min: 6, max: Infinity }
    ],
    baseDepthPct: [
      { name: '<10%', min: 0, max: 10 },
      { name: '10-15%', min: 10, max: 15 },
      { name: '15-20%', min: 15, max: 20 },
      { name: '20-25%', min: 20, max: 25 },
      { name: '25%+', min: 25, max: Infinity }
    ],
    pctFromHigh: [
      { name: '<3%', min: 0, max: 3 },
      { name: '3-5%', min: 3, max: 5 },
      { name: '5-10%', min: 5, max: 10 },
      { name: '10-15%', min: 10, max: 15 },
      { name: '15%+', min: 15, max: Infinity }
    ],
    patternConfidence: [
      { name: '95%+', min: 95, max: Infinity },
      { name: '90-95%', min: 90, max: 95 },
      { name: '80-90%', min: 80, max: 90 },
      { name: '70-80%', min: 70, max: 80 },
      { name: '<70%', min: 0, max: 70 }
    ],
    opus45Confidence: [
      { name: '90+', min: 90, max: Infinity },
      { name: '80-90', min: 80, max: 90 },
      { name: '70-80', min: 70, max: 80 },
      { name: '60-70', min: 60, max: 70 },
      { name: '<60', min: 0, max: 60 }
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
  
  // Categorize signals into buckets
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
  
  // Calculate avg return per bucket and find most profitable bucket
  const profitabilityAnalysis = {};
  
  for (const [factorName, factor] of Object.entries(factors)) {
    let bestBucket = null;
    let bestAvgReturn = -Infinity;
    const bucketStats = {};
    
    for (const [bucketName, bucket] of Object.entries(factor.buckets)) {
      if (bucket.count >= 3) {  // Need at least 3 signals for statistical significance
        const avgReturn = bucket.totalReturn / bucket.count;
        bucketStats[bucketName] = {
          count: bucket.count,
          avgReturn: Math.round(avgReturn * 100) / 100,
          winRate: Math.round(bucket.signals.filter(s => s.returnPct > 0).length / bucket.count * 100)
        };
        
        if (avgReturn > bestAvgReturn) {
          bestAvgReturn = avgReturn;
          bestBucket = bucketName;
        }
      }
    }
    
    profitabilityAnalysis[factorName] = {
      bucketStats,
      bestBucket,
      bestAvgReturn: Math.round(bestAvgReturn * 100) / 100,
      signalsAnalyzed: Object.values(factor.buckets).reduce((sum, b) => sum + b.count, 0)
    };
  }
  
  return profitabilityAnalysis;
}

/**
 * Seeded RNG for reproducible exploration per run (mulberry32).
 * Returns 0..1. Same seed => same sequence.
 */
function seededRandom(seed) {
  let h = seed >>> 0;
  return function next() {
    h = Math.imul(h ^ (h >>> 15), h | 1);
    h = Math.imul(h ^ (h >>> 7), h | 61);
    return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate weight adjustments based on profitability analysis
 * More aggressive than win-rate optimization.
 *
 * Options (4th arg): { explorationPct, seed }
 * - explorationPct: add ±N to each weight (per run) so variants differ across runs. Default 0.
 * - seed: for reproducible noise when explorationPct > 0 (e.g. Date.now() per run).
 */
function generateProfitabilityWeights(profitAnalysis, currentWeights, targetProfit = 8, options = {}) {
  const { explorationPct = 0, seed = 0 } = options;
  const weights = { ...currentWeights };
  const adjustments = [];
  
  // Weight mappings from factors to Opus4.5 weights
  // pctFromHigh added so top factor (distance from 52w high) can drive weight updates and compound
  const factorWeightMap = {
    relativeStrength: ['entryRSAbove90', 'relativeStrengthBonus'],
    contractions: ['vcpContractions3Plus', 'vcpContractions4Plus'],
    ma10Slope14d: ['slope10MAElite', 'slope10MAStrong', 'slope10MAGood'],
    breakoutVolumeRatio: ['entryVolumeConfirm'],
    pullbackPct: ['pullbackIdeal', 'pullbackGood'],
    pctFromHigh: ['pctFromHighIdeal', 'pctFromHighGood'],
    baseDepthPct: ['vcpPatternConfidence'],
    patternConfidence: ['vcpPatternConfidence'],
    opus45Confidence: ['entryAt10MA', 'entryAt20MA']
  };
  
  // Calculate which factors to boost based on profitability
  const factorRankings = Object.entries(profitAnalysis)
    .filter(([_, data]) => data.bestAvgReturn > -Infinity && data.signalsAnalyzed >= 5)
    .sort((a, b) => b[1].bestAvgReturn - a[1].bestAvgReturn);
  
  // Top 3 most profitable factors get weight boosts
  const topFactors = factorRankings.slice(0, 3);
  // Bottom 2 factors get weight reductions
  const bottomFactors = factorRankings.slice(-2);
  
  for (const [factorName, data] of topFactors) {
    const targetWeights = factorWeightMap[factorName];
    if (!targetWeights) continue;
    
    // Calculate boost based on how profitable the factor is
    const boostMultiplier = data.bestAvgReturn >= 10 ? 1.5 : 
                            data.bestAvgReturn >= 5 ? 1.3 :
                            data.bestAvgReturn >= 0 ? 1.15 : 1.0;
    
    for (const weightName of targetWeights) {
      if (weights[weightName] !== undefined) {
        const oldValue = weights[weightName];
        const newValue = Math.min(35, Math.round(oldValue * boostMultiplier));
        if (newValue !== oldValue) {
          weights[weightName] = newValue;
          adjustments.push({
            weight: weightName,
            factor: factorName,
            oldValue,
            newValue,
            change: newValue - oldValue,
            reason: `${factorName} ${data.bestBucket} has ${data.bestAvgReturn}% avg return`,
            action: 'BOOST'
          });
        }
      }
    }
  }
  
  for (const [factorName, data] of bottomFactors) {
    const targetWeights = factorWeightMap[factorName];
    if (!targetWeights) continue;
    
    // Only reduce if the factor actually hurts profitability
    if (data.bestAvgReturn < 0) {
      for (const weightName of targetWeights) {
        if (weights[weightName] !== undefined) {
          const oldValue = weights[weightName];
          const newValue = Math.max(1, Math.round(oldValue * 0.7));
          if (newValue !== oldValue) {
            weights[weightName] = newValue;
            adjustments.push({
              weight: weightName,
              factor: factorName,
              oldValue,
              newValue,
              change: newValue - oldValue,
              reason: `${factorName} has negative avg return (${data.bestAvgReturn}%)`,
              action: 'REDUCE'
            });
          }
        }
      }
    }
  }
  
  // Exploration: add small random perturbation so each run produces a different variant
  // (same control + same signals would otherwise yield identical variant every time)
  if (explorationPct > 0 && seed !== undefined) {
    const rng = seededRandom(seed);
    for (const key of Object.keys(weights)) {
      if (key.startsWith('_')) continue;
      const v = weights[key];
      if (typeof v !== 'number') continue;
      const delta = (rng() * 2 - 1) * explorationPct;
      const newVal = Math.round(v + delta);
      weights[key] = Math.max(1, Math.min(35, newVal));
    }
  }
  
  return { weights, adjustments, factorRankings };
}

/**
 * Run one iteration of the optimization loop
 * 
 * KEY FIX: Filter signals by confidence threshold based on current weights
 * This makes weight changes actually affect which trades are counted
 */
async function runOptimizationIteration(options = {}) {
  const {
    currentWeights = DEFAULT_WEIGHTS,
    lookbackMonths = 12,
    tickerLimit = 200,
    iteration = 1,
    minConfidenceThreshold = 60,  // Minimum confidence to include signal
    onTickerProgress = null
  } = options;

  console.log(`\n📈 ITERATION ${iteration}: Scanning historical signals...`);

  // Get ticker list
  let tickerList = await getTickerList();
  if (tickerLimit > 0 && tickerList.length > tickerLimit) {
    tickerList = tickerList.slice(0, tickerLimit);
  }

  // Get signals with caching - uses database if fresh data exists, otherwise fetches from Yahoo
  // For iteration > 1, always reuses the cache from iteration 1 (much faster)
  const scanResults = await getSignalsWithCaching(tickerList, lookbackMonths, {
    maxCacheAgeDays: 7,
    forceRefresh: false,
    iteration,
    onTickerProgress
  });
  
  if (!scanResults.signals || scanResults.signals.length === 0) {
    return { success: false, reason: 'No signals found', iteration };
  }
  
  // CRITICAL: Re-score signals with current weights and filter by confidence
  // This is what makes iterations produce different results
  const rescoredSignals = rescoreSignalsWithWeights(scanResults.signals, currentWeights);
  
  // Calculate dynamic threshold - raise it as iterations progress
  // Start at 60, increase by 1.5 per iteration up to max 85
  const dynamicThreshold = Math.min(85, minConfidenceThreshold + (iteration - 1) * 1.5);
  
  // Filter to only include signals above threshold
  const filteredSignals = rescoredSignals.filter(s => 
    (s.rescored?.opus45Confidence || s.opus45Confidence) >= dynamicThreshold
  );
  
  console.log(`   Raw signals: ${scanResults.signals.length}, Filtered (>${dynamicThreshold.toFixed(0)}% conf): ${filteredSignals.length}`);
  
  // Use filtered signals if enough, otherwise use all rescored signals
  let signals;
  if (filteredSignals.length >= 10) {
    signals = filteredSignals;
  } else {
    console.log(`   ⚠️  Too few signals at threshold ${dynamicThreshold.toFixed(0)}%, using all ${rescoredSignals.length} signals`);
    signals = rescoredSignals;
  }
  
  // WEIGHTED AVERAGE: Signals with higher confidence count more
  // This makes weight changes actually affect the computed metrics
  let totalWeightedReturn = 0;
  let totalWeight = 0;
  let weightedWins = 0;
  let weightedLosses = 0;
  
  for (const s of signals) {
    const conf = s.rescored?.opus45Confidence || s.opus45Confidence || 50;
    // Weight = confidence squared (emphasizes high-confidence signals)
    const weight = (conf / 100) ** 2;
    
    totalWeightedReturn += (s.returnPct || 0) * weight;
    totalWeight += weight;
    
    if (s.returnPct > 0) {
      weightedWins += weight;
    } else {
      weightedLosses += weight;
    }
  }
  
  // Calculate weighted metrics
  const avgReturn = totalWeight > 0 ? totalWeightedReturn / totalWeight : 0;
  const winRate = totalWeight > 0 ? (weightedWins / totalWeight) * 100 : 0;
  
  // Regular (unweighted) win/loss for comparison
  const winners = signals.filter(s => s.returnPct > 0);
  const losers = signals.filter(s => s.returnPct <= 0);
  const avgWin = winners.length > 0 ? winners.reduce((sum, s) => sum + s.returnPct, 0) / winners.length : 0;
  const avgLoss = losers.length > 0 ? losers.reduce((sum, s) => sum + s.returnPct, 0) / losers.length : 0;
  
  console.log(`   Signals: ${signals.length}, Weighted Avg Return: ${avgReturn.toFixed(2)}%, Weighted Win Rate: ${winRate.toFixed(1)}%`);
  
  // Analyze profitability by factor
  const profitAnalysis = analyzeFactorProfitability(signals);
  
  // Generate optimized weights
  const { weights: newWeights, adjustments, factorRankings } = generateProfitabilityWeights(
    profitAnalysis,
    currentWeights,
    8  // Target 8% profit
  );
  
  // CRITICAL: Calculate "filtered subset" return
  // This shows what returns WOULD have been if we only took signals matching top factors
  const filteredSubsetReturn = calculateFilteredSubsetReturn(signals, profitAnalysis, factorRankings);
  
  console.log(`   📊 If filtered to top factors: ${filteredSubsetReturn.avgReturn.toFixed(2)}% avg return (${filteredSubsetReturn.signalCount} signals)`);
  
  // Run cross-stock analysis for additional insights
  const crossStockAnalysis = runCrossStockAnalysis(signals);
  
  return {
    success: true,
    iteration,
    metrics: {
      signalCount: signals.length,
      avgReturn: Math.round(avgReturn * 100) / 100,
      winRate: Math.round(winRate * 10) / 10,
      avgWin: Math.round(avgWin * 100) / 100,
      avgLoss: Math.round(avgLoss * 100) / 100,
      profitFactor: avgLoss !== 0 ? Math.round(Math.abs(avgWin / avgLoss) * 100) / 100 : 0,
      // The key metric: what return would be with stricter filtering
      filteredSubsetReturn: filteredSubsetReturn.avgReturn,
      filteredSubsetCount: filteredSubsetReturn.signalCount,
      filteredSubsetWinRate: filteredSubsetReturn.winRate
    },
    filteredSubset: filteredSubsetReturn,
    profitAnalysis,
    factorRankings: factorRankings.map(([name, data]) => ({
      factor: name,
      bestBucket: data.bestBucket,
      avgReturn: data.bestAvgReturn
    })),
    adjustments,
    previousWeights: currentWeights,
    newWeights,
    crossStockAnalysis
  };
}

/**
 * Evaluate a weight set against a fixed set of signals.
 * Re-scores each signal with the given weights (via rescoreSignalsWithWeights)
 * and computes metrics only on signals above a confidence threshold.
 *
 * Returns standardized metrics object matching computeSignalMetrics shape.
 */
function evaluateWeightsOnSignals(signals, weights) {
  const rescored = rescoreSignalsWithWeights(signals, weights);

  // Sort by rescored confidence descending, take the top 40%.
  // This is percentile-based rather than a fixed 60% threshold, so different
  // weight sets always select a meaningfully different subset — preventing delta=0.
  const sorted = [...rescored].sort((a, b) =>
    (b.rescored?.opus45Confidence || 0) - (a.rescored?.opus45Confidence || 0)
  );
  const topN = Math.max(10, Math.ceil(sorted.length * 0.4));
  const selected = sorted.slice(0, topN);

  return computeSignalMetrics(selected);
}

/**
 * Compare variant weights against control weights on the same signals.
 * Returns an A/B comparison object.
 */
function compareControlVariant(signals, controlWeights, variantWeights) {
  const controlMetrics = evaluateWeightsOnSignals(signals, controlWeights);
  const variantMetrics = evaluateWeightsOnSignals(signals, variantWeights);

  return {
    controlMetrics,
    variantMetrics,
    delta: {
      avgReturn: Math.round(((variantMetrics.avgReturn || 0) - (controlMetrics.avgReturn || 0)) * 100) / 100,
      expectancy: Math.round(((variantMetrics.expectancy || 0) - (controlMetrics.expectancy || 0)) * 100) / 100,
      winRate: Math.round(((variantMetrics.winRate || 0) - (controlMetrics.winRate || 0)) * 10) / 10
    }
  };
}

/**
 * Build a list of weight keys that changed between control and variant.
 */
function buildFactorChanges(controlWeights, variantWeights, adjustments) {
  const changes = [];
  const allKeys = new Set([...Object.keys(controlWeights), ...Object.keys(variantWeights)]);

  for (const key of allKeys) {
    if (key.startsWith('_')) continue;
    const oldVal = controlWeights[key];
    const newVal = variantWeights[key];
    if (oldVal !== newVal) {
      const adj = (adjustments || []).find(a => a.weight === key);
      changes.push({
        weight: key,
        oldValue: oldVal ?? null,
        newValue: newVal ?? null,
        delta: (newVal || 0) - (oldVal || 0),
        factor: adj?.factor || null,
        reason: adj?.reason || 'weight changed'
      });
    }
  }
  return changes;
}

/**
 * Decide whether the variant should be promoted over control.
 *
 * @param {'avgReturn'|'expectancy'} objective
 * @param {Object} controlMetrics
 * @param {Object} variantMetrics
 * @param {number} minImprovement - minimum improvement threshold
 * @returns {{ promote: boolean, reason: string }}
 */
export function shouldPromote(objective, controlMetrics, variantMetrics, minImprovement = MIN_AB_DELTA) {
  const controlVal = objective === 'expectancy'
    ? (controlMetrics.expectancy || 0)
    : (controlMetrics.avgReturn || 0);
  const variantVal = objective === 'expectancy'
    ? (variantMetrics.expectancy || 0)
    : (variantMetrics.avgReturn || 0);
  const improvement = variantVal - controlVal;

  if (improvement >= minImprovement) {
    return {
      promote: true,
      reason: `Variant ${objective} ${variantVal.toFixed(2)}% beats control ${controlVal.toFixed(2)}% by ${improvement.toFixed(2)}% (threshold: ${minImprovement}%)`
    };
  }
  return {
    promote: false,
    reason: `Variant ${objective} ${variantVal.toFixed(2)}% did not beat control ${controlVal.toFixed(2)}% by required ${minImprovement}% (delta: ${improvement.toFixed(2)}%)`
  };
}

/**
 * Run the full iterative optimization loop
 * Continues until target profit is reached or max iterations hit.
 *
 * After finding the best iteration, performs an A/B comparison:
 *   Control = current active weights
 *   Variant = best iteration weights
 * Only promotes the variant if it beats the control on the chosen objective.
 */
export async function runIterativeOptimization(options = {}) {
  const {
    maxIterations = 100,
    targetProfit = 5,     // Lowered from 8% → 5% avg return per trade (more achievable with compounding)
    lookbackMonths = 12,
    tickerLimit = 200,
    onProgress = null,
    forceRefresh = false  // Set to true to ignore database cache
  } = options;

  console.log('\n' + '═'.repeat(60));
  console.log(`   ${SYSTEM_NAME} - SELF-LEARNING OPTIMIZER`);
  console.log('   Target: ' + targetProfit + '% average profit per trade');
  console.log('   Max iterations: ' + maxIterations);
  console.log('═'.repeat(60));
  
  // Clear cache at start of new optimization run
  // This ensures iteration 1 fetches fresh data (or loads from DB)
  // and iterations 2+ reuse that data
  clearSignalCache();
  
  if (forceRefresh) {
    console.log('   ⚠️  Force refresh enabled - ignoring database cache');
  }

  // COMPOUNDING: Load previously optimized weights if available
  // This allows the learning to build on prior runs instead of starting over
  let currentWeights;
  let startingSource = 'default';
  
  try {
    const stored = await loadOptimizedWeights();
    if (stored.source === 'optimized' && stored.weights) {
      // Merge defaults under stored so new weight keys (e.g. pctFromHighIdeal/Good) exist
      currentWeights = { ...DEFAULT_WEIGHTS, ...stored.weights };
      startingSource = 'optimized';
      console.log(`   📊 Starting from optimized weights (trained on ${stored.signalsAnalyzed || '?'} signals)`);
      console.log(`   📈 Prior: avgReturn=${stored.avgReturn?.toFixed(2) || '?'}%, expectancy=${stored.expectancy?.toFixed(2) || '?'}%, winRate=${stored.baselineWinRate?.toFixed(1) || '?'}%`);
    } else {
      currentWeights = { ...DEFAULT_WEIGHTS };
      console.log(`   📊 Starting from default weights (no prior optimization found)`);
    }
  } catch (e) {
    currentWeights = { ...DEFAULT_WEIGHTS };
    console.log(`   📊 Starting from default weights (${e.message})`);
  }

  // Snapshot the control weights before any mutations
  const startingWeights = { ...currentWeights };

  const iterationResults = [];
  let bestResult = null;
  let targetReached = false;
  
  for (let i = 1; i <= maxIterations; i++) {
    // Report iteration start
    if (onProgress) {
      onProgress({
        phase: 'iteration',
        iteration: i,
        maxIterations,
        currentAvgReturn: bestResult?.metrics?.avgReturn || 0,
        targetProfit,
        message: `Starting iteration ${i} of ${maxIterations}...`
      });
    }
    
    // Run one iteration with ticker-level progress
    const result = await runOptimizationIteration({
      currentWeights,
      lookbackMonths,
      tickerLimit,
      iteration: i,
      onTickerProgress: onProgress ? (tickerProgress) => {
        onProgress({
          ...tickerProgress,
          iteration: i,
          maxIterations
        });
      } : null
    });
    
    if (!result.success) {
      console.log(`   ❌ Iteration ${i} failed: ${result.reason}`);
      if (onProgress) {
        onProgress({
          phase: 'iteration_failed',
          iteration: i,
          maxIterations,
          reason: result.reason,
          message: `Iteration ${i} failed: ${result.reason}`
        });
      }
      break;
    }
    
    // Send progress update after iteration completes
    if (onProgress) {
      onProgress({
        phase: 'iteration_complete',
        iteration: i,
        maxIterations,
        avgReturn: result.metrics.avgReturn,
        winRate: result.metrics.winRate,
        signalCount: result.metrics.signalCount,
        message: `Iteration ${i}/${maxIterations} complete: ${result.metrics.avgReturn.toFixed(2)}% avg return`
      });
    }
    
    iterationResults.push({
      iteration: i,
      avgReturn: result.metrics.avgReturn,
      winRate: result.metrics.winRate,
      signalCount: result.metrics.signalCount,
      adjustmentsMade: result.adjustments.length,
      // The "what if we were selective" return - this SHOULD improve as we learn
      filteredReturn: result.metrics.filteredSubsetReturn || result.metrics.avgReturn,
      filteredCount: result.metrics.filteredSubsetCount || result.metrics.signalCount,
      topFactors: result.factorRankings.slice(0, 3)
    });

    // Track best result - prioritize filtered subset return
    const currentBest = result.metrics.filteredSubsetReturn || result.metrics.avgReturn;
    const previousBest = bestResult?.metrics?.filteredSubsetReturn || bestResult?.metrics?.avgReturn || -Infinity;
    if (!bestResult || currentBest > previousBest) {
      bestResult = result;
    }
    
    // Check if target reached
    if (result.metrics.avgReturn >= targetProfit) {
      console.log(`\n🎯 TARGET REACHED! Avg return: ${result.metrics.avgReturn}%`);
      targetReached = true;
      break;
    }
    
    // Log progress
    const progress = result.metrics.avgReturn / targetProfit * 100;
    console.log(`   Progress: ${progress.toFixed(0)}% toward ${targetProfit}% target`);
    
    // Apply new weights for next iteration
    currentWeights = result.newWeights;
    
    // Small delay to prevent rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // ========== A/B COMPARISON ==========
  // Compare the best variant weights against the control on the SAME signal set.
  const variantWeights = bestResult?.newWeights || currentWeights;
  const controlWeights = startingWeights;
  const cachedSignals = signalCache.signals || [];

  let abComparison = null;
  let promoted = false;
  let promotionReason = 'No signals for comparison';

  if (cachedSignals.length >= 10 && bestResult) {
    const objective = 'expectancy';
    const minImprovement = MIN_AB_DELTA;

    abComparison = compareControlVariant(cachedSignals, controlWeights, variantWeights);
    const decision = shouldPromote(objective, abComparison.controlMetrics, abComparison.variantMetrics, minImprovement);
    promoted = decision.promote;
    promotionReason = decision.reason;

    const factorChanges = buildFactorChanges(controlWeights, variantWeights, bestResult?.adjustments);

    console.log('\n' + '─'.repeat(60));
    console.log('   A/B COMPARISON');
    console.log('─'.repeat(60));
    console.log(`   Control:  ${abComparison.controlMetrics.avgReturn}% avg return, ${abComparison.controlMetrics.expectancy}% expectancy, ${abComparison.controlMetrics.winRate}% win rate`);
    console.log(`   Variant:  ${abComparison.variantMetrics.avgReturn}% avg return, ${abComparison.variantMetrics.expectancy}% expectancy, ${abComparison.variantMetrics.winRate}% win rate`);
    console.log(`   Delta:    ${abComparison.delta.avgReturn >= 0 ? '+' : ''}${abComparison.delta.avgReturn}% avg return, ${abComparison.delta.expectancy >= 0 ? '+' : ''}${abComparison.delta.expectancy}% expectancy`);
    console.log(`   Promoted: ${promoted ? 'YES' : 'NO'} — ${promotionReason}`);
    if (factorChanges.length > 0) {
      console.log(`   Changes:  ${factorChanges.length} weight(s) modified`);
      for (const c of factorChanges.slice(0, 5)) {
        console.log(`     ${c.weight}: ${c.oldValue} → ${c.newValue} (${c.delta >= 0 ? '+' : ''}${c.delta}) ${c.factor ? `[${c.factor}]` : ''}`);
      }
    }

    if (onProgress) {
      onProgress({
        phase: 'ab_comparison',
        controlMetrics: abComparison.controlMetrics,
        variantMetrics: abComparison.variantMetrics,
        delta: abComparison.delta,
        promoted,
        promotionReason,
        factorChanges,
        message: promoted
          ? `Variant promoted: +${abComparison.delta.expectancy}% expectancy`
          : `Variant not promoted: ${promotionReason}`
      });
    }

    // Persist learning run to DB
    try {
      await storeLearningRun({
        systemName: SYSTEM_NAME,
        startedAt: new Date(Date.now() - (iterationResults.length * 1000)).toISOString(),
        completedAt: new Date().toISOString(),
        iterationsRun: iterationResults.length,
        signalsEvaluated: cachedSignals.length,
        objective,
        controlWeights,
        controlSource: startingSource,
        controlMetrics: abComparison.controlMetrics,
        variantWeights,
        variantMetrics: abComparison.variantMetrics,
        factorChanges,
        topFactors: bestResult?.factorRankings?.slice(0, 5) || [],
        promoted,
        promotionReason,
        minImprovementThreshold: MIN_AB_DELTA
      });
    } catch (e) {
      console.warn('Could not persist learning run:', e.message);
    }

    // Only activate weights if promoted
    if (promoted) {
      try {
        await storeOptimizedWeights({
          weights: variantWeights,
          adjustments: bestResult?.adjustments || [],
          signalsAnalyzed: cachedSignals.length,
          baselineWinRate: abComparison.variantMetrics.winRate,
          baselineAvgReturn: abComparison.variantMetrics.avgReturn,
          baselineExpectancy: abComparison.variantMetrics.expectancy,
          avgWin: abComparison.variantMetrics.avgWin,
          avgLoss: abComparison.variantMetrics.avgLoss,
          profitFactor: abComparison.variantMetrics.profitFactor,
          topFactors: bestResult?.factorRankings?.slice(0, 5) || [],
          generatedAt: new Date().toISOString()
        }, { activate: true });

        const { clearWeightCache } = await import('../opus45Signal.js');
        clearWeightCache();
        console.log('✅ Variant weights activated (promoted)');
      } catch (e) {
        console.warn('Could not activate promoted weights:', e.message);
      }
    } else {
      console.log('ℹ️ Keeping current control weights (variant not promoted)');
    }
  }

  const summary = generateSummaryReport(iterationResults, bestResult, targetProfit, targetReached);
  
  return {
    success: true,
    systemName: SYSTEM_NAME,
    startingSource,
    targetReached,
    iterationsRun: iterationResults.length,
    maxIterations,
    targetProfit,
    finalMetrics: bestResult?.metrics || null,
    finalWeights: promoted ? variantWeights : controlWeights,
    iterationHistory: iterationResults,
    bestIteration: bestResult?.iteration || 0,
    summary,
    topFactors: bestResult?.factorRankings?.slice(0, 5) || [],
    recommendedWeights: promoted ? variantWeights : controlWeights,
    abComparison: abComparison ? {
      controlMetrics: abComparison.controlMetrics,
      variantMetrics: abComparison.variantMetrics,
      delta: abComparison.delta,
      promoted,
      promotionReason
    } : null
  };
}

/**
 * Generate a summary report of the optimization run
 */
function generateSummaryReport(iterations, bestResult, targetProfit, targetReached) {
  const lines = [
    '═'.repeat(60),
    `           ${SYSTEM_NAME} - LEARNING REPORT`,
    '═'.repeat(60),
    '',
    `📊 RESULTS:`,
    `   Iterations completed: ${iterations.length}`,
    `   Target profit: ${targetProfit}%`,
    `   Target reached: ${targetReached ? '✅ YES' : '❌ Not yet'}`,
    ''
  ];
  
  if (bestResult) {
    const exp = bestResult.metrics.avgLoss !== 0
      ? Math.round(((bestResult.metrics.winRate / 100) * bestResult.metrics.avgWin +
          (1 - bestResult.metrics.winRate / 100) * bestResult.metrics.avgLoss) * 100) / 100
      : 0;
    lines.push(
      `📈 BEST PERFORMANCE (Iteration ${bestResult.iteration}):`,
      `   Average Return: ${bestResult.metrics.avgReturn}%`,
      `   Expectancy: ${exp}%`,
      `   Win Rate: ${bestResult.metrics.winRate}%`,
      `   Profit Factor: ${bestResult.metrics.profitFactor}`,
      `   Avg Win: +${bestResult.metrics.avgWin}%`,
      `   Avg Loss: ${bestResult.metrics.avgLoss}%`,
      ''
    );
  }
  
  if (iterations.length > 1) {
    const firstReturn = iterations[0]?.avgReturn || 0;
    const lastReturn = iterations[iterations.length - 1]?.avgReturn || 0;
    const improvement = lastReturn - firstReturn;
    
    lines.push(
      `📈 IMPROVEMENT:`,
      `   Starting avg return: ${firstReturn}%`,
      `   Ending avg return: ${lastReturn}%`,
      `   Net improvement: ${improvement >= 0 ? '+' : ''}${improvement.toFixed(2)}%`,
      ''
    );
  }
  
  if (bestResult?.factorRankings) {
    lines.push(
      `🎯 TOP PROFITABLE FACTORS:`,
      ...bestResult.factorRankings.slice(0, 5).map((f, i) => 
        `   ${i + 1}. ${f.factor}: ${f.bestBucket} → ${f.avgReturn}% avg return`
      ),
      ''
    );
  }
  
  lines.push(
    '═'.repeat(60),
    `Generated: ${new Date().toISOString()}`
  );
  
  return lines.join('\n');
}

// Alias for SSE version (same function, onProgress callback handles real-time updates)
export const runIterativeOptimizationWithProgress = runIterativeOptimization;

export { analyzeFactorProfitability, generateProfitabilityWeights, runOptimizationIteration, evaluateWeightsOnSignals, compareControlVariant };
