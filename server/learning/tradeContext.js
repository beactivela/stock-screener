/**
 * Trade Context Snapshot Module
 * 
 * Captures the FULL trading context at the moment of entry.
 * This snapshot is essential for post-mortem analysis and self-learning.
 * 
 * For every trade, we capture:
 * - All moving averages and their alignment
 * - VCP pattern quality metrics
 * - Breakout volume confirmation
 * - 52-week statistics
 * - Relative strength data
 * - Market condition (regime, distribution days)
 * - Industry context
 * - Fundamentals
 * - Opus4.5 signal metrics
 * 
 * This allows the learning engine to analyze WHY trades failed
 * by comparing entry conditions to outcomes.
 */

import { getSupabase, isSupabaseConfigured } from '../supabase.js';
import { sma } from '../vcp.js';
import { getCurrentMarketCondition } from './distributionDays.js';

/**
 * Calculate all moving averages for a stock
 * 
 * @param {Array} bars - OHLC bars sorted by time ascending
 * @returns {Object} All MA values and alignment status
 */
function calculateAllMAs(bars) {
  if (!bars || bars.length < 200) {
    return {
      sma10: null, sma20: null, sma50: null, sma150: null, sma200: null,
      maAlignmentValid: false, priceAboveAllMAs: false, ma200Rising: false,
      ma10Slope14d: null, ma10Slope5d: null
    };
  }
  
  const closes = bars.map(b => b.c);
  const lastIdx = bars.length - 1;
  
  const sma10Arr = sma(closes, 10);
  const sma20Arr = sma(closes, 20);
  const sma50Arr = sma(closes, 50);
  const sma150Arr = sma(closes, 150);
  const sma200Arr = sma(closes, 200);
  
  const current = {
    sma10: sma10Arr[lastIdx],
    sma20: sma20Arr[lastIdx],
    sma50: sma50Arr[lastIdx],
    sma150: sma150Arr[lastIdx],
    sma200: sma200Arr[lastIdx],
    price: closes[lastIdx]
  };
  
  // MA Alignment: 50 > 150 > 200 (Minervini Stage 2)
  const maAlignmentValid = current.sma50 > current.sma150 && 
                           current.sma150 > current.sma200;
  
  // Price above all MAs
  const priceAboveAllMAs = current.price > current.sma10 &&
                           current.price > current.sma20 &&
                           current.price > current.sma50 &&
                           current.price > current.sma150 &&
                           current.price > current.sma200;
  
  // 200 MA rising (compare to 20 days ago)
  const sma200_20dAgo = sma200Arr[lastIdx - 20];
  const ma200Rising = current.sma200 > sma200_20dAgo;
  
  // 10 MA slope calculations
  const sma10_14dAgo = sma10Arr[lastIdx - 14];
  const sma10_5dAgo = sma10Arr[lastIdx - 5];
  
  const ma10Slope14d = sma10_14dAgo > 0 
    ? ((current.sma10 - sma10_14dAgo) / sma10_14dAgo) * 100 
    : 0;
  const ma10Slope5d = sma10_5dAgo > 0 
    ? ((current.sma10 - sma10_5dAgo) / sma10_5dAgo) * 100 
    : 0;
  
  return {
    sma10: round2(current.sma10),
    sma20: round2(current.sma20),
    sma50: round2(current.sma50),
    sma150: round2(current.sma150),
    sma200: round2(current.sma200),
    maAlignmentValid,
    priceAboveAllMAs,
    ma200Rising,
    ma10Slope14d: round2(ma10Slope14d),
    ma10Slope5d: round2(ma10Slope5d)
  };
}

/**
 * Calculate base depth and duration from pullback data
 * 
 * @param {Array} bars - OHLC bars
 * @param {number} lookbackDays - How far back to look for base (default 120)
 * @returns {Object} { baseDepthPct, baseDurationDays }
 */
function calculateBaseMetrics(bars, lookbackDays = 120) {
  if (!bars || bars.length < 50) {
    return { baseDepthPct: null, baseDurationDays: null };
  }
  
  const recent = bars.slice(-lookbackDays);
  const highs = recent.map(b => b.h);
  const lows = recent.map(b => b.l);
  
  const highestHigh = Math.max(...highs);
  const lowestLow = Math.min(...lows);
  
  // Base depth = (highest - lowest) / highest * 100
  const baseDepthPct = ((highestHigh - lowestLow) / highestHigh) * 100;
  
  // Base duration = days since the highest high
  const highIdx = highs.lastIndexOf(highestHigh);
  const baseDurationDays = recent.length - highIdx;
  
  return {
    baseDepthPct: round2(baseDepthPct),
    baseDurationDays
  };
}

