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
  const out = new Array(closes.length).fill(null);
  if (!Array.isArray(closes) || closes.length === 0 || period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    const v = closes[i];
    sum += Number.isFinite(v) ? v : 0;
    if (i >= period) {
      const prev = closes[i - period];
      sum -= Number.isFinite(prev) ? prev : 0;
    }
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/**
 * Volume SMA for comparison (e.g. 20-day avg volume).
 */
function volumeSma(volumes, period) {
  const out = new Array(volumes.length).fill(null);
  if (!Array.isArray(volumes) || volumes.length === 0 || period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < volumes.length; i++) {
    const v = volumes[i] ?? 0;
    sum += v;
    if (i >= period) sum -= (volumes[i - period] ?? 0);
    if (i >= period - 1) out[i] = sum / period;
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
 * Calculate IBD RS raw performance (pre-percentile).
 *
 * IBD RS Rating is based on 12-month performance with heavier weighting
 * on the most recent 3 months. We compute the weighted average of the
 * 3/6/9/12-month percent changes (3m double weight).
 *
 * This returns a raw weighted % change which will later be converted
 * into a 1–99 percentile rating across the scan universe.
 *
 * @param {Array} stockBars - Stock OHLC bars
 * @returns {Object|null} { rsRaw, change3m, change6m, change9m, change12m } or null
 */
function calculateRelativeStrength(stockBars) {
  if (!stockBars || stockBars.length <= 252) {
    return null;
  }

  try {
    const stockNow = stockBars[stockBars.length - 1]?.c;
    if (!Number.isFinite(stockNow) || stockNow <= 0) return null;

    const lookbacks = [
      { days: 63, weight: 2 },  // ~3m (double weight)
      { days: 126, weight: 1 }, // ~6m
      { days: 189, weight: 1 }, // ~9m
      { days: 252, weight: 1 }, // ~12m
    ];

    const changes = {};
    let weightedSum = 0;
    let weightSum = 0;

    for (const { days, weight } of lookbacks) {
      const past = stockBars[stockBars.length - 1 - days]?.c;
      if (!Number.isFinite(past) || past <= 0) return null;
      const change = ((stockNow - past) / past) * 100;
      if (!Number.isFinite(change)) return null;
      changes[days] = change;
      weightedSum += change * weight;
      weightSum += weight;
    }

    if (weightSum <= 0) return null;

    const rsRaw = weightedSum / weightSum;
    const round2 = (value) => Math.round(value * 100) / 100;

    return {
      rsRaw: round2(rsRaw),
      change3m: round2(changes[63]),
      change6m: round2(changes[126]),
      change9m: round2(changes[189]),
      change12m: round2(changes[252]),
    };
  } catch (e) {
    return null;
  }
}

/**
 * Convert raw RS index values to IBD-style 1-99 ratings across a universe.
 *
 * Input rows can carry raw RS in either:
 * - row.rsData.rsRaw
 * - row.relativeStrength
 *
 * Output keeps all existing fields, but overwrites row.relativeStrength
 * with an integer 1-99 rating (99 = strongest in the set).
 *
 * @param {Array<Object>} rows
 * @returns {Array<Object>}
 */
function assignIBDRelativeStrengthRatings(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return Array.isArray(rows) ? rows : [];

  const entries = rows.map((row, idx) => {
    const raw =
      row?.rsData?.rsRaw ??
      row?.relativeStrengthRaw ??
      row?.relativeStrength;
    const rawNum = Number.isFinite(raw) ? raw : null;
    return { idx, row, raw: rawNum };
  });

  const valid = entries.filter((e) => e.raw != null);
  if (valid.length === 0) {
    return rows.map((row) => ({ ...row, relativeStrength: null }));
  }

  valid.sort((a, b) => b.raw - a.raw);
  const n = valid.length;
  const ratingByIdx = new Map();
  let i = 0;
  while (i < n) {
    let j = i + 1;
    while (j < n && valid[j].raw === valid[i].raw) j++;
    const rank = i + 1; // 1-based (best = 1)
    const rating = n === 1
      ? 99
      : 1 + Math.round(((n - rank) / (n - 1)) * 98);
    for (let k = i; k < j; k++) ratingByIdx.set(valid[k].idx, rating);
    i = j;
  }

  return entries.map(({ idx, row, raw }) => {
    if (raw == null) return { ...row, relativeStrength: null };
    const rating = ratingByIdx.get(idx) ?? null;
    return {
      ...row,
      relativeStrength: rating,
      rsData: row?.rsData
        ? {
            ...row.rsData,
            rsRaw: Number.isFinite(row.rsData.rsRaw) ? row.rsData.rsRaw : raw,
            rsRating: rating,
          }
        : { rsRaw: raw, rsRating: rating },
    };
  });
}

/**
 * Run VCP check on one ticker's bar series.
 * bars: array of { o, h, l, c, v, t } (ascending by t).
 * Returns { vcpBullish, contractions, atMa10, atMa20, atMa50, lastClose, sma10, sma20, sma50, relativeStrength, pattern, patternConfidence }.
 */
function checkVCP(bars, options = {}) {
  const { lite = false } = options || {};
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
      unusualVolume3d: false,
      unusualVolume5d: false,
      priceHigherThan3dAgo: false,
      scoreBreakdown, 
      relativeStrength: null, 
      rsData: null,
      pattern: 'None',
      patternConfidence: 0,
      patternDetails: lite ? 'lite_mode' : 'Insufficient data',
      ma10Slope14d: null,
      ma10Above20: false,
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
  
  // Calculate IBD RS raw (pre-percentile)
  const rsData = calculateRelativeStrength(bars);
  const relativeStrength = null;

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
      unusualVolume3d: false,
      unusualVolume5d: false,
      priceHigherThan3dAgo: false,
      relativeStrength, 
      rsData,
      pattern: 'None',
      patternConfidence: 0,
      patternDetails: lite ? 'lite_mode' : 'Below 50 MA',
      ma10Slope14d: null,
      ma10Above20: last10 != null && last20 != null ? last10 > last20 : false,
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

  // Unusual volume signal: volume spike in last 3 days + latest close > close 3 days ago
  const { unusualVolumeToday, unusualVolume3d, unusualVolume5d, priceHigherThan3dAgo } = computeUnusualVolume(bars, volSma20, {
    thresholdRatio: 1.5,
    lookbackDays: 3,
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
  const ma10Above20 = last10 != null && last20 != null ? last10 > last20 : false;

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

  // NEW: Identify which Minervini pattern has formed (skip in lite mode)
  const patternResult = lite
    ? { pattern: 'None', confidence: 0, details: 'lite_mode', detected: false, allPatterns: {} }
    : identifyPattern(bars, contractions, volumeDryUp);

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
    unusualVolume3d,
    unusualVolume5d,
    priceHigherThan3dAgo,
    relativeStrength, // NEW: RS value (or null)
    rsData, // NEW: Full RS details
    pattern: patternResult.pattern, // NEW: Pattern name
    patternConfidence: patternResult.confidence, // NEW: Pattern confidence (0-100)
    patternDetails: patternResult.details, // NEW: Pattern analysis details
    ma10Slope14d,
    ma10Above20,
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
function buildSignalSnapshots(bars, lookbackBars = 3) {
  if (!Array.isArray(bars) || bars.length === 0) return [];
  const startIdx = Math.max(0, bars.length - lookbackBars);
  const snapshots = [];
  for (let i = startIdx; i < bars.length; i++) {
    const slice = bars.slice(0, i + 1);
    snapshots.push(checkVCP(slice, { lite: true }));
  }
  return snapshots;
}

export { sma, volumeSma, findPullbacks, checkVCP, buildSignalSnapshots, nearMA, computeBuyScore, calculateRelativeStrength, assignIBDRelativeStrengthRatings };

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
