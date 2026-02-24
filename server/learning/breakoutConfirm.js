/**
 * Breakout Confirmation Module
 * 
 * Validates breakout quality based on Minervini's criteria:
 * - Volume must be >40% above 50-day average
 * - Price must close above the pivot point
 * - Pattern must be complete (VCP, Cup-with-Handle, Flat Base)
 * 
 * This module:
 * 1. Calculates breakout volume ratio
 * 2. Determines if the breakout is confirmed
 * 3. Tracks breakout follow-through over 1-5 days
 * 4. Identifies failed breakouts for learning
 */

import { getSupabase, isSupabaseConfigured } from '../supabase.js';
import { getBars } from '../yahoo.js';
import { sma } from '../vcp.js';

const MIN_VOLUME_RATIO = 1.4;  // 40% above average
const PIVOT_TOLERANCE = 0.02;  // 2% tolerance for pivot

/**
 * Calculate the pivot/breakout price for a VCP or base pattern
 * 
 * Pivot = the highest high in the most recent contraction
 * (the price level that, when exceeded, triggers the breakout)
 * 
 * @param {Array} bars - OHLC bars sorted by time ascending
 * @param {number} lookbackDays - How far back to look (default 30)
 * @returns {Object} { pivotPrice, pivotDate, pivotIdx }
 */
export function calculatePivotPrice(bars, lookbackDays = 30) {
  if (!bars || bars.length < lookbackDays) {
    return { pivotPrice: null, pivotDate: null, pivotIdx: null };
  }
  
  const recent = bars.slice(-lookbackDays);
  
  // Find the highest high in the consolidation
  let maxHigh = 0;
  let pivotIdx = 0;
  
  for (let i = 0; i < recent.length - 1; i++) {
    if (recent[i].h > maxHigh) {
      maxHigh = recent[i].h;
      pivotIdx = i;
    }
  }
  
  // Adjust index to absolute position
  const absoluteIdx = bars.length - lookbackDays + pivotIdx;
  
  return {
    pivotPrice: Math.round(maxHigh * 100) / 100,
    pivotDate: new Date(bars[absoluteIdx].t).toISOString().slice(0, 10),
    pivotIdx: absoluteIdx
  };
}

/**
 * Calculate the 50-day average volume
 * 
 * @param {Array} bars - OHLC bars with volume
 * @returns {number} Average volume
 */
function calculate50DayAvgVolume(bars) {
  if (!bars || bars.length < 50) return 0;
  
  const volumes = bars.slice(-50).map(b => b.v || 0);
  return volumes.reduce((a, b) => a + b, 0) / 50;
}

/**
 * Check if a breakout is volume-confirmed
 * 
 * Minervini's criteria:
 * - Breakout day volume must be >40% above 50-day average
 * 
 * @param {Array} bars - OHLC bars with volume
 * @returns {Object} { confirmed, volumeRatio, breakoutVolume, avgVolume }
 */
export function checkVolumeConfirmation(bars) {
  if (!bars || bars.length < 55) {
    return {
      confirmed: false,
      volumeRatio: null,
      breakoutVolume: null,
      avgVolume: null,
      reason: 'Insufficient data'
    };
  }
  
  const lastBar = bars[bars.length - 1];
  const breakoutVolume = lastBar.v || 0;
  
  // Calculate average using bars BEFORE today
  const avgVolume = calculate50DayAvgVolume(bars.slice(0, -1));
  
  if (avgVolume === 0) {
    return {
      confirmed: false,
      volumeRatio: null,
      breakoutVolume,
      avgVolume,
      reason: 'No volume data'
    };
  }
  
  const volumeRatio = breakoutVolume / avgVolume;
  const confirmed = volumeRatio >= MIN_VOLUME_RATIO;
  
  return {
    confirmed,
    volumeRatio: Math.round(volumeRatio * 100) / 100,
    breakoutVolume,
    avgVolume: Math.round(avgVolume),
    reason: confirmed 
      ? `Volume ${Math.round((volumeRatio - 1) * 100)}% above average`
      : `Volume only ${Math.round((volumeRatio - 1) * 100)}% above average (need 40%+)`
  };
}

/**
 * Analyze a breakout and track its follow-through
 * 
 * @param {string} ticker - Stock ticker
 * @param {string} breakoutDate - Date of breakout (YYYY-MM-DD)
 * @param {number} pivotPrice - The pivot/breakout price
 * @param {Object} patternData - Pattern type and confidence
 * @returns {Promise<Object>} Complete breakout analysis
 */
