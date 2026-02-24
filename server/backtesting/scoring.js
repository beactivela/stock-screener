/**
 * Shared scoring + aggregation helpers for WFO selection.
 */

function round2(value) {
  return Math.round(value * 100) / 100;
}

export function scoreSummary(summary, metric = 'expectancy') {
  if (!summary || typeof summary !== 'object') return Number.NEGATIVE_INFINITY;
  const value = summary[metric];
  if (typeof value !== 'number' || Number.isNaN(value)) return Number.NEGATIVE_INFINITY;
  return value;
}

export function combineSummaries(summaries = []) {
  const totalSignals = summaries.reduce((sum, s) => sum + (s.totalSignals || 0), 0);
  if (totalSignals === 0) {
    return { totalSignals: 0 };
  }

  const weightedKeys = [
    'expectancy',
    'avgReturn',
    'winRate',
    'avgWin',
    'avgLoss',
    'profitFactor',
    'avgHoldTime',
    'avgMFE',
    'avgMAE',
    'rrRatio',
  ];

  const combined = { totalSignals };
  for (const key of weightedKeys) {
    let acc = 0;
    for (const s of summaries) {
      const value = typeof s[key] === 'number' ? s[key] : null;
      const weight = s.totalSignals || 0;
      if (value != null && weight > 0) {
        acc += value * weight;
      }
    }
    combined[key] = round2(acc / totalSignals);
  }

  return combined;
}
