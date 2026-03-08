import { calculateMA50Angle } from './marketRegime.js'

/**
 * @typedef {'Strong Negative' | 'Negative' | 'Neutral Negative' | 'Neutral' | 'Neutral Positive' | 'Bullish' | 'Strong Bullish'} BreadthTrendLabel
 */

/**
 * @typedef {{
 *   score: 1 | 2 | 3 | 4 | 5 | 6 | 7
 *   label: BreadthTrendLabel
 *   angle: number | null
 * }} BreadthTrendRating
 */

export const BREADTH_TREND_SEGMENTS = [
  { score: 1, label: 'Strong Negative', shortLabel: 'Strong Negative', className: 'bg-red-700 text-red-100' },
  { score: 2, label: 'Negative', shortLabel: 'Negative', className: 'bg-red-500 text-red-100' },
  { score: 3, label: 'Neutral Negative', shortLabel: 'Neutral Negative', className: 'bg-amber-500 text-amber-950' },
  { score: 4, label: 'Neutral', shortLabel: 'Neutral', className: 'bg-yellow-300 text-yellow-950' },
  { score: 5, label: 'Neutral Positive', shortLabel: 'Neutral Positive', className: 'bg-yellow-200 text-yellow-950' },
  { score: 6, label: 'Bullish', shortLabel: 'Bullish', className: 'bg-emerald-300 text-emerald-950' },
  { score: 7, label: 'Strong Bullish', shortLabel: 'Strong Bullish', className: 'bg-emerald-600 text-emerald-100' },
]

/**
 * Map MA50 angle (degrees) to 1-7 breadth rating.
 *
 * Thresholds used:
 * - 7 Strong Bullish: angle >= 20
 * - 6 Bullish: angle >= 10 and < 20
 * - 5 Neutral Positive: angle >= 5 and < 10
 * - 4 Neutral: angle > -2 and < 5
 * - 3 Neutral Negative: angle >= -10 and <= -2
 * - 2 Negative: angle >= -20 and < -10
 * - 1 Strong Negative: angle < -20
 *
 * @param {number | null | undefined} angle
 * @returns {BreadthTrendRating}
 */
export function getBreadthTrendRatingFromAngle(angle) {
  if (typeof angle !== 'number' || !Number.isFinite(angle)) {
    return { score: 4, label: 'Neutral', angle: null }
  }
  if (angle >= 20) return { score: 7, label: 'Strong Bullish', angle }
  if (angle >= 10) return { score: 6, label: 'Bullish', angle }
  if (angle >= 5) return { score: 5, label: 'Neutral Positive', angle }
  if (angle > -2) return { score: 4, label: 'Neutral', angle }
  if (angle >= -10) return { score: 3, label: 'Neutral Negative', angle }
  if (angle >= -20) return { score: 2, label: 'Negative', angle }
  return { score: 1, label: 'Strong Negative', angle }
}

/**
 * Compute breadth rating from recent MA50 values.
 *
 * @param {Array<number | null | undefined>} recentMa50
 * @returns {BreadthTrendRating}
 */
export function getBreadthTrendRatingFromRecentMa50(recentMa50) {
  const values = (Array.isArray(recentMa50) ? recentMa50 : []).filter((v) => typeof v === 'number' && Number.isFinite(v))
  if (values.length < 2) return getBreadthTrendRatingFromAngle(null)
  const angle = calculateMA50Angle(values)
  return getBreadthTrendRatingFromAngle(angle)
}
