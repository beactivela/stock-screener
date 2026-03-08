/**
 * MA-based regime labels used by Dashboard market index cards.
 */

/**
 * @typedef {'Risk ON' | 'Cautious' | 'Risk OFF'} MarketRegimeLabel
 */

/**
 * Classify regime from 50 moving average angle.
 *
 * Simplified classification based on 50 MA trend:
 * - Risk ON: angle > 20° (strong uptrend)
 * - Cautious: angle < 20° and > 5° (weak uptrend)
 * - Risk OFF: angle ≤ 5° (flat or declining)
 *
 * @param {{
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
    ma50,
    recentMa50 = [],
  } = params || {}

  // Need at least 2 points to calculate an angle
  if (!isFiniteNumber(ma50) || recentMa50.length < 10) {
    return 'Risk OFF'
  }

  // Calculate the angle of the 50 MA
  // Use the last 10 periods (approximately 2 weeks of trading days)
  const ma50Values = recentMa50.slice(-10).filter(isFiniteNumber)
  
  if (ma50Values.length < 2) {
    return 'Risk OFF'
  }

  // Calculate angle using linear regression slope
  const angle = calculateMA50Angle(ma50Values)

  // Apply simplified regime rules
  if (angle > 20) return 'Risk ON'
  if (angle > 5 && angle <= 20) return 'Cautious'
  return 'Risk OFF' // angle <= 5
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
