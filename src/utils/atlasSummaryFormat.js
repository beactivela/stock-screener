export function formatPercent(value) {
  if (!Number.isFinite(value)) return 'N/A'
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${Number(value).toFixed(2)}%`
}

export function formatCurrencyCompact(value) {
  if (!Number.isFinite(value)) return 'N/A'
  const n = Number(value)
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(2)}K`
  return `$${n.toFixed(2)}`
}
