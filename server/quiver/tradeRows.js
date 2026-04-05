/**
 * Normalize Quiver `tradeData` rows (array-of-arrays) into DB rows and filter by traded date.
 */

/** @param {unknown[]} row */
export function normalizeTradeRow(row) {
  if (!Array.isArray(row) || row.length < 4) return null
  const symbol = row[0] != null ? String(row[0]).trim().toUpperCase() : ''
  const transactionType = row[1] != null ? String(row[1]).trim() : ''
  const filedRaw = row[2] != null ? String(row[2]).slice(0, 10) : null
  const tradedRaw = row[3] != null ? String(row[3]).slice(0, 10) : null
  const description = row[4] != null ? String(row[4]) : null
  const excess = row[5]
  const excessNum = typeof excess === 'number' && Number.isFinite(excess) ? excess : null
  const amountRange = row[9] != null ? String(row[9]) : null
  const chamber = row[11] != null ? String(row[11]) : null

  return {
    symbol: symbol || null,
    transaction_type: transactionType || null,
    filed_date: filedRaw && /^\d{4}-\d{2}-\d{2}$/.test(filedRaw) ? filedRaw : null,
    transaction_date: tradedRaw && /^\d{4}-\d{2}-\d{2}$/.test(tradedRaw) ? tradedRaw : null,
    description,
    amount_range: amountRange,
    chamber,
    excess_return_pct: excessNum,
    raw_json: row,
  }
}

/**
 * @param {unknown[][]} tradeRows
 * @param {number} days
 * @param {Date} [asOf]
 */
export function filterTradesLastDays(tradeRows, days, asOf = new Date()) {
  const cutoff = new Date(asOf)
  cutoff.setDate(cutoff.getDate() - days)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  const out = []
  for (const r of tradeRows) {
    const n = normalizeTradeRow(r)
    if (!n?.transaction_date) continue
    if (n.transaction_date >= cutoffStr) out.push(n)
  }
  return out
}
