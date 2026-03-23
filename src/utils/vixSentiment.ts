/**
 * CBOE VIX level -> coarse market-stress band (educational thresholds for the dashboard).
 * Low: calm; Moderate: elevated uncertainty; High: stress / fear spikes.
 */

export type VixSentimentBand = 'low' | 'moderate' | 'high'

export function getVixSentimentBand(
  vixClose: number | null | undefined,
): { band: VixSentimentBand; label: string } | null {
  if (vixClose == null || Number.isNaN(vixClose)) return null
  const v = Number(vixClose)
  if (v < 20) return { band: 'low', label: 'Low' }
  if (v <= 30) return { band: 'moderate', label: 'Moderate' }
  return { band: 'high', label: 'High' }
}

/** Static copy for the UI (matches product spec). */
export const VIX_SENTIMENT_GUIDE = {
  low: 'Generally indicates a stable, less stressful market environment.',
  moderate: 'Reflects heightened uncertainty.',
  moderateWithLevel: (level: number) =>
    `Reflects heightened uncertainty; the current level of ${level.toFixed(2)} suggests significant market anxiety.`,
  high: 'Associated with extreme fear and periods of market turmoil.',
}

/**
 * Tailwind classes for sentiment badge (dark cards).
 */
export function vixSentimentTone(band: VixSentimentBand): string {
  if (band === 'low') return 'text-emerald-300 bg-emerald-500/15 border-emerald-700/50'
  if (band === 'moderate') return 'text-amber-200 bg-amber-500/20 border-amber-600/50'
  return 'text-red-100 bg-red-500/30 border-red-400/70'
}
