import { calculateMA50Angle } from './marketRegime.js'

/**
 * @typedef {'Strong Negative' | 'Negative' | 'Neutral Negative' | 'Neutral' | 'Neutral Positive' | 'Bullish' | 'Strong Bullish'} BreadthTrendLabel
 */

/**
 * @typedef {'Bearish' | 'Neutral' | 'Semi Bullish' | 'Bullish'} MarketExposureLabel
 */

/**
 * @typedef {{
 *   score: 1 | 2 | 3 | 4 | 5 | 6 | 7
 *   label: BreadthTrendLabel
 *   angle: number | null
 *   exposureLabel: MarketExposureLabel
 *   exposurePercentage: 20 | 40 | 70 | 80
 * }} BreadthTrendRating
 */

/**
 * @typedef {{
 *   score: 1 | 2 | 3 | 4 | 5 | 6 | 7
 *   label: BreadthTrendLabel
 *   shortLabel: string
 *   className: string
 *   exposureLabel: MarketExposureLabel
 *   exposurePercentage: 20 | 40 | 70 | 80
 * }} BreadthTrendSegment
 */

/**
 * Map the more granular 1-7 breadth score to the simpler exposure buckets the UI shows.
 *
 * @param {1 | 2 | 3 | 4 | 5 | 6 | 7} score
 * @returns {{ exposureLabel: MarketExposureLabel, exposurePercentage: 20 | 40 | 70 | 80 }}
 */
export function getMarketExposureForBreadthScore(score) {
  if (score >= 6) return { exposureLabel: 'Bullish', exposurePercentage: 80 }
  if (score === 5) return { exposureLabel: 'Semi Bullish', exposurePercentage: 70 }
  if (score >= 3) return { exposureLabel: 'Neutral', exposurePercentage: 40 }
  return { exposureLabel: 'Bearish', exposurePercentage: 20 }
}

/** @type {BreadthTrendSegment[]} */
export const BREADTH_TREND_SEGMENTS = [
  { score: 1, label: 'Strong Negative', shortLabel: 'Strong Negative', className: 'bg-red-700 text-red-100', ...getMarketExposureForBreadthScore(1) },
  { score: 2, label: 'Negative', shortLabel: 'Negative', className: 'bg-red-500 text-red-100', ...getMarketExposureForBreadthScore(2) },
  { score: 3, label: 'Neutral Negative', shortLabel: 'Neutral Negative', className: 'bg-amber-500 text-amber-950', ...getMarketExposureForBreadthScore(3) },
  { score: 4, label: 'Neutral', shortLabel: 'Neutral', className: 'bg-yellow-300 text-yellow-950', ...getMarketExposureForBreadthScore(4) },
  { score: 5, label: 'Neutral Positive', shortLabel: 'Neutral Positive', className: 'bg-yellow-200 text-yellow-950', ...getMarketExposureForBreadthScore(5) },
  { score: 6, label: 'Bullish', shortLabel: 'Bullish', className: 'bg-emerald-300 text-emerald-950', ...getMarketExposureForBreadthScore(6) },
  { score: 7, label: 'Strong Bullish', shortLabel: 'Strong Bullish', className: 'bg-emerald-600 text-emerald-100', ...getMarketExposureForBreadthScore(7) },
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
  const withExposure = (score, label, nextAngle) => ({
    score,
    label,
    angle: nextAngle,
    ...getMarketExposureForBreadthScore(score),
  })

  if (typeof angle !== 'number' || !Number.isFinite(angle)) {
    return withExposure(4, 'Neutral', null)
  }
  if (angle >= 20) return withExposure(7, 'Strong Bullish', angle)
  if (angle >= 10) return withExposure(6, 'Bullish', angle)
  if (angle >= 5) return withExposure(5, 'Neutral Positive', angle)
  if (angle > -2) return withExposure(4, 'Neutral', angle)
  if (angle >= -10) return withExposure(3, 'Neutral Negative', angle)
  if (angle >= -20) return withExposure(2, 'Negative', angle)
  return withExposure(1, 'Strong Negative', angle)
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
