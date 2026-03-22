/**
 * Lance — pre-trade stock quality (Lance Breitstein–style framework).
 *
 * The live playbook uses intraday tape (5m/15m, VWAP, vs SPY). This scanner only
 * has daily OHLC, so we proxy urgency, ROC, RS, and “location” from the last
 * sessions plus existing scan fields (MA tags, % from 52w high, volume vs 20d).
 */

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function closeSeries(bars) {
  if (!Array.isArray(bars)) return [];
  return bars.map((b) => b?.c ?? b?.close ?? null).filter(isNumber);
}

function pctChange(a, b) {
  if (!isNumber(a) || !isNumber(b) || b === 0) return null;
  return ((a - b) / b) * 100;
}

/** @param {'FAST'|'MODERATE'|'SLOW'} t */
function timeRank(t) {
  if (t === 'FAST') return 3;
  if (t === 'MODERATE') return 2;
  return 1;
}

/** @param {'HIGH'|'MEDIUM'|'LOW'} r */
function rocRank(r) {
  if (r === 'HIGH') return 3;
  if (r === 'MEDIUM') return 2;
  return 1;
}

/** @param {'STRONG'|'NEUTRAL'|'WEAK'} rs */
function rsRank(rs) {
  if (rs === 'STRONG') return 3;
  if (rs === 'NEUTRAL') return 2;
  return 1;
}

/** @param {'A'|'B'|'C'} loc */
function locRank(loc) {
  if (loc === 'A') return 3;
  if (loc === 'B') return 2;
  return 1;
}

function classifyTimeBehavior(ret1d, ret3d) {
  const a1 = isNumber(ret1d) ? Math.abs(ret1d) : 0;
  const a3 = isNumber(ret3d) ? Math.abs(ret3d) : 0;
  const aligned =
    isNumber(ret1d) &&
    isNumber(ret3d) &&
    ret1d !== 0 &&
    ret3d !== 0 &&
    Math.sign(ret1d) === Math.sign(ret3d);

  if (a1 >= 1.8 || (aligned && a3 >= 2.8)) return 'FAST';
  if (a1 < 0.45 && a3 < 1.2) return 'SLOW';
  return 'MODERATE';
}

function classifyRoc(ma10Slope14d, breakoutVolumeRatio, ret5d) {
  const slope = isNumber(ma10Slope14d) ? ma10Slope14d : 0;
  const brk = isNumber(breakoutVolumeRatio) ? breakoutVolumeRatio : 0;
  const r5 = ret5d;

  if (slope >= 5 || (isNumber(r5) && r5 >= 3 && (brk >= 1.15 || slope >= 3))) {
    return 'HIGH';
  }
  if (slope < 2 && (!isNumber(r5) || Math.abs(r5) < 1.8) && brk < 1.08) {
    return 'LOW';
  }
  return 'MEDIUM';
}

function classifyRelativeStrengthBand(rs) {
  if (!isNumber(rs)) return 'NEUTRAL';
  if (rs >= 80) return 'STRONG';
  if (rs < 50) return 'WEAK';
  return 'NEUTRAL';
}

function classifyLocation(row, ret5d) {
  const pctFromHigh = isNumber(row.pctFromHigh) ? row.pctFromHigh : null;
  const atMa = !!(row.atMa10 || row.atMa20 || row.atMa50);
  const brk = isNumber(row.breakoutVolumeRatio) ? row.breakoutVolumeRatio : 0;
  const last = row.lastClose;
  const s10 = row.sma10;
  const ext10 =
    isNumber(last) && isNumber(s10) && s10 !== 0 ? ((last - s10) / s10) * 100 : null;

  // Extended / chasing (daily proxy): glued to highs + vertical short-term run, or very stretched vs 10 MA.
  if (
    isNumber(pctFromHigh) &&
    pctFromHigh <= 4 &&
    isNumber(ret5d) &&
    ret5d > 12
  ) {
    return 'C';
  }
  if (isNumber(pctFromHigh) && pctFromHigh <= 6 && isNumber(ext10) && ext10 > 7.5) {
    return 'C';
  }

  if (
    atMa ||
    row.idealPullbackSetup ||
    (isNumber(pctFromHigh) && pctFromHigh <= 12 && brk >= 1.05)
  ) {
    return 'A';
  }

  return 'B';
}

function combineScore(timeBehavior, rateOfChange, rsBand, location) {
  const raw =
    timeRank(timeBehavior) +
    rocRank(rateOfChange) +
    rsRank(rsBand) +
    locRank(location);

  // Hard risk overrides (no edge / wrong side of tape vs leaders).
  if (rsBand === 'WEAK' && (rateOfChange === 'LOW' || timeBehavior === 'SLOW')) {
    return 'D';
  }
  if (location === 'C' && rsBand === 'WEAK') {
    return 'D';
  }
  if (raw <= 5) {
    return 'D';
  }

  if (raw === 12) return 'A+';
  if (raw === 11) return 'A';
  if (raw >= 9) return 'B';
  if (raw >= 7) return 'C';
  return 'D';
}