/**
 * Calculate 52-week statistics
 * 
 * @param {Array} bars - OHLC bars (need ~252 for full year)
 * @returns {Object} 52-week high, low, and relative position
 */
function calculate52WeekStats(bars) {
  if (!bars || bars.length < 50) {
    return { high52w: null, low52w: null, pctFromHigh: null, pctAboveLow: null };
  }
  
  const lookback = Math.min(252, bars.length);
  const recentBars = bars.slice(-lookback);
  
  const highs = recentBars.map(b => b.h);
  const lows = recentBars.map(b => b.l);
  const currentPrice = bars[bars.length - 1].c;
  
  const high52w = Math.max(...highs);
  const low52w = Math.min(...lows);
  
  const pctFromHigh = ((high52w - currentPrice) / high52w) * 100;
  const pctAboveLow = ((currentPrice - low52w) / low52w) * 100;
  
  return {
    high52w: round2(high52w),
    low52w: round2(low52w),
    pctFromHigh: round2(pctFromHigh),
    pctAboveLow: round2(pctAboveLow)
  };
}

/**
 * Calculate breakout volume metrics
 * 
 * @param {Array} bars - OHLC bars with volume
 * @param {number} pivotPrice - The pivot/breakout price level
 * @returns {Object} Volume ratio and confirmation status
 */
function calculateBreakoutVolume(bars, pivotPrice = null) {
  if (!bars || bars.length < 55) {
    return { 
      breakoutVolumeRatio: null, 
      breakoutConfirmed: false, 
      pivotPrice: null,
      entryVsPivotPct: null 
    };
  }
  
  const lastBar = bars[bars.length - 1];
  const volumes = bars.slice(-51, -1).map(b => b.v || 0);
  const avgVolume50d = volumes.reduce((a, b) => a + b, 0) / 50;
  
  const breakoutVolume = lastBar.v || 0;
  const breakoutVolumeRatio = avgVolume50d > 0 ? breakoutVolume / avgVolume50d : null;
  
  // Volume > 40% above average = confirmed breakout
  const breakoutConfirmed = breakoutVolumeRatio !== null && breakoutVolumeRatio >= 1.4;
  
  // If no pivot provided, estimate from recent high before pullback
  const estimatedPivot = pivotPrice || Math.max(...bars.slice(-20, -1).map(b => b.h));
  const entryVsPivotPct = estimatedPivot > 0 
    ? ((lastBar.c - estimatedPivot) / estimatedPivot) * 100 
    : null;
  
  return {
    breakoutVolumeRatio: round2(breakoutVolumeRatio),
    breakoutConfirmed,
    pivotPrice: round2(estimatedPivot),
    entryVsPivotPct: round2(entryVsPivotPct)
  };
}

/**
 * Create a full trade context snapshot at entry
 * 
 * This is THE core function for the learning system.
 * It captures EVERYTHING needed to analyze why a trade succeeded or failed.
 * 
 * @param {Object} params - All required parameters
 * @param {string} params.tradeId - UUID of the trade
 * @param {string} params.ticker - Stock ticker symbol
 * @param {number} params.entryPrice - Entry price
 * @param {Date|string} params.entryDate - Entry date
 * @param {Array} params.bars - OHLC bars for the stock
 * @param {Object} params.vcpResult - VCP analysis result (from checkVCP)
 * @param {Object} params.opus45Signal - Opus4.5 signal result (optional)
 * @param {Object} params.fundamentals - Company fundamentals (optional)
 * @param {Object} params.industryData - Industry ranking data (optional)
 * @param {string} params.entryReason - Why this trade was taken (optional)
 * @param {number} params.conviction - Conviction level 1-5 (optional)
 * @returns {Object} The complete context snapshot
 */
