/**
 * Parse strategy (Apr 2026): politician pages SSR `let tradeData = [ ... ]` (full trade history),
 * `bioguideID`, `directOrderName`. Performance horizons are not on this page — we fetch
 * `/strategies/s/{directOrderName}/` and read embedded `graphDataStrategy` (see parseStrategyGraphHtml.js).
 *
 * Quiver politician HTML embeds inline script:
 *   let bioguideID = "P000197";
 *   let directOrderName = "Nancy Pelosi";
 *   let tradeData = [[ ticker, type, filedIso, tradedIso, ... ], ...];
 *
 * Large `tradeData` arrays use bracket-balanced extraction (see extractJsonArray.js).
 */

import { extractJsonArrayAfter } from './extractJsonArray.js'

/**
 * @param {string} html
 * @returns {{ bioguideId: string, directOrderName: string, tradeRows: unknown[][] } | null}
 */
export function parsePoliticianPageEmbedded(html) {
  const bio = html.match(/let\s+bioguideID\s*=\s*"([^"]+)"/)
  const name = html.match(/let\s+directOrderName\s*=\s*"([^"]*)"/)

  if (!bio?.[1]) return null

  let tradeRows = extractJsonArrayAfter(html, 'let tradeData = ')
  if (!Array.isArray(tradeRows)) tradeRows = []

  return {
    bioguideId: bio[1].trim(),
    directOrderName: (name?.[1] ?? '').trim() || 'Unknown',
    tradeRows,
  }
}
