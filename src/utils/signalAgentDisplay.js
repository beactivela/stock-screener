const AGENT_LABELS = {
  momentum_scout: 'Momentum',
  base_hunter: 'Base',
  breakout_tracker: 'Breakout',
  turtle_trader: 'Turtle',
  ma_crossover_10_20: '10-20 Cross Over',
  unusual_vol: 'Unusual Vol.',
};

const AGENT_PRIORITY = [
  'ma_crossover_10_20',
  'unusual_vol',
  'momentum_scout',
  'base_hunter',
  'breakout_tracker',
  'turtle_trader',
];

export function resolveSignalAgentLabel(signalSetups = []) {
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
