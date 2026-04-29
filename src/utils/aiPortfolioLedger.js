/**
 * Pure helpers for AI Portfolio ledger + position P/L display.
 * (Keeps formulae testable independently of React.)
 */

/**
 * Drops orphan "OPEN" ledger rows when a CLOSED row exists for the same `positionId`
 * (fixes legacy persisted state from before exits updated the original row).
 * @param {Array<Record<string, unknown>>} rows
 */
export function filterStaleOpenLedgerRows(rows) {
  if (!Array.isArray(rows)) return []
  return rows.filter((trade) => {
    if (!trade?.exitAt && trade?.positionId) {
      const superseded = rows.some(
        (t) =>
          t?.positionId === trade.positionId &&
          Boolean(t?.exitAt) &&
          String(t?.status || '').toLowerCase() === 'closed',
      )
      if (superseded) return false
    }
    return true
  })
}

/**
 * Sum realized P/L from **closed** ledger rows for a symbol (prior round-trips on that ticker).
 * @param {Array<Record<string, unknown>>} rows
 * @param {string} ticker
 */
export function sumRealizedUsdClosedForSymbol(rows, ticker) {
  const sym = String(ticker || '').trim().toUpperCase()
  if (!sym) return 0
  let s = 0
  for (const r of rows || []) {
    if (!r?.exitAt) continue
    if (String(r.ticker || '').toUpperCase() !== sym) continue
    s += Number(r.realizedPnlUsd) || 0
  }
  return s
}

/**
 * Mark-to-market unrealized on this open line + all **closed** realized on the same symbol in the log.
 * @param {number} unrealizedPnlUsd
 * @param {Array<Record<string, unknown>>} ledgerRows
 * @param {string} ticker
 */
export function netSymbolPnlUsd(unrealizedPnlUsd, ledgerRows, ticker) {
  return (Number(unrealizedPnlUsd) || 0) + sumRealizedUsdClosedForSymbol(ledgerRows, ticker)
}
