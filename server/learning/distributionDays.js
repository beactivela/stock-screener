/**
 * Distribution Days & Market Condition Tracking
 * 
 * Implements IBD-style market timing:
 * - Distribution Day: Index down >0.2% on higher volume than previous day
 * - 5+ distribution days in 25 trading days = Market in Correction
 * - Follow-Through Day: 4th+ day of rally attempt, up >1% on higher volume
 * 
 * This module:
 * 1. Fetches SPY/QQQ daily bars
 * 2. Calculates distribution days (rolling 25-day window)
 * 3. Determines market regime (BULL, BEAR, UNCERTAIN, CORRECTION)
 * 4. Stores daily market conditions for historical analysis
 * 
 * The market condition is a CRITICAL filter for the learning system:
 * - 75% of stocks follow the market direction
 * - Trading longs in a correction = high failure rate
 */

import { getSupabase, isSupabaseConfigured } from '../supabase.js';
import { getBars } from '../yahoo.js';
import { sma } from '../vcp.js';

const DISTRIBUTION_DAY_PCT = -0.2;  // Down more than 0.2%
const CORRECTION_THRESHOLD = 5;     // 5+ distribution days = correction
const ROLLING_WINDOW_DAYS = 25;     // Look back 25 trading days
const FOLLOW_THROUGH_MIN_PCT = 1.0; // Up at least 1% on FTD

/**
 * Calculate if a specific day is a distribution day
 * 
 * Distribution Day criteria (IBD):
 * - Index down > 0.2% from prior close
 * - Volume higher than prior day
 * 
 * @param {Object} today - Today's bar { o, h, l, c, v }
 * @param {Object} yesterday - Yesterday's bar { o, h, l, c, v }
 * @returns {boolean} True if distribution day
 */
function isDistributionDay(today, yesterday) {
  if (!today || !yesterday) return false;
  
  const pctChange = ((today.c - yesterday.c) / yesterday.c) * 100;
  const volumeHigher = today.v > yesterday.v;
  
  return pctChange <= DISTRIBUTION_DAY_PCT && volumeHigher;
}

/**
 * Calculate distribution day count over rolling window
 * 
 * @param {Array} bars - OHLC bars sorted by time ascending (need ~30 bars)
 * @returns {Object} { count, dates, details }
 */
function countDistributionDays(bars) {
  if (!bars || bars.length < ROLLING_WINDOW_DAYS + 1) {
    return { count: 0, dates: [], details: [] };
  }
  
  const recentBars = bars.slice(-(ROLLING_WINDOW_DAYS + 1));
  const distributionDays = [];
  
  for (let i = 1; i < recentBars.length; i++) {
    const today = recentBars[i];
    const yesterday = recentBars[i - 1];
    
    if (isDistributionDay(today, yesterday)) {
      const pctChange = ((today.c - yesterday.c) / yesterday.c) * 100;
      distributionDays.push({
        date: new Date(today.t).toISOString().slice(0, 10),
        pctChange: Math.round(pctChange * 100) / 100,
        volume: today.v,
        priorVolume: yesterday.v
      });
    }
  }
  
  return {
    count: distributionDays.length,
    dates: distributionDays.map(d => d.date),
    details: distributionDays
  };
}

/**
 * Check if today is a Follow-Through Day
 * 
 * FTD criteria (IBD):
 * - Day 4 or later of a rally attempt
 * - Index up > 1% from prior close
 * - Volume higher than prior day
 * 
 * @param {Array} bars - Recent bars (need at least 10)
 * @returns {Object} { isFollowThrough, dayOfRally, pctGain }
 */
function checkFollowThroughDay(bars) {
  if (!bars || bars.length < 10) {
    return { isFollowThrough: false, dayOfRally: 0, pctGain: 0 };
  }
  
  const lastIdx = bars.length - 1;
  const today = bars[lastIdx];
  const yesterday = bars[lastIdx - 1];
  
  const pctChange = ((today.c - yesterday.c) / yesterday.c) * 100;
  const volumeHigher = today.v > yesterday.v;
  
  // Count days since last low (rally attempt start)
  let dayOfRally = 1;
  let rallyLow = today.l;
  
  for (let i = lastIdx - 1; i >= Math.max(0, lastIdx - 10); i--) {
    if (bars[i].l < rallyLow) {
      break;
    }
    dayOfRally++;
    rallyLow = Math.min(rallyLow, bars[i].l);
  }
  
  const isFollowThrough = dayOfRally >= 4 && pctChange >= FOLLOW_THROUGH_MIN_PCT && volumeHigher;
  
  return {
    isFollowThrough,
    dayOfRally,
    pctGain: Math.round(pctChange * 100) / 100
  };
}