export async function analyzeBreakout(ticker, breakoutDate, pivotPrice, patternData = {}) {
  // Fetch bars around the breakout
  const from = new Date(breakoutDate);
  from.setDate(from.getDate() - 60);
  const to = new Date(breakoutDate);
  to.setDate(to.getDate() + 10);
  
  const bars = await getBars(ticker, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10));
  
  if (!bars || bars.length < 50) {
    return { error: 'Insufficient bar data' };
  }
  
  const sorted = [...bars].sort((a, b) => a.t - b.t);
  
  // Find the breakout day index
  const breakoutTs = new Date(breakoutDate).getTime();
  let breakoutIdx = sorted.findIndex(b => {
    const barDate = new Date(b.t).toISOString().slice(0, 10);
    return barDate === breakoutDate;
  });
  
  if (breakoutIdx === -1) {
    breakoutIdx = sorted.length - 1;
  }
  
  const breakoutBar = sorted[breakoutIdx];
  
  // Volume confirmation
  const priorBars = sorted.slice(0, breakoutIdx + 1);
  const volumeCheck = checkVolumeConfirmation(priorBars);
  
  // Calculate pivot if not provided
  const actualPivot = pivotPrice || calculatePivotPrice(priorBars).pivotPrice;
  
  // Price above pivot?
  const pctAbovePivot = actualPivot > 0 
    ? ((breakoutBar.c - actualPivot) / actualPivot) * 100 
    : 0;
  
  // Track follow-through days
  const followThrough = {};
  for (const days of [1, 2, 3, 5]) {
    const idx = breakoutIdx + days;
    if (idx < sorted.length) {
      const bar = sorted[idx];
      followThrough[`day${days}Close`] = bar.c;
      followThrough[`day${days}Held`] = bar.c > actualPivot;
    }
  }
  
  // Max gain and drawdown in first 5 days
  let maxHigh = breakoutBar.h;
  let maxLow = breakoutBar.l;
  
  for (let i = breakoutIdx + 1; i <= Math.min(breakoutIdx + 5, sorted.length - 1); i++) {
    maxHigh = Math.max(maxHigh, sorted[i].h);
    maxLow = Math.min(maxLow, sorted[i].l);
  }
  
  const maxGain5dPct = actualPivot > 0 ? ((maxHigh - breakoutBar.c) / breakoutBar.c) * 100 : 0;
  const maxDrawdown5dPct = actualPivot > 0 ? ((breakoutBar.c - maxLow) / breakoutBar.c) * 100 : 0;
  
  // Did breakout succeed? (Price held above pivot after 5 days)
  const day5Bar = sorted[breakoutIdx + 5];
  const breakoutSucceeded = day5Bar ? day5Bar.c > actualPivot : null;
  
  // Classify failure reason if applicable
  let failedReason = null;
  if (breakoutSucceeded === false) {
    if (!volumeCheck.confirmed) {
      failedReason = 'VOLUME_NOT_CONFIRMED';
    } else if (maxDrawdown5dPct > 8) {
      failedReason = 'DEEP_PULLBACK';
    } else if (followThrough.day1Held === false) {
      failedReason = 'IMMEDIATE_REVERSAL';
    } else {
      failedReason = 'GRADUAL_FAILURE';
    }
  }
  
  // Base metrics
  const baseMetrics = calculateBaseMetrics(priorBars, actualPivot);
  
  const analysis = {
    ticker,
    breakoutDate,
    pivotPrice: Math.round(actualPivot * 100) / 100,
    breakoutClose: breakoutBar.c,
    pctAbovePivot: Math.round(pctAbovePivot * 100) / 100,
    
    // Volume
    breakoutVolume: breakoutBar.v,
    avgVolume50d: volumeCheck.avgVolume,
    volumeRatio: volumeCheck.volumeRatio,
    volumeConfirmed: volumeCheck.confirmed,
    
    // Pattern
    patternType: patternData.pattern || 'Unknown',
    patternConfidence: patternData.confidence || 0,
    baseDepthPct: baseMetrics.depthPct,
    baseDurationDays: baseMetrics.durationDays,
    
    // Follow-through
    ...followThrough,
    
    // Outcome
    breakoutSucceeded,
    maxGain5dPct: Math.round(maxGain5dPct * 100) / 100,
    maxDrawdown5dPct: Math.round(maxDrawdown5dPct * 100) / 100,
    failedReason
  };
  
  // Save to database
  if (isSupabaseConfigured()) {
    await saveBreakoutAnalysis(analysis);
  }
  
  return analysis;
}

/**
 * Calculate base metrics for breakout context
 */
function calculateBaseMetrics(bars, pivotPrice) {
  if (!bars || bars.length < 30) {
    return { depthPct: null, durationDays: null };
  }
  
  const lookback = Math.min(bars.length, 120);
  const recent = bars.slice(-lookback);
  
  // Find lowest low in the base
  const lows = recent.map(b => b.l);
  const lowestLow = Math.min(...lows);
  
  // Base depth = (pivot - lowest) / pivot
  const depthPct = pivotPrice > 0 
    ? ((pivotPrice - lowestLow) / pivotPrice) * 100 
    : 0;
  
  // Duration = days from lowest low to breakout
  const lowIdx = lows.lastIndexOf(lowestLow);
  const durationDays = recent.length - lowIdx;
  
  return {
    depthPct: Math.round(depthPct * 10) / 10,
    durationDays
  };
}

/**
 * Save breakout analysis to database
 */
