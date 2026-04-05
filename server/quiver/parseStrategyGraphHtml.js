/**
 * Quiver strategy page HTML embeds:
 *   graphDataStrategy = [ { "date":"2014-05-16", "close":100000000.0 }, ... ];
 *   graphDataSPY = [ ... ];
 * Cumulative value uses 100000000 as 100% baseline (see Quiver client bundle).
 */

import { extractJsonArrayAfter } from './extractJsonArray.js'

/**
 * Extract graphDataStrategy array from full strategy page HTML.
 * @param {string} html
 * @returns {{ date: string, close: number }[] | null}
 */
export function parseGraphDataStrategy(html) {
  const arr = extractJsonArrayAfter(html, 'graphDataStrategy = ')
  if (!Array.isArray(arr)) return null
  return arr
    .filter((x) => x && typeof x === 'object')
    .map((x) => ({
      date: String(x.date ?? '').slice(0, 10),
      close: typeof x.close === 'number' && Number.isFinite(x.close) ? x.close : NaN,
    }))
    .filter((x) => x.date.length >= 8 && Number.isFinite(x.close))
}
