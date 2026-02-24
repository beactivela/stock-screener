/**
 * Helper: choose a signal from cached Opus45 signals.
 * Pure function for unit testing.
 */

export function resolveSignalFromCache({ ticker, cachedSignals = [] }) {
  if (!Array.isArray(cachedSignals) || cachedSignals.length === 0) return null;
  if (ticker) {
    const t = String(ticker).toUpperCase();
    return cachedSignals.find((s) => String(s.ticker || '').toUpperCase() === t) || null;
  }
  return cachedSignals[0] || null;
}
