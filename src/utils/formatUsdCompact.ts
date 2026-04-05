/**
 * Compact currency for dense tables: −$952M instead of −$952,869,955.
 * Uses truncation (floor) toward zero for each unit step, not bank rounding.
 */
export function formatUsdCompact(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const sign = value < 0 ? '−' : ''
  const v = Math.abs(value)
  if (v >= 1e9) {
    return `${sign}$${Math.floor(v / 1e9)}B`
  }
  if (v >= 1e6) {
    return `${sign}$${Math.floor(v / 1e6)}M`
  }
  if (v >= 1e3) {
    return `${sign}$${Math.floor(v / 1e3)}K`
  }
  return `${sign}$${Math.floor(v)}`
}