export async function createTradeContextSnapshot(params) {
  const {
    tradeId,
    ticker,
    entryPrice,
    entryDate,
    bars,
    vcpResult = {},
    opus45Signal = {},
    fundamentals = {},
    industryData = {},
    entryReason = null,
    conviction = 3
  } = params;
  
  // Calculate all MA data
  const maData = calculateAllMAs(bars);
  
  // Calculate base metrics
  const baseMetrics = calculateBaseMetrics(bars);
  
  // Calculate 52-week stats
  const stats52w = calculate52WeekStats(bars);
  
  // Calculate breakout volume
  const breakoutData = calculateBreakoutVolume(bars, vcpResult.pivotPrice);
  
  // Get current market condition (async - distribution days, regime)
  let marketCondition = {
    marketRegime: 'UNKNOWN',
    spyDistributionDays: null,
    qqqDistributionDays: null,
    marketInCorrection: false,
    spyAbove50ma: null,
    spyAbove200ma: null
  };
  
  try {
    const mc = await getCurrentMarketCondition();
    if (mc) {
      marketCondition = {
        marketRegime: mc.marketRegime || 'UNKNOWN',
        spyDistributionDays: mc.spyDistributionCount25d,
        qqqDistributionDays: mc.qqqDistributionCount25d,
        marketInCorrection: mc.spyDistributionCount25d >= 5 || mc.qqqDistributionCount25d >= 5,
        spyAbove50ma: mc.spyAbove50ma,
        spyAbove200ma: mc.spyAbove200ma
      };
    }
  } catch (e) {
    console.warn('Could not fetch market condition:', e.message);
  }
  
  // Build the complete snapshot object
  const snapshot = {
    tradeId,
    ticker,
    snapshotDate: typeof entryDate === 'string' ? entryDate : entryDate.toISOString().slice(0, 10),
    
    // Price & MA Data
    entryPrice,
    sma10: maData.sma10,
    sma20: maData.sma20,
    sma50: maData.sma50,
    sma150: maData.sma150,
    sma200: maData.sma200,
    
    // MA Alignment
    maAlignmentValid: maData.maAlignmentValid,
    priceAboveAllMAs: maData.priceAboveAllMAs,
    ma200Rising: maData.ma200Rising,
    ma10Slope14d: maData.ma10Slope14d,
    ma10Slope5d: maData.ma10Slope5d,
    
    // VCP Pattern Quality
    vcpValid: vcpResult.vcpBullish || false,
    contractions: vcpResult.contractions || 0,
    pullbackPcts: vcpResult.pullbackPcts || [],
    baseDepthPct: baseMetrics.baseDepthPct,
    baseDurationDays: baseMetrics.baseDurationDays,
    volumeDryUp: vcpResult.volumeDryUp || false,
    patternType: vcpResult.pattern || 'Unknown',
    patternConfidence: vcpResult.patternConfidence || 0,
    
    // Breakout Quality
    breakoutVolumeRatio: breakoutData.breakoutVolumeRatio,
    breakoutConfirmed: breakoutData.breakoutConfirmed,
    pivotPrice: breakoutData.pivotPrice,
    entryVsPivotPct: breakoutData.entryVsPivotPct,
    
    // 52-Week Stats
    high52w: stats52w.high52w,
    low52w: stats52w.low52w,
    pctFromHigh: stats52w.pctFromHigh,
    pctAboveLow: stats52w.pctAboveLow,
    
    // Relative Strength
    relativeStrength: vcpResult.relativeStrength || vcpResult.rsData?.rs || null,
    rsVsSpy6m: vcpResult.rsData?.stockChange || null,
    rsRankingPercentile: null, // Would need full universe to calculate
    
    // Market Condition
    marketRegime: marketCondition.marketRegime,
    spyDistributionDays: marketCondition.spyDistributionDays,
    qqqDistributionDays: marketCondition.qqqDistributionDays,
    marketInCorrection: marketCondition.marketInCorrection,
    spyAbove50ma: marketCondition.spyAbove50ma,
    spyAbove200ma: marketCondition.spyAbove200ma,
    
    // Industry Context
    industryName: fundamentals?.industry || industryData?.name || null,
    industryRank: industryData?.rank || null,
    sectorName: fundamentals?.sector || null,
    
    // Fundamentals
    epsGrowthQtr: fundamentals?.qtrEarningsYoY || null,
    epsGrowthAnnual: null, // Would need historical data
    institutionalOwnership: fundamentals?.pctHeldByInst || null,
    profitMargin: fundamentals?.profitMargin || null,
    
    // Opus4.5 Signal Data
    opus45Confidence: opus45Signal?.opus45Confidence || null,
    opus45Grade: opus45Signal?.opus45Grade || null,
    enhancedScore: vcpResult.enhancedScore || vcpResult.score || null,
    
    // Additional Context
    entryReason,
    convictionLevel: conviction
  };
  
  // Save to database if Supabase is configured
  if (isSupabaseConfigured()) {
    try {
      await saveContextSnapshot(snapshot);
    } catch (e) {
      console.error('Failed to save context snapshot:', e.message);
    }
  }
  
  return snapshot;
}

/**
 * Save context snapshot to Supabase
 * 
 * @param {Object} snapshot - The context snapshot object
 * @returns {Promise<Object>} The saved snapshot with ID
 */