/**
 * Determine market regime based on multiple factors
 * 
 * @param {Object} params - All market condition parameters
 * @returns {Object} { regime, confidence, factors }
 */
function determineMarketRegime(params) {
  const {
    spyAbove50ma,
    spyAbove200ma,
    qqqAbove50ma,
    qqqAbove200ma,
    spyDistributionCount,
    qqqDistributionCount,
    spySlope50ma,
    isFollowThroughDay
  } = params;
  
  const factors = [];
  let bullScore = 0;
  let bearScore = 0;
  
  // Price above/below MAs
  if (spyAbove50ma && spyAbove200ma) {
    bullScore += 2;
    factors.push('SPY above 50 & 200 MA');
  } else if (!spyAbove50ma && !spyAbove200ma) {
    bearScore += 2;
    factors.push('SPY below 50 & 200 MA');
  }
  
  if (qqqAbove50ma && qqqAbove200ma) {
    bullScore += 1;
    factors.push('QQQ above 50 & 200 MA');
  } else if (!qqqAbove50ma && !qqqAbove200ma) {
    bearScore += 1;
    factors.push('QQQ below 50 & 200 MA');
  }
  
  // Distribution days
  if (spyDistributionCount >= CORRECTION_THRESHOLD || qqqDistributionCount >= CORRECTION_THRESHOLD) {
    bearScore += 3;
    factors.push(`${Math.max(spyDistributionCount, qqqDistributionCount)} distribution days`);
  } else if (spyDistributionCount <= 2 && qqqDistributionCount <= 2) {
    bullScore += 1;
    factors.push('Low distribution day count');
  }
  
  // 50 MA slope
  if (spySlope50ma > 0.5) {
    bullScore += 1;
    factors.push('SPY 50 MA rising');
  } else if (spySlope50ma < -0.5) {
    bearScore += 1;
    factors.push('SPY 50 MA falling');
  }
  
  // Follow-through day
  if (isFollowThroughDay) {
    bullScore += 2;
    factors.push('Follow-through day confirmed');
  }
  
  // Determine regime
  let regime = 'UNCERTAIN';
  const totalScore = bullScore + bearScore;
  const netScore = bullScore - bearScore;
  
  if (spyDistributionCount >= CORRECTION_THRESHOLD || qqqDistributionCount >= CORRECTION_THRESHOLD) {
    regime = 'CORRECTION';
  } else if (netScore >= 3) {
    regime = 'BULL';
  } else if (netScore <= -3) {
    regime = 'BEAR';
  }
  
  // Confidence based on how decisive the score is
  const confidence = Math.min(100, Math.abs(netScore) * 20 + 20);
  
  return {
    regime,
    confidence,
    factors,
    bullScore,
    bearScore
  };
}

/**
 * Calculate 50 MA slope for an index
 * 
 * @param {Array} bars - OHLC bars
 * @returns {number} Slope as percentage over 20 days
 */
function calculate50MASlope(bars) {
  if (!bars || bars.length < 70) return 0;
  
  const closes = bars.map(b => b.c);
  const sma50Arr = sma(closes, 50);
  const lastIdx = bars.length - 1;
  
  const current50 = sma50Arr[lastIdx];
  const prior50 = sma50Arr[lastIdx - 20];
  
  if (!current50 || !prior50) return 0;
  
  return ((current50 - prior50) / prior50) * 100;
}

/**
 * Fetch and analyze market condition for today
 * 
 * This is the main function called by other modules to get
 * the current market state for trade decisions.
 * 
 * @param {string} date - Optional date (default: today)
 * @returns {Promise<Object>} Complete market condition
 */