async function saveBreakoutAnalysis(analysis) {
  const supabase = getSupabase();
  if (!supabase) return;
  
  const row = {
    ticker: analysis.ticker,
    breakout_date: analysis.breakoutDate,
    pivot_price: analysis.pivotPrice,
    breakout_close: analysis.breakoutClose,
    pct_above_pivot: analysis.pctAbovePivot,
    breakout_volume: analysis.breakoutVolume,
    avg_volume_50d: analysis.avgVolume50d,
    volume_ratio: analysis.volumeRatio,
    volume_confirmed: analysis.volumeConfirmed,
    pattern_type: analysis.patternType,
    pattern_confidence: analysis.patternConfidence,
    base_depth_pct: analysis.baseDepthPct,
    base_duration_days: analysis.baseDurationDays,
    day_1_close: analysis.day1Close,
    day_1_held: analysis.day1Held,
    day_2_close: analysis.day2Close,
    day_2_held: analysis.day2Held,
    day_3_close: analysis.day3Close,
    day_3_held: analysis.day3Held,
    day_5_close: analysis.day5Close,
    day_5_held: analysis.day5Held,
    breakout_succeeded: analysis.breakoutSucceeded,
    max_gain_5d_pct: analysis.maxGain5dPct,
    max_drawdown_5d_pct: analysis.maxDrawdown5dPct,
    failed_reason: analysis.failedReason,
    updated_at: new Date().toISOString()
  };
  
  const { error } = await supabase
    .from('breakout_tracking')
    .upsert(row, { onConflict: 'ticker,breakout_date' });
  
  if (error) {
    console.error('Failed to save breakout analysis:', error.message);
  }
}

/**
 * Get breakout success rate by volume confirmation
 * 
 * @returns {Promise<Object>} Stats comparing confirmed vs unconfirmed breakouts
 */
export async function getBreakoutStats() {
  if (!isSupabaseConfigured()) return null;
  
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('breakout_tracking')
    .select('volume_confirmed, breakout_succeeded')
    .not('breakout_succeeded', 'is', null);
  
  if (error) throw new Error(error.message);
  
  const confirmed = { total: 0, succeeded: 0 };
  const unconfirmed = { total: 0, succeeded: 0 };
  
  for (const row of (data || [])) {
    if (row.volume_confirmed) {
      confirmed.total++;
      if (row.breakout_succeeded) confirmed.succeeded++;
    } else {
      unconfirmed.total++;
      if (row.breakout_succeeded) unconfirmed.succeeded++;
    }
  }
  
  return {
    confirmed: {
      ...confirmed,
      successRate: confirmed.total > 0 
        ? Math.round((confirmed.succeeded / confirmed.total) * 100) 
        : null
    },
    unconfirmed: {
      ...unconfirmed,
      successRate: unconfirmed.total > 0 
        ? Math.round((unconfirmed.succeeded / unconfirmed.total) * 100) 
        : null
    },
    volumeImpact: confirmed.total > 0 && unconfirmed.total > 0
      ? Math.round(((confirmed.succeeded / confirmed.total) - 
          (unconfirmed.succeeded / unconfirmed.total)) * 100)
      : null
  };
}

/**
 * Validate a potential entry for breakout quality
 * 
 * This is called BEFORE entering a trade to ensure breakout criteria are met.
 * 
 * @param {Array} bars - OHLC bars with volume
 * @param {number} pivotPrice - The pivot/breakout price
 * @returns {Object} { valid, confidence, issues }
 */
export function validateBreakoutEntry(bars, pivotPrice) {
  const issues = [];
  let confidence = 100;
  
  if (!bars || bars.length < 55) {
    return { valid: false, confidence: 0, issues: ['Insufficient data'] };
  }
  
  const lastBar = bars[bars.length - 1];
  const volumeCheck = checkVolumeConfirmation(bars);
  
  // Check 1: Volume confirmation
  if (!volumeCheck.confirmed) {
    issues.push(`Volume ${volumeCheck.volumeRatio}x (need 1.4x)`);
    confidence -= 30;
  }
  
  // Check 2: Price above pivot
  const pctAbovePivot = pivotPrice > 0 
    ? ((lastBar.c - pivotPrice) / pivotPrice) * 100 
    : 0;
  
  if (lastBar.c < pivotPrice) {
    issues.push(`Price ${Math.abs(pctAbovePivot).toFixed(1)}% below pivot`);
    confidence -= 40;
  }
  
  // Check 3: Not too extended (>5% above pivot)
  if (pctAbovePivot > 5) {
    issues.push(`Price ${pctAbovePivot.toFixed(1)}% above pivot (chasing)`);
    confidence -= 20;
  }
  
  // Check 4: Close not below intraday low (weak close)
  const closeVsRange = (lastBar.c - lastBar.l) / (lastBar.h - lastBar.l || 1);
  if (closeVsRange < 0.3) {
    issues.push('Weak close (lower third of range)');
    confidence -= 15;
  }
  
  return {
    valid: confidence >= 60,
    confidence: Math.max(0, confidence),
    issues,
    volumeRatio: volumeCheck.volumeRatio,
    pctAbovePivot: Math.round(pctAbovePivot * 100) / 100
  };
}

export { calculate50DayAvgVolume };
