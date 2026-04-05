/**
 * Stable key for joining FMP `fmp_congress_trades.first_name` / `last_name` to `congress_politician_identity`.
 * Format: lowercase `last|first` with trimmed tokens (handles "Nancy" + "Pelosi").
 */
export function fmpNameKeyFromParts(firstName, lastName) {
  const f = String(firstName ?? '')
    .trim()
    .toLowerCase()
  const l = String(lastName ?? '')
    .trim()
    .toLowerCase()
  if (!l && !f) return ''
  return `${l}|${f}`
}