async function saveContextSnapshot(snapshot) {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase not configured');
  
  const row = {
    trade_id: snapshot.tradeId,
    ticker: snapshot.ticker,
    snapshot_date: snapshot.snapshotDate,
    entry_price: snapshot.entryPrice,
    sma_10: snapshot.sma10,
    sma_20: snapshot.sma20,
    sma_50: snapshot.sma50,
    sma_150: snapshot.sma150,
    sma_200: snapshot.sma200,
    ma_alignment_valid: snapshot.maAlignmentValid,
    price_above_all_mas: snapshot.priceAboveAllMAs,
    ma_200_rising: snapshot.ma200Rising,
    ma_10_slope_14d: snapshot.ma10Slope14d,
    ma_10_slope_5d: snapshot.ma10Slope5d,
    vcp_valid: snapshot.vcpValid,
    contractions: snapshot.contractions,
    pullback_pcts: snapshot.pullbackPcts,
    base_depth_pct: snapshot.baseDepthPct,
    base_duration_days: snapshot.baseDurationDays,
    volume_dry_up: snapshot.volumeDryUp,
    pattern_type: snapshot.patternType,
    pattern_confidence: snapshot.patternConfidence,
    breakout_volume_ratio: snapshot.breakoutVolumeRatio,
    breakout_confirmed: snapshot.breakoutConfirmed,
    pivot_price: snapshot.pivotPrice,
    entry_vs_pivot_pct: snapshot.entryVsPivotPct,
    high_52w: snapshot.high52w,
    low_52w: snapshot.low52w,
    pct_from_high: snapshot.pctFromHigh,
    pct_above_low: snapshot.pctAboveLow,
    relative_strength: snapshot.relativeStrength,
    rs_vs_spy_6m: snapshot.rsVsSpy6m,
    rs_ranking_percentile: snapshot.rsRankingPercentile,
    market_regime: snapshot.marketRegime,
    spy_distribution_days: snapshot.spyDistributionDays,
    qqq_distribution_days: snapshot.qqqDistributionDays,
    market_in_correction: snapshot.marketInCorrection,
    spy_above_50ma: snapshot.spyAbove50ma,
    spy_above_200ma: snapshot.spyAbove200ma,
    industry_name: snapshot.industryName,
    industry_rank: snapshot.industryRank,
    sector_name: snapshot.sectorName,
    eps_growth_qtr: snapshot.epsGrowthQtr,
    eps_growth_annual: snapshot.epsGrowthAnnual,
    institutional_ownership: snapshot.institutionalOwnership,
    profit_margin: snapshot.profitMargin,
    opus45_confidence: snapshot.opus45Confidence,
    opus45_grade: snapshot.opus45Grade,
    enhanced_score: snapshot.enhancedScore,
    entry_reason: snapshot.entryReason,
    conviction_level: snapshot.convictionLevel
  };
  
  const { data, error } = await supabase
    .from('trade_context_snapshots')
    .insert(row)
    .select()
    .single();
  
  if (error) throw new Error(error.message);
  
  return data;
}

/**
 * Get context snapshot for a trade
 * 
 * @param {string} tradeId - UUID of the trade
 * @returns {Promise<Object|null>} The context snapshot or null
 */
export async function getContextSnapshotByTradeId(tradeId) {
  if (!isSupabaseConfigured()) return null;
  
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('trade_context_snapshots')
    .select('*')
    .eq('trade_id', tradeId)
    .single();
  
  if (error || !data) return null;
  
  return snakeToCamel(data);
}

/**
 * Get all context snapshots for analysis
 * 
 * @param {Object} filters - Optional filters
 * @returns {Promise<Array>} Array of context snapshots
 */
export async function getContextSnapshots(filters = {}) {
  if (!isSupabaseConfigured()) return [];
  
  const supabase = getSupabase();
  let query = supabase.from('trade_context_snapshots').select('*');
  
  if (filters.ticker) {
    query = query.eq('ticker', filters.ticker);
  }
  if (filters.marketRegime) {
    query = query.eq('market_regime', filters.marketRegime);
  }
  if (filters.fromDate) {
    query = query.gte('snapshot_date', filters.fromDate);
  }
  if (filters.toDate) {
    query = query.lte('snapshot_date', filters.toDate);
  }
  
  query = query.order('snapshot_date', { ascending: false });
  
  const { data, error } = await query;
  
  if (error) throw new Error(error.message);
  
  return (data || []).map(snakeToCamel);
}

// Helper: Round to 2 decimal places
function round2(val) {
  return val != null ? Math.round(val * 100) / 100 : null;
}

// Helper: Convert snake_case to camelCase for JS objects
function snakeToCamel(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    result[camelKey] = value;
  }
  return result;
}

export {
  calculateAllMAs,
  calculateBaseMetrics,
  calculate52WeekStats,
  calculateBreakoutVolume
};
