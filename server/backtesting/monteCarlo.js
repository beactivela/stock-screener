/**
 * Monte Carlo utilities for trade return randomization.
 */

function mulberry32(seed) {
  let t = seed >>> 0;
  return function rng() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  const weight = idx - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function computeMaxDrawdownPct(equityCurve) {
  let peak = equityCurve[0] ?? 1;
  let maxDd = 0;
  for (const v of equityCurve) {
    if (v > peak) peak = v;
    const dd = (v - peak) / peak;
    if (dd < maxDd) maxDd = dd;
  }
  return Math.round(maxDd * 10000) / 100;
}

/**
 * Randomize trade order to estimate robustness of results.
 */
export function runMonteCarloSimulations({
  returns,
  trials = 1000,
  seed = 42,
  startingEquity = 1,
}) {
  if (!Array.isArray(returns) || returns.length === 0) {
    throw new Error('returns must be a non-empty array');
  }
  if (trials <= 0) throw new Error('trials must be > 0');

  const rng = mulberry32(seed);
  const results = [];

  for (let i = 0; i < trials; i += 1) {
    const order = shuffleInPlace([...returns], rng);
    let equity = startingEquity;
    const curve = [equity];
    for (const r of order) {
      equity *= (1 + r);
      curve.push(equity);
    }
    results.push({
      endingEquity: equity,
      maxDrawdownPct: computeMaxDrawdownPct(curve),
    });
  }

  const endingEquities = results.map((r) => r.endingEquity).sort((a, b) => a - b);
  const maxDrawdowns = results.map((r) => r.maxDrawdownPct);
  const meanEndingEquity = endingEquities.reduce((a, b) => a + b, 0) / endingEquities.length;
  const avgMaxDrawdownPct = maxDrawdowns.reduce((a, b) => a + b, 0) / maxDrawdowns.length;

  return {
    trials,
    results,
    summary: {
      meanEndingEquity,
      medianEndingEquity: percentile(endingEquities, 0.5),
      p5EndingEquity: percentile(endingEquities, 0.05),
      p95EndingEquity: percentile(endingEquities, 0.95),
      worstEndingEquity: endingEquities[0],
      bestEndingEquity: endingEquities[endingEquities.length - 1],
      avgMaxDrawdownPct,
    },
  };
}