export async function getCurrentMarketCondition(date = null) {
  const targetDate = date ? new Date(date) : new Date();
  const to = targetDate.toISOString().slice(0, 10);
  
  // Need ~60 trading days of history
  const from = new Date(targetDate);
  from.setDate(from.getDate() - 90);
  const fromStr = from.toISOString().slice(0, 10);
  
  try {
    // Fetch SPY and QQQ bars
    const [spyBars, qqqBars] = await Promise.all([
      getBars('SPY', fromStr, to),
      getBars('QQQ', fromStr, to)
    ]);
    
    if (!spyBars || spyBars.length < 30 || !qqqBars || qqqBars.length < 30) {
      return null;
    }
    
    // Sort bars by time
    const sortedSpy = [...spyBars].sort((a, b) => a.t - b.t);
    const sortedQqq = [...qqqBars].sort((a, b) => a.t - b.t);
    
    // Calculate all metrics for SPY
    const spyCloses = sortedSpy.map(b => b.c);
    const spySma50 = sma(spyCloses, 50);
    const spySma200 = sortedSpy.length >= 200 ? sma(spyCloses, 200) : [];
    const spyLastIdx = sortedSpy.length - 1;
    const spyLastBar = sortedSpy[spyLastIdx];
    const spyPrevBar = sortedSpy[spyLastIdx - 1];
    
    const spyDistribution = countDistributionDays(sortedSpy);
    const spySlope = calculate50MASlope(sortedSpy);
    
    // Calculate all metrics for QQQ
    const qqqCloses = sortedQqq.map(b => b.c);
    const qqqSma50 = sma(qqqCloses, 50);
    const qqqSma200 = sortedQqq.length >= 200 ? sma(qqqCloses, 200) : [];
    const qqqLastIdx = sortedQqq.length - 1;
    const qqqLastBar = sortedQqq[qqqLastIdx];
    const qqqPrevBar = sortedQqq[qqqLastIdx - 1];
    
    const qqqDistribution = countDistributionDays(sortedQqq);
    
    // Calculate average volumes
    const spyVolumes = sortedSpy.slice(-50).map(b => b.v);
    const spyAvgVol = spyVolumes.reduce((a, b) => a + b, 0) / spyVolumes.length;
    
    const qqqVolumes = sortedQqq.slice(-50).map(b => b.v);
    const qqqAvgVol = qqqVolumes.reduce((a, b) => a + b, 0) / qqqVolumes.length;
    
    // Check for follow-through day
    const ftdCheck = checkFollowThroughDay(sortedSpy);
    
    // MA conditions
    const spyAbove50ma = spyLastBar.c > spySma50[spyLastIdx];
    const spyAbove200ma = spySma200.length > 0 ? spyLastBar.c > spySma200[spyLastIdx] : null;
    const qqqAbove50ma = qqqLastBar.c > qqqSma50[qqqLastIdx];
    const qqqAbove200ma = qqqSma200.length > 0 ? qqqLastBar.c > qqqSma200[qqqLastIdx] : null;
    
    // Determine regime
    const regimeResult = determineMarketRegime({
      spyAbove50ma,
      spyAbove200ma,
      qqqAbove50ma,
      qqqAbove200ma,
      spyDistributionCount: spyDistribution.count,
      qqqDistributionCount: qqqDistribution.count,
      spySlope50ma: spySlope,
      isFollowThroughDay: ftdCheck.isFollowThrough
    });
    
    // Daily change calculations
    const spyDailyChange = spyPrevBar ? ((spyLastBar.c - spyPrevBar.c) / spyPrevBar.c) * 100 : 0;
    const qqqDailyChange = qqqPrevBar ? ((qqqLastBar.c - qqqPrevBar.c) / qqqPrevBar.c) * 100 : 0;
    
    // Is today a distribution day?
    const spyIsDistribution = isDistributionDay(spyLastBar, spyPrevBar);
    const qqqIsDistribution = isDistributionDay(qqqLastBar, qqqPrevBar);
    
    const marketCondition = {
      date: to,
      
      // SPY stats
      spyClose: round2(spyLastBar.c),
      spySma50: round2(spySma50[spyLastIdx]),
      spySma200: spySma200.length > 0 ? round2(spySma200[spyLastIdx]) : null,
      spyAbove50ma,
      spyAbove200ma,
      spyDailyChangePct: round2(spyDailyChange),
      spyVolume: spyLastBar.v,
      spyAvgVolume50d: Math.round(spyAvgVol),
      spyIsDistributionDay: spyIsDistribution,
      spyDistributionCount25d: spyDistribution.count,
      spyDistributionDetails: spyDistribution.details,
      
      // QQQ stats
      qqqClose: round2(qqqLastBar.c),
      qqqSma50: round2(qqqSma50[qqqLastIdx]),
      qqqSma200: qqqSma200.length > 0 ? round2(qqqSma200[qqqLastIdx]) : null,
      qqqAbove50ma,
      qqqAbove200ma,
      qqqDailyChangePct: round2(qqqDailyChange),
      qqqVolume: qqqLastBar.v,
      qqqAvgVolume50d: Math.round(qqqAvgVol),
      qqqIsDistributionDay: qqqIsDistribution,
      qqqDistributionCount25d: qqqDistribution.count,
      qqqDistributionDetails: qqqDistribution.details,
      
      // Market regime
      marketRegime: regimeResult.regime,
      regimeConfidence: regimeResult.confidence,
      regimeFactors: regimeResult.factors,
      
      // Follow-through day
      isFollowThroughDay: ftdCheck.isFollowThrough,
      dayOfRally: ftdCheck.dayOfRally
    };
    
    // Save to database if configured
    if (isSupabaseConfigured()) {
      try {
        await saveMarketCondition(marketCondition);
      } catch (e) {
        console.warn('Could not save market condition:', e.message);
      }
    }
    
    return marketCondition;
    
  } catch (e) {
    console.error('Error fetching market condition:', e.message);
    return null;
  }
}

