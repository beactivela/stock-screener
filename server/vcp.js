/**
 * VCP (Volatility Contraction Pattern) detection – Minervini-style.
 * Uses daily bars; we compute 10/20/50 SMA from closes, volume analysis from v.
 */

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
 * Run VCP check on one ticker's bar series.
 * bars: array of { o, h, l, c, v, t } (ascending by t).
 * Returns { vcpBullish, contractions, atMa10, atMa20, atMa50, lastClose, sma10, sma20, sma50 }.
 */
function checkVCP(bars) {
  if (!bars || bars.length < 60) {
    const { scoreBreakdown } = computeBuyScore({ reason: 'not_enough_bars' });
    return { vcpBullish: false, reason: 'not_enough_bars', score: 0, recommendation: 'avoid', volumeDryUp: false, volumeRatio: null, scoreBreakdown };
  }

  const closes = bars.map((b) => b.c);
  const sma10 = sma(closes, 10);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);

  const lastIdx = bars.length - 1;
  const lastClose = closes[lastIdx];
  const last10 = sma10[lastIdx];
  const last20 = sma20[lastIdx];
  const last50 = sma50[lastIdx];

  // Stage 2: price above 50 SMA
  if (last50 != null && lastClose < last50) {
    const raw = { vcpBullish: false, reason: 'below_50_ma', lastClose, sma10: last10, sma20: last20, sma50: last50, contractions: 0, atMa10: false, atMa20: false, atMa50: false, volumeDryUp: false, volumeRatio: null };
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

  const vcpBullish = contractions >= 1 && atAnyMA && lastClose >= (last50 ?? 0);

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
  };
  const { score, recommendation, scoreBreakdown } = computeBuyScore(raw);
  return { ...raw, score, recommendation, scoreBreakdown };
}

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
  }

  score = Math.min(100, Math.max(0, score));

  let recommendation = 'avoid';
  if (score >= 60) recommendation = 'buy';
  else if (score >= 30) recommendation = 'hold';

  return { score, recommendation, scoreBreakdown: breakdown };
}

export { sma, volumeSma, findPullbacks, checkVCP, nearMA, computeBuyScore };
