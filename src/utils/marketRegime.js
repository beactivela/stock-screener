/**
 * MA-based regime labels used by Dashboard market index cards.
 */

/**
 * @typedef {'Risk ON' | 'Risk OFF'} MarketRegimeLabel
 */

/**
 * Classify regime from price and moving-average alignment.
 *
 * Simplified classification:
 * - Risk ON: close > 20 MA and 10 MA > 50 MA
 * - Risk OFF: otherwise
 *
 * @param {{
 *   close?: number | null,
 *   ma10?: number | null,
 *   ma20?: number | null,
 *   ma50?: number | null,
  *   recentMa20?: Array<number | null | undefined>,
  *   recentMa50?: Array<number | null | undefined>,
 *   neutralBandPct?: number
 * }} params
 * @returns {MarketRegimeLabel}
 */
export function classifyMovingAverageRegime(params) {
  const {
    close,
    ma10,
    ma20,
    ma50,
  } = params || {}

  if (!isFiniteNumber(close) || !isFiniteNumber(ma10) || !isFiniteNumber(ma20) || !isFiniteNumber(ma50)) {
    return 'Risk OFF'
  }

  if (close > ma20 && ma10 > ma50) return 'Risk ON'
  return 'Risk OFF'
}

/**
 * Calculate the angle of the 50 MA using linear regression.
 * Returns the angle in degrees based on percentage change.
 *
 * @param {Array<number>} values - Recent MA50 values
 * @returns {number} - Angle in degrees
 */
export function calculateMA50Angle(values) {
  const n = values.length
  if (n < 2) return 0

  // Linear regression: y = mx + b
  // Calculate slope (m) using least squares method
  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumX2 = 0

  for (let i = 0; i < n; i++) {
    const x = i
    const y = values[i]
    sumX += x
    sumY += y
    sumXY += x * y
    sumX2 += x * x
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)
  
  // Convert slope to percentage change per period relative to the starting value
  const startValue = values[0]
  if (startValue === 0) return 0
  
  // Calculate the percentage change over the entire period
  const totalChange = slope * (n - 1)
  const percentChange = (totalChange / startValue) * 100
  
  // Convert to angle: arctan(rise/run) where rise is the percent change
  // and run is the number of periods. This gives us a normalized angle.
  const angleRadians = Math.atan(percentChange / 10) // normalize by 10 periods
  const angleDegrees = (angleRadians * 180) / Math.PI

  return angleDegrees
}

/**
 * @param {number | null | undefined} value
 * @returns {boolean}
 */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}