/**
 * Save market condition to Supabase
 */
async function saveMarketCondition(condition) {
  const supabase = getSupabase();
  if (!supabase) return;
  
  const row = {
    date: condition.date,
    spy_close: condition.spyClose,
    spy_sma_50: condition.spySma50,
    spy_sma_200: condition.spySma200,
    spy_above_50ma: condition.spyAbove50ma,
    spy_above_200ma: condition.spyAbove200ma,
    spy_daily_change_pct: condition.spyDailyChangePct,
    spy_volume: condition.spyVolume,
    spy_avg_volume_50d: condition.spyAvgVolume50d,
    spy_is_distribution_day: condition.spyIsDistributionDay,
    qqq_close: condition.qqqClose,
    qqq_sma_50: condition.qqqSma50,
    qqq_sma_200: condition.qqqSma200,
    qqq_above_50ma: condition.qqqAbove50ma,
    qqq_above_200ma: condition.qqqAbove200ma,
    qqq_daily_change_pct: condition.qqqDailyChangePct,
    qqq_volume: condition.qqqVolume,
    qqq_avg_volume_50d: condition.qqqAvgVolume50d,
    qqq_is_distribution_day: condition.qqqIsDistributionDay,
    spy_distribution_count_25d: condition.spyDistributionCount25d,
    qqq_distribution_count_25d: condition.qqqDistributionCount25d,
    market_regime: condition.marketRegime,
    regime_confidence: condition.regimeConfidence,
    is_follow_through_day: condition.isFollowThroughDay,
    days_since_correction: null, // Would need historical tracking
    updated_at: new Date().toISOString()
  };
  
  const { error } = await supabase
    .from('market_conditions')
    .upsert(row, { onConflict: 'date' });
  
  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Get historical market conditions for a date range
 * 
 * @param {string} fromDate - Start date YYYY-MM-DD
 * @param {string} toDate - End date YYYY-MM-DD
 * @returns {Promise<Array>} Array of market conditions
 */
export async function getHistoricalMarketConditions(fromDate, toDate) {
  if (!isSupabaseConfigured()) return [];
  
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('market_conditions')
    .select('*')
    .gte('date', fromDate)
    .lte('date', toDate)
    .order('date', { ascending: true });
  
  if (error) throw new Error(error.message);
  
  return data || [];
}

/**
 * Check if market is in correction (5+ distribution days)
 * 
 * @returns {Promise<boolean>}
 */
export async function isMarketInCorrection() {
  const condition = await getCurrentMarketCondition();
  if (!condition) return false;
  
  return condition.spyDistributionCount25d >= CORRECTION_THRESHOLD ||
         condition.qqqDistributionCount25d >= CORRECTION_THRESHOLD;
}

/**
 * Get market regime for position sizing decisions
 * 
 * @returns {Promise<Object>} { regime, confidence, shouldReduceExposure }
 */
export async function getMarketRegimeForSizing() {
  const condition = await getCurrentMarketCondition();
  if (!condition) {
    return { regime: 'UNKNOWN', confidence: 0, shouldReduceExposure: true };
  }
  
  const shouldReduceExposure = 
    condition.marketRegime === 'CORRECTION' ||
    condition.marketRegime === 'BEAR' ||
    condition.spyDistributionCount25d >= 4;
  
  return {
    regime: condition.marketRegime,
    confidence: condition.regimeConfidence,
    shouldReduceExposure,
    distributionDays: Math.max(
      condition.spyDistributionCount25d,
      condition.qqqDistributionCount25d
    )
  };
}

// Helper
function round2(val) {
  return val != null ? Math.round(val * 100) / 100 : null;
}

export {
  isDistributionDay,
  countDistributionDays,
  checkFollowThroughDay,
  determineMarketRegime
};
