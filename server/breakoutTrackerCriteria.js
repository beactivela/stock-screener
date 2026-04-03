/**
 * Breakout Tracker screening aligned with docs/research Top-100 breakout gainers study:
 * - Pre-move: lowest close in prior 20 sessions >= $10
 * - Proximity: within 10% of 52-week high (existing agent)
 * - RS: >= 80 (existing)
 * - Volume: >= 1.5× prior 50-day average volume on the trigger bar (study rule); legacy scans
 *   may only have 20-day ratio — then >= 1.2× is used as fallback
 * - Trend: price above SMA20, SMA50, SMA100 when those fields are present (study: nearly all
 *   winners were above these at the breakout bar)
 */

export const BREAKOUT_TRACKER_STUDY = {
  minRs: 80,
  maxPctFromHigh: 10,
  minMinClose20d: 10,
  minVolumeRatio50: 1.5,
  /** Legacy VCP field: last vol / 20d avg — used when breakoutVolumeRatio50 is absent */
  minVolumeRatio20Fallback: 1.2,
};

/**
 * @param {object} signal - Scan row / VCP result (flat fields)
 * @returns {{ passes: boolean, checks: Record<string, boolean>, reason?: string }}
 */
export function evaluateBreakoutTrackerStudy(signal = {}) {
  const { minRs, maxPctFromHigh, minMinClose20d, minVolumeRatio50, minVolumeRatio20Fallback } =
    BREAKOUT_TRACKER_STUDY;

  const rs = typeof signal.relativeStrength === 'number' && Number.isFinite(signal.relativeStrength)
    ? signal.relativeStrength
    : 0;
  const pctFromHigh =
    typeof signal.pctFromHigh === 'number' && Number.isFinite(signal.pctFromHigh)
      ? signal.pctFromHigh
      : 100;

  const minClose20d =
    typeof signal.minClose20d === 'number' && Number.isFinite(signal.minClose20d)
      ? signal.minClose20d
      : null;
  const minPriceOk =
    minClose20d != null
      ? minClose20d >= minMinClose20d
      : typeof signal.lastClose === 'number' &&
        Number.isFinite(signal.lastClose) &&
        signal.lastClose >= minMinClose20d;

  const vol50 =
    typeof signal.breakoutVolumeRatio50 === 'number' && Number.isFinite(signal.breakoutVolumeRatio50)
      ? signal.breakoutVolumeRatio50
      : null;
  const vol20 =
    typeof signal.breakoutVolumeRatio === 'number' && Number.isFinite(signal.breakoutVolumeRatio)
      ? signal.breakoutVolumeRatio
      : null;
  const volOk =
    vol50 != null ? vol50 >= minVolumeRatio50 : vol20 != null && vol20 >= minVolumeRatio20Fallback;

  const trendFieldOk = (v) => v == null || v === true;
  const trendOk =
    trendFieldOk(signal.aboveSma20) &&
    trendFieldOk(signal.aboveSma50) &&
    trendFieldOk(signal.aboveSma100);

  const rsOk = rs >= minRs;
  const proximityOk = pctFromHigh <= maxPctFromHigh;

  const checks = {
    rsOk,
    proximityOk,
    minPriceOk,
    volOk,
    trendOk,
  };
  const passes = rsOk && proximityOk && minPriceOk && volOk && trendOk;

  let reason;
  if (!passes) {
    const failed = Object.entries(checks)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    reason = failed.length ? `failed: ${failed.join(', ')}` : 'failed';
  }

  return { passes, checks, reason };
}

/**
 * Used by signalSetupClassifier and anywhere else we need a boolean gate.
 * @param {object} signal
 * @returns {boolean}
 */
export function matchesBreakoutTrackerStudy(signal = {}) {
  return evaluateBreakoutTrackerStudy(signal).passes;
}