function buildWatchStrings({
  timeBehavior,
  rateOfChange,
  relativeStrength,
  location,
  score,
}) {
  const confirm = [];
  if (timeBehavior !== 'FAST') confirm.push('Pickup in real-time urgency (follow-through 5–30m)');
  if (rateOfChange !== 'HIGH') confirm.push('Expansion in ROC (directional candles, volume)');
  if (relativeStrength !== 'STRONG') confirm.push('Outperformance vs SPY / market proxy');
  if (location !== 'A') confirm.push('Pullback to key level or clean base breakout (not chasing)');
  if (confirm.length === 0) {
    confirm.push('Continuation: hold RS vs market, stay above entry / pivot');
  }

  const invalidate = [];
  if (score === 'A+' || score === 'A') {
    invalidate.push('Lose day’s constructive structure (close weak vs VWAP proxy / support)');
    invalidate.push('RS vs market rolls over while indices hold');
  } else {
    invalidate.push('Break last swing low / failed breakout reclaim');
    invalidate.push('Volume dry-up on rallies + RS divergence');
  }

  return {
    watchConfirm: confirm.join(' · '),
    watchInvalidate: invalidate.join(' · '),
  };
}

/**
 * @param {object} row — scan / VCP row (already RS-rated in pipeline)
 * @param {object[]} bars — OHLC bars oldest → newest
 * @returns {object}
 */
export function computeLancePreTrade(row = {}, bars = []) {
  const closes = closeSeries(bars);
  const n = closes.length;
  const ticker = row.ticker ?? '—';

  if (n < 5) {
    return {
      framework: 'Lance Breitstein pre-trade quality (daily proxies)',
      ticker,
      score: null,
      insufficientData: true,
      timeBehavior: 'SLOW',
      rateOfChange: 'LOW',
      relativeStrength: 'NEUTRAL',
      location: 'B',
      actionable: false,
      sizeHint: 'avoid',
      watchConfirm: 'Need more history (5+ daily closes) to score.',
      watchInvalidate: '—',
      summaryLine: 'Insufficient data for Lance pre-trade score.',
    };
  }

  const c0 = closes[n - 1];
  const c1 = closes[n - 2];
  const c3 = n >= 4 ? closes[n - 4] : null;
  const c6 = n >= 6 ? closes[n - 6] : null;

  const ret1d = pctChange(c0, c1);
  const ret3d = c3 != null ? pctChange(c0, c3) : null;
  const ret5d = c6 != null ? pctChange(c0, c6) : null;

  const timeBehavior = classifyTimeBehavior(ret1d, ret3d);
  const rateOfChange = classifyRoc(row.ma10Slope14d, row.breakoutVolumeRatio, ret5d);
  const relativeStrength = classifyRelativeStrengthBand(row.relativeStrength);
  const location = classifyLocation(row, ret5d);

  let score = combineScore(timeBehavior, rateOfChange, relativeStrength, location);

  // A+ requires “all green” per doctrine (one notch down → still A at worst).
  if (
    score === 'A+' &&
    (timeBehavior !== 'FAST' ||
      rateOfChange !== 'HIGH' ||
      relativeStrength !== 'STRONG' ||
      location !== 'A')
  ) {
    score = 'A';
  }

  const actionable = score === 'A+' || score === 'A' || score === 'B';
  const sizeHint =
    score === 'A+' || score === 'A' ? 'aggressive' : score === 'B' ? 'starter' : 'avoid';

  const { watchConfirm, watchInvalidate } = buildWatchStrings({
    timeBehavior,
    rateOfChange,
    relativeStrength,
    location,
    score,
  });

  const summaryLine = `${ticker}: ${score} — ${timeBehavior} tape, ${rateOfChange} ROC, ${relativeStrength} RS, ${location} location (daily scan proxies; confirm on intraday).`;

  return {
    framework: 'Lance Breitstein pre-trade quality (daily proxies)',
    ticker,
    score,
    insufficientData: false,
    timeBehavior,
    rateOfChange,
    relativeStrength,
    location,
    actionable,
    sizeHint,
    watchConfirm,
    watchInvalidate,
    summaryLine,
  };
}

export function shouldIncludeLanceInSignalSetups(lancePreTrade) {
  return !!(
    lancePreTrade &&
    !lancePreTrade.insufficientData &&
    lancePreTrade.score &&
    lancePreTrade.score !== 'D'
  );
}

/** Descending sort: A+ first */
export function lanceScoreSortRank(score) {
  const order = { 'A+': 6, A: 5, B: 4, C: 3, D: 2 };
  if (score != null && Object.prototype.hasOwnProperty.call(order, score)) {
    return order[score];
  }
  return 0;
}
