/**
 * Scan rows use uppercase tickers; `tickers` table may store mixed case.
 * Without normalizing the universe set, /api/scan-results can return 0 rows
 * while Supabase progress still counts inserts (looks "stuck" / empty dashboard).
 */

/** @param {string[]|null|undefined} tickers */
export function buildUppercaseTickerUniverseSet(tickers) {
  return new Set(
    (tickers || []).map((t) => String(t || '').trim().toUpperCase()).filter(Boolean),
  );
}

/**
 * @param {Array<{ ticker?: string }>} results
 * @param {Set<string>} universeUpper
 */
export function filterScanResultsToTickerUniverse(results, universeUpper) {
  if (!universeUpper || universeUpper.size === 0) return results;
  return results.filter((r) => universeUpper.has(String(r.ticker || '').toUpperCase()));
}
