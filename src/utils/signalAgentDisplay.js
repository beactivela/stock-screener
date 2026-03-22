const AGENT_LABELS = {
  momentum_scout: 'Momentum',
  base_hunter: 'Base',
  breakout_tracker: 'Breakout',
  turtle_trader: 'Turtle',
  unusual_vol: 'Unusual Vol.',
  lance: 'Lance',
};

const AGENT_PRIORITY = [
  'unusual_vol',
  'momentum_scout',
  'base_hunter',
  'breakout_tracker',
  'turtle_trader',
  'lance',
];

/**
 * Prefer recent setups when present, but gracefully fall back to full setups.
 * This avoids empty filters when recent classification is unavailable.
 */
export function getEffectiveSignalSetups(signalSetupsRecent = null, signalSetups = null) {
  const recent = Array.isArray(signalSetupsRecent) ? signalSetupsRecent : [];
  const full = Array.isArray(signalSetups) ? signalSetups : [];
  if (recent.length === 0) return full;
  if (full.length === 0) return recent;

  // Preserve recent-first ordering while keeping same-day full-row tags (e.g. turtle).
  const merged = [...recent];
  const seen = new Set(merged);
  for (const setup of full) {
    if (seen.has(setup)) continue;
    seen.add(setup);
    merged.push(setup);
  }
  return merged;
}

export function resolveSignalAgentLabel(signalSetups = [], preferredAgentId = null) {
  if (preferredAgentId && signalSetups.includes(preferredAgentId)) {
    return AGENT_LABELS[preferredAgentId] ?? '—';
  }
  for (const id of AGENT_PRIORITY) {
    if (signalSetups.includes(id)) return AGENT_LABELS[id];
  }
  return '—';
}

export function formatSignalDate(entryDate) {
  if (entryDate == null || entryDate === '') return '—';
  if (typeof entryDate === 'number') {
    const ms = entryDate < 1e12 ? entryDate * 1000 : entryDate;
    return new Date(ms).toISOString().slice(0, 10);
  }
  return String(entryDate);
}

export function formatSignalPL(pctChange) {
  if (pctChange == null || Number.isNaN(pctChange)) return { text: '—', tone: 'muted' };
  const sign = pctChange > 0 ? '+' : pctChange < 0 ? '-' : '';
  return {
    text: `${sign}${Math.abs(pctChange)}%`,
    tone: pctChange > 0 ? 'positive' : pctChange < 0 ? 'negative' : 'muted',
  };
}

/**
 * Human-readable signal criteria for each agent (used by Edit modal on Dashboard).
 * Derived from server/learning/signalSetupClassifier.js and docs/SIGNAL_AGENT_*.md
 */
export const SIGNAL_AGENT_CRITERIA = {
  unusual_vol: {
    label: 'Unusual Vol.',
    criteria: [
      'Unusual volume in last 3 days (volume vs 20-day average)',
      'Latest price higher than price 3 days ago',
    ],
  },
  momentum_scout: {
    label: 'Momentum Scout',
    criteria: [
      'Relative Strength ≥ 85',
      '10 MA slope (14d) ≥ 5',
      'Within 15% of 52-week high',
      'Signal family: opus45',
    ],
  },
  base_hunter: {
    label: 'Base Hunter',
    criteria: [
      'VCP contractions ≥ 3',
      'Pattern confidence ≥ 65%',
      'Volume dry-up present',
      'Signal family: opus45',
    ],
  },
  breakout_tracker: {
    label: 'Breakout Tracker',
    criteria: [
      'Relative Strength ≥ 80',
      'Within 8% of 52-week high',
      'Breakout volume ratio ≥ 1.2×',
      'Signal family: opus45',
    ],
  },
  turtle_trader: {
    label: 'Turtle Trader',
    criteria: [
      'Donchian 20d or 55d breakout',
      'Price above all MAs',
      '200 MA rising',
      'Relative Strength ≥ 80',
      'Signal family: turtle',
    ],
  },
  lance: {
    label: 'Lance (pre-trade quality)',
    criteria: [
      'Pre-trade A–D score from daily-bar proxies (time behavior, ROC, RS vs market, location vs MAs / highs)',
      'Tagged when score is A+ through C (D = no tag)',
      'Confirm on intraday tape (VWAP, vs SPY, 5–30m follow-through)',
    ],
  },
};
