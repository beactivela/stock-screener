const DEFAULT_SIGNAL_FAMILY = {
  momentum_scout: 'opus45',
  base_hunter: 'opus45',
  breakout_tracker: 'opus45',
  turtle_trader: 'turtle',
  ma_crossover_10_20: 'ma_crossover',
};

// Lightweight, heuristic classification (AgentQuant removed).
function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function matchesMomentumScout(signal) {
  const signalFamily = signal.signalFamily ?? DEFAULT_SIGNAL_FAMILY.momentum_scout;
  if (signalFamily !== 'opus45') return false;
  const rs = isNumber(signal.relativeStrength) ? signal.relativeStrength : 0;
  const slope = isNumber(signal.ma10Slope14d) ? signal.ma10Slope14d : 0;
  const pctFromHigh = isNumber(signal.pctFromHigh) ? signal.pctFromHigh : 100;
  return rs >= 85 && slope >= 5 && pctFromHigh <= 15;
}

function matchesBaseHunter(signal) {
  const signalFamily = signal.signalFamily ?? DEFAULT_SIGNAL_FAMILY.base_hunter;
  if (signalFamily !== 'opus45') return false;
  const contractions = isNumber(signal.contractions) ? signal.contractions : 0;
  const confidence = isNumber(signal.patternConfidence) ? signal.patternConfidence : 0;
  return contractions >= 3 && confidence >= 65 && !!signal.volumeDryUp;
}

function matchesBreakoutTracker(signal) {
  const signalFamily = signal.signalFamily ?? DEFAULT_SIGNAL_FAMILY.breakout_tracker;
  if (signalFamily !== 'opus45') return false;
  const rs = isNumber(signal.relativeStrength) ? signal.relativeStrength : 0;
  const pctFromHigh = isNumber(signal.pctFromHigh) ? signal.pctFromHigh : 100;
  const volumeRatio = isNumber(signal.breakoutVolumeRatio) ? signal.breakoutVolumeRatio : 0;
  return rs >= 80 && pctFromHigh <= 8 && volumeRatio >= 1.2;
}

function matchesTurtleTrader(signal) {
  const signalFamily = signal.signalFamily ?? DEFAULT_SIGNAL_FAMILY.turtle_trader;
  if (signalFamily !== 'turtle') return false;
  const rs = isNumber(signal.relativeStrength) ? signal.relativeStrength : 0;
  const breakout = !!signal.turtleBreakout20 || !!signal.turtleBreakout55;
  return breakout && !!signal.priceAboveAllMAs && !!signal.ma200Rising && rs >= 80;
}

function matchesMaCrossover(signal) {
  const signalFamily = signal.signalFamily ?? DEFAULT_SIGNAL_FAMILY.ma_crossover_10_20;
  if (signalFamily !== 'ma_crossover') return false;
  return !!signal.ma10Above20;
}

function matchesUnusualVol(signal) {
  return !!signal.unusualVolume5d;
}

/**
 * Classify a scan result into one or more Signal Agent setups.
 * Returns an array of agentType strings.
 */
export function classifySignalSetups(signal = {}) {
  const setups = [];

  if (matchesMomentumScout(signal)) setups.push('momentum_scout');
  if (matchesBaseHunter(signal)) setups.push('base_hunter');
  if (matchesBreakoutTracker(signal)) setups.push('breakout_tracker');
  if (matchesTurtleTrader(signal)) setups.push('turtle_trader');
  if (matchesMaCrossover(signal)) setups.push('ma_crossover_10_20');
  if (matchesUnusualVol(signal)) setups.push('unusual_vol');

  return setups;
}

/**
 * Classify recent signal setups across the last N bar snapshots.
 * Snapshots should be ordered oldest -> newest.
 */
export function classifySignalSetupsRecent(snapshots = [], lookbackBars = 3) {
  const recent = snapshots.slice(-lookbackBars);
  const deduped = new Set();
  const ordered = [];
  for (const snapshot of recent) {
    const setups = classifySignalSetups(snapshot);
    for (const setup of setups) {
      if (!deduped.has(setup)) {
        deduped.add(setup);
        ordered.push(setup);
      }
    }
  }
  return ordered;
}
