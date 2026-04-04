/**
 * Normalize StockCircle display strings (e.g. "2.51M", "$522M") to numbers.
 */

const MULT = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

/**
 * @param {string | undefined | null} raw
 * @returns {number | null}
 */
export function parseShareCountAbbrev(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/,/g, '');
  if (!s) return null;
  const m = s.match(/^([\d.]+)\s*([kmbt])?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (Number.isNaN(n)) return null;
  const suf = (m[2] || '').toUpperCase();
  const mult = suf ? MULT[suf] ?? null : 1;
  if (mult == null) return null;
  return n * mult;
}

/**
 * @param {string | undefined | null} raw e.g. "$522M", "$98.4M", "$1.2B"
 * @returns {number | null} USD (not cents)
 */
export function parseUsdAbbrev(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/,/g, '');
  if (!s) return null;
  const m = s.match(/^\$\s*([\d.]+)\s*([kmbt])?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (Number.isNaN(n)) return null;
  const suf = (m[2] || '').toUpperCase();
  const mult = suf ? MULT[suf] ?? 1 : 1;
  return n * mult;
}
