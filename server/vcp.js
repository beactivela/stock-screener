/**
 * VCP (Volatility Contraction Pattern) detection – Minervini-style.
 * Uses daily bars; we compute 10/20/50 SMA from closes, volume analysis from v.
 * 
 * IMPROVEMENT: Added Relative Strength calculation vs SPY
 * IMPROVEMENT: Added pattern detection (VCP, Flat Base, Cup-with-Handle)
 */

import { identifyPattern } from './patternDetection.js';
import { computeUnusualVolume } from './utils/unusualVolume.js';

function sma(closes, period) {
  const out = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      out.push(null);
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    out.push(sum / period);
  }
  return out;
}

/**
 * Volume SMA for comparison (e.g. 20-day avg volume).
 */
function volumeSma(volumes, period) {
  const out = [];
  for (let i = 0; i < volumes.length; i++) {
    if (i < period - 1) {
      out.push(null);
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += (volumes[j] ?? 0);
    out.push(sum / period);
  }
  return out;
}

/**
 * Find pullbacks in recent bars: each is a local high -> subsequent low.
 * Returns array of { highIdx, lowIdx, highPrice, lowPrice, pct, avgVolume }.
 * avgVolume = average volume during pullback (highIdx to lowIdx inclusive).
 */
function findPullbacks(bars, lookback = 120) {
  const recent = bars.slice(-lookback);
  const pullbacks = [];
  let i = 0;
  while (i < recent.length - 1) {
    // local high: higher than prev and next
    const idx = i;
    const h = recent[idx].c;
    const prev = recent[idx - 1]?.c;
    const next = recent[idx + 1]?.c;
    if (prev != null && next != null && h >= prev && h >= next) {
      let lowIdx = idx + 1;
      let low = recent[lowIdx]?.l ?? recent[lowIdx]?.c;
      for (let j = idx + 1; j < recent.length; j++) {
        const l = recent[j].l ?? recent[j].c;
        if (l < low) {
          low = l;
          lowIdx = j;
        }
        // next close above this low = end of pullback
        if (recent[j].c > low * 1.01) break;
      }
      const pct = h > 0 ? ((h - low) / h) * 100 : 0;
      // Avg volume during pullback (drying up = bullish)
      let volSum = 0;
      let volCount = 0;
      for (let k = idx; k <= lowIdx; k++) {
        const v = recent[k]?.v ?? recent[k]?.vw;
        if (v != null && v > 0) {
          volSum += v;
          volCount++;
        }
      }
      const avgVolume = volCount > 0 ? volSum / volCount : null;
      pullbacks.push({ highIdx: idx, lowIdx, highPrice: h, lowPrice: low, pct, avgVolume });
      i = lowIdx + 1;
    } else {
      i++;
    }
  }
  return pullbacks;
}

/**
 * Check if price is "at" a moving average (within tolerance %).
 */
function nearMA(price, ma, tolerancePct = 2) {
  if (ma == null || ma <= 0) return false;
  const diff = Math.abs(price - ma) / ma;
  return diff <= tolerancePct / 100;
}

/**
 * Calculate relative strength vs SPY (6-month performance)
 * RS = (Stock % Change / SPY % Change) * 100
 * RS > 100 = outperforming SPY, RS < 100 = underperforming
 * 
 * @param {Array} stockBars - Stock's OHLC bars (at least 120 days)
 * @param {Array} spyBars - SPY's OHLC bars (at least 120 days)
 * @returns {Object|null} { rs, stockChange, spyChange, outperforming } or null
 */
function calculateRelativeStrength(stockBars, spyBars) {
  if (!stockBars || stockBars.length < 120 || !spyBars || spyBars.length < 120) {
    return null;
  }
  
  try {
    // Get prices from 6 months ago (120 trading days)
    const stockClose_6mo = stockBars[stockBars.length - 120].c;
    const stockClose_now = stockBars[stockBars.length - 1].c;
    const stockChange = ((stockClose_now - stockClose_6mo) / stockClose_6mo) * 100;
    
    const spyClose_6mo = spyBars[spyBars.length - 120].c;
    const spyClose_now = spyBars[spyBars.length - 1].c;
    const spyChange = ((spyClose_now - spyClose_6mo) / spyClose_6mo) * 100;
    
    // Avoid division by zero or very small numbers
    if (Math.abs(spyChange) < 0.01) return null;
    
    const rs = (stockChange / spyChange) * 100;
    
    return {
      rs: Math.round(rs * 10) / 10, // Round to 1 decimal
      stockChange: Math.round(stockChange * 100) / 100,
      spyChange: Math.round(spyChange * 100) / 100,
      outperforming: rs > 100
    };
  } catch (e) {
    return null;
  }
}

/**
 * Run VCP check on one ticker's bar series.
 * bars: array of { o, h, l, c, v, t } (ascending by t).
 * spyBars: optional SPY bars for RS calculation (NEW)
 * Returns { vcpBullish, contractions, atMa10, atMa20, atMa50, lastClose, sma10, sma20, sma50, relativeStrength, pattern, patternConfidence }.
 */
function checkVCP(bars, spyBars = null) {
  if (!bars || bars.length < 60) {
    const { scoreBreakdown } = computeBuyScore({ reason: 'not_enough_bars' });
    return { 
      vcpBullish: false, 
      reason: 'not_enough_bars', 
      score: 0, 
      recommendation: 'avoid', 
      volumeDryUp: false, 
      volumeRatio: null, 
      idealPullbackSetup: false, 
      idealPullbackBarTimes: [], 
      unusualVolumeToday: false,
      unusualVolume5d: false,
      scoreBreakdown, 
      relativeStrength: null, 
      rsData: null,
      pattern: 'None',
      patternConfidence: 0,
      ma10Slope14d: null,
      pctFromHigh: null,
      breakoutVolumeRatio: null,
      turtleBreakout20: false,
      turtleBreakout55: false,
      priceAboveAllMAs: false,
      ma200Rising: false
    };
  }

  const closes = bars.map((b) => b.c);
  const sma10 = sma(closes, 10);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma150 = sma(closes, 150);
  const sma200 = sma(closes, 200);

  const lastIdx = bars.length - 1;
  const lastClose = closes[lastIdx];
  const last10 = sma10[lastIdx];
  const last20 = sma20[lastIdx];
  const last50 = sma50[lastIdx];
  const last150 = sma150[lastIdx];
  const last200 = sma200[lastIdx];
  
  // Calculate Relative Strength vs SPY (NEW)
  const rsData = spyBars ? calculateRelativeStrength(bars, spyBars) : null;
  const relativeStrength = rsData?.rs ?? null;

  // Stage 2: price above 50 SMA
  if (last50 != null && lastClose < last50) {
    const raw = { 
      vcpBullish: false, 
      reason: 'below_50_ma', 
      lastClose, 
      sma10: last10, 
      sma20: last20, 
      sma50: last50, 
      contractions: 0, 
      atMa10: false, 
      atMa20: false, 
      atMa50: false, 
      volumeDryUp: false, 
      volumeRatio: null, 
      idealPullbackSetup: false, 
      idealPullbackBarTimes: [], 
      unusualVolumeToday: false,
      unusualVolume5d: false,
      relativeStrength, 
      rsData,
      pattern: 'None',
      patternConfidence: 0,
      ma10Slope14d: null,
      pctFromHigh: null,
      breakoutVolumeRatio: null,
      turtleBreakout20: false,
      turtleBreakout55: false,
      priceAboveAllMAs: false,
      ma200Rising: false
    };
    const { score, recommendation, scoreBreakdown } = computeBuyScore(raw);
    return { ...raw, score, recommendation, scoreBreakdown };
  }

  const pullbacks = findPullbacks(bars, 80);
  // Need at least 2 contractions (each pullback smaller than previous)
  let contractions = 0;
  for (let i = 1; i < pullbacks.length; i++) {
    if (pullbacks[i].pct < pullbacks[i - 1].pct) contractions++;
  }

  const atMa10 = last10 != null && nearMA(lastClose, last10);
  const atMa20 = last20 != null && nearMA(lastClose, last20);
  const atMa50 = last50 != null && nearMA(lastClose, last50);
  const atAnyMA = atMa10 || atMa20 || atMa50;

  // Volume analysis: 20-day avg, drying up on pullbacks (bullish)
  const volumes = bars.map((b) => b.v ?? b.volume ?? 0);
  const volSma20 = volumeSma(volumes, 20);
  const avgVol20 = volSma20[lastIdx];
  const lastPullback = pullbacks[pullbacks.length - 1];
  const volumeDryUp =
    avgVol20 != null &&
    avgVol20 > 0 &&
    lastPullback?.avgVolume != null &&
    lastPullback.avgVolume < avgVol20 * 0.85;
  const recentVol = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const volumeRatio = avgVol20 > 0 ? recentVol / avgVol20 : null;
  const lastVol = volumes[lastIdx] ?? null;
  const breakoutVolumeRatio = avgVol20 && avgVol20 > 0 && lastVol != null
    ? Math.round((lastVol / avgVol20) * 100) / 100
    : null;

  // Unusual volume signal: 1.5x 20d avg + close > prior day high (any of last 5 days)
  const { unusualVolumeToday, unusualVolume5d } = computeUnusualVolume(bars, volSma20, {
    thresholdRatio: 1.5,
    lookbackDays: 5,
  });

  // Ideal setup: 5-10 day pullback, volume high above 20 MA at last high, increased volume on push from higher low to higher high
  const lookback = 80;
  const recent = bars.slice(-lookback);
  const recentStartIdx = bars.length - recent.length;
  let idealPullbackSetup = false;
  const idealPullbackBarTimes = [];
  if (lastPullback && recent.length > 0) {
    const { highIdx, lowIdx, highPrice, lowPrice } = lastPullback;
    const pullbackDays = lowIdx - highIdx + 1;
    const is5to10Days = pullbackDays >= 4 && pullbackDays <= 12;
    const highBarIdx = recentStartIdx + highIdx;
    const volAtHigh = volumes[highBarIdx] ?? 0;
    const volSmaAtHigh = volSma20[highBarIdx];
    const volHighAtLastHigh = volSmaAtHigh != null && volSmaAtHigh > 0 && volAtHigh > volSmaAtHigh;
    const prevPullback = pullbacks.length >= 2 ? pullbacks[pullbacks.length - 2] : null;
    const isHigherLow = !prevPullback || lowPrice > prevPullback.lowPrice;
    let hasVolumePush = false;
    for (let k = lowIdx + 1; k < Math.min(lowIdx + 11, recent.length) && idealPullbackBarTimes.length < 3; k++) {
      const barIdx = recentStartIdx + k;
      const v = volumes[barIdx] ?? 0;
      const vSma = volSma20[barIdx];
      const bar = recent[k];
      const close = bar?.c ?? 0;
      if (vSma != null && vSma > 0 && v > vSma && close > lowPrice) {
        hasVolumePush = true;
        idealPullbackBarTimes.push(bars[barIdx]?.t ?? 0);
      }
    }
    idealPullbackSetup = is5to10Days && volHighAtLastHigh && isHigherLow && hasVolumePush;
  }

  const vcpBullish = contractions >= 1 && atAnyMA && lastClose >= (last50 ?? 0);

  // Agent-specific context fields (for Signal Agent filtering)
  const ma10Slope14d = (() => {
    const prevIdx = lastIdx - 14;
    const prev10 = prevIdx >= 0 ? sma10[prevIdx] : null;
    if (last10 == null || prev10 == null || prev10 === 0) return null;
    return Math.round(((last10 - prev10) / prev10) * 1000) / 10;
  })();

  const pctFromHigh = (() => {
    const lookback = Math.min(252, bars.length);
    let maxHigh = 0;
    for (let i = bars.length - lookback; i < bars.length; i++) {
      const h = bars[i]?.h ?? bars[i]?.c ?? 0;
      if (h > maxHigh) maxHigh = h;
    }
    if (maxHigh <= 0) return null;
    return Math.round(((maxHigh - lastClose) / maxHigh) * 1000) / 10;
  })();

  const turtleBreakout = (days) => {
    if (bars.length <= days + 1) return false;
    let priorHigh = 0;
    for (let i = bars.length - days - 1; i < bars.length - 1; i++) {
      const h = bars[i]?.h ?? bars[i]?.c ?? 0;
      if (h > priorHigh) priorHigh = h;
    }
    return priorHigh > 0 && lastClose > priorHigh;
  };

  const turtleBreakout20 = turtleBreakout(20);
  const turtleBreakout55 = turtleBreakout(55);
  const priceAboveAllMAs =
    last10 != null &&
    last20 != null &&
    last50 != null &&
    last200 != null &&
    lastClose > last10 &&
    lastClose > last20 &&
    lastClose > last50 &&
    lastClose > last200;
  const ma200Rising = (() => {
    const prevIdx = lastIdx - 20;
    const prev200 = prevIdx >= 0 ? sma200[prevIdx] : null;
    if (last200 == null || prev200 == null) return false;
    return last200 > prev200;
  })();

  // NEW: Identify which Minervini pattern has formed
  const patternResult = identifyPattern(bars, contractions, volumeDryUp);

  const raw = {
    vcpBullish,
    contractions,
    atMa10,
    atMa20,
    atMa50,
    lastClose,
    sma10: last10,
    sma20: last20,
    sma50: last50,
    pullbackPcts: pullbacks.slice(-5).map((p) => p.pct.toFixed(2)),
    volumeDryUp,
    volumeRatio: volumeRatio != null ? Math.round(volumeRatio * 100) / 100 : null,
    avgVol20: avgVol20 != null ? Math.round(avgVol20) : null,
    idealPullbackSetup,
    idealPullbackBarTimes,
    unusualVolumeToday,
    unusualVolume5d,
    relativeStrength, // NEW: RS value (or null)
    rsData, // NEW: Full RS details
    pattern: patternResult.pattern, // NEW: Pattern name
    patternConfidence: patternResult.confidence, // NEW: Pattern confidence (0-100)
    patternDetails: patternResult.details, // NEW: Pattern analysis details
    ma10Slope14d,
    pctFromHigh,
    breakoutVolumeRatio,
    turtleBreakout20,
    turtleBreakout55,
    priceAboveAllMAs,
    ma200Rising,
  };
  const { score, recommendation, scoreBreakdown } = computeBuyScore(raw);
  return { ...raw, score, recommendation, scoreBreakdown };
}

/**
 * Build recent signal snapshots for last N bars.
 * Uses checkVCP on slices so agent criteria reflect each bar's context.
 */
function buildSignalSnapshots(bars, spyBars = null, lookbackBars = 3) {
  if (!Array.isArray(bars) || bars.length === 0) return [];
  const startIdx = Math.max(0, bars.length - lookbackBars);
  const snapshots = [];
  for (let i = startIdx; i < bars.length; i++) {
    const slice = bars.slice(0, i + 1);
    const spySlice = Array.isArray(spyBars) ? spyBars.slice(0, i + 1) : null;
    snapshots.push(checkVCP(slice, spySlice));
  }
  return snapshots;
}

export { sma, volumeSma, findPullbacks, checkVCP, buildSignalSnapshots, nearMA, computeBuyScore, calculateRelativeStrength };

/**
 * Compute a 0–100 buy score and recommendation from VCP result.
 * Returns { score, recommendation, scoreBreakdown }.
 */
function computeBuyScore(vcp) {
  const breakdown = [];
  let score = 0;

  if (vcp.reason === 'not_enough_bars') {
    breakdown.push({ criterion: 'Not enough bars (need 60+)', matched: false, points: 0 });
  } else if (vcp.reason === 'below_50_ma') {
    breakdown.push({ criterion: 'Price above 50 SMA (Stage 2)', matched: false, points: 0 });
  } else {
    if (vcp.vcpBullish) {
      breakdown.push({ criterion: 'VCP Bullish (contractions + at MA)', matched: true, points: 50 });
      score += 50;
    } else {
      breakdown.push({ criterion: 'VCP Bullish (contractions + at MA)', matched: false, points: 0 });
      breakdown.push({ criterion: 'Partial setup (above 50 MA, no full VCP)', matched: true, points: 20 });
      score += 20;
    }

    const contractionPts = Math.min((vcp.contractions || 0) * 8, 25);
    breakdown.push({ criterion: 'Contractions (each pullback smaller than previous)', matched: (vcp.contractions || 0) > 0, points: contractionPts, detail: `${vcp.contractions || 0} contractions` });
    score += contractionPts;

    if (vcp.atMa10) {
      breakdown.push({ criterion: 'Price at 10 MA (within 2%)', matched: true, points: 5 });
      score += 5;
    } else {
      breakdown.push({ criterion: 'Price at 10 MA (within 2%)', matched: false, points: 0 });
    }
    if (vcp.atMa20) {
      breakdown.push({ criterion: 'Price at 20 MA (within 2%)', matched: true, points: 5 });
      score += 5;
    } else {
      breakdown.push({ criterion: 'Price at 20 MA (within 2%)', matched: false, points: 0 });
    }
    if (vcp.atMa50) {
      breakdown.push({ criterion: 'Price at 50 MA (within 2%)', matched: true, points: 5 });
      score += 5;
    } else {
      breakdown.push({ criterion: 'Price at 50 MA (within 2%)', matched: false, points: 0 });
    }

    const above50 = vcp.lastClose != null && vcp.sma50 != null && vcp.lastClose >= vcp.sma50;
    breakdown.push({ criterion: 'Price above 50 SMA', matched: above50, points: above50 ? 10 : 0 });
    if (above50) score += 10;

    if (vcp.volumeDryUp) {
      breakdown.push({ criterion: 'Volume drying up on pullbacks (<85% of 20d avg)', matched: true, points: 10 });
      score += 10;
    } else {
      breakdown.push({ criterion: 'Volume drying up on pullbacks (<85% of 20d avg)', matched: false, points: 0 });
    }

    if (vcp.idealPullbackSetup) {
      breakdown.push({ criterion: 'Ideal setup: 5-10d pullback, vol high at last high, vol push from higher low', matched: true, points: 15 });
      score += 15;
    } else {
      breakdown.push({ criterion: 'Ideal setup: 5-10d pullback, vol high at last high, vol push from higher low', matched: false, points: 0 });
    }
  }

  score = Math.min(100, Math.max(0, score));

  let recommendation = 'avoid';
  if (score >= 60) recommendation = 'buy';
  else if (score >= 30) recommendation = 'hold';

  return { score, recommendation, scoreBreakdown: breakdown };
}
