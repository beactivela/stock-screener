/**
 * Normalize engine outputs to a common shape for UI + learning.
 */

function requireNumber(value, name) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`Missing or invalid metric: ${name}`);
  }
  return value;
}

function normalizeVectorbt(raw) {
  const metrics = raw?.metrics;
  if (!metrics) throw new Error('vectorbt metrics are required');

  return {
    totalReturnPct: requireNumber(metrics.total_return_pct, 'total_return_pct'),
    cagrPct: requireNumber(metrics.cagr_pct, 'cagr_pct'),
    sharpe: requireNumber(metrics.sharpe, 'sharpe'),
    maxDrawdownPct: requireNumber(metrics.max_drawdown_pct, 'max_drawdown_pct'),
    winRatePct: requireNumber(metrics.win_rate_pct, 'win_rate_pct'),
  };
}

export function normalizeEngineResult({ engine, raw, meta = {} }) {
  if (!engine) throw new Error('engine is required');

  if (engine === 'vectorbt') {
    return {
      engine,
      summary: normalizeVectorbt(raw),
      meta,
    };
  }

  throw new Error(`Unsupported engine: ${engine}`);
}
