/**
 * @typedef {'green' | 'red'} BeactiveTrendColor
 */

/**
 * @typedef {{
 *   close: number,
 *   rsi: number | null,
 *   ma50: number | null,
 *   ma150: number | null,
 *   trendColor: BeactiveTrendColor | null,
 *   bullishFill: boolean,
 *   bearishFill: boolean,
 * }} BeactiveRsiPoint
 */

/**
 * Beactive RSI Trend logic (parity with supplied PineScript):
 * - RSI length default 14
 * - Trend color green when close > 50 MA AND close > 150 MA, else red
 * - Bullish fill when RSI > 50 and trend is green
 * - Bearish fill when RSI <= 50 or trend is red
 *
 * @param {number[]} closes
 * @param {number} [rsiLength=14]
 * @returns {BeactiveRsiPoint[]}
 */
export function calculateBeactiveRsiTrend(closes, rsiLength = 14) {
  if (!Array.isArray(closes) || closes.length === 0) return []
  const rsiValues = computeRsi(closes, rsiLength)
  const ma50 = computeSma(closes, 50)
  const ma150 = computeSma(closes, 150)

  return closes.map((close, index) => {
    const rsiValue = rsiValues[index] ?? null
    const ma50Value = ma50[index] ?? null
    const ma150Value = ma150[index] ?? null
    const hasTrendInputs = ma50Value != null && ma150Value != null
    const trendColor = hasTrendInputs && close > ma50Value && close > ma150Value ? 'green' : hasTrendInputs ? 'red' : null
    const bullishFill = rsiValue != null && trendColor === 'green' && rsiValue > 50
    const bearishFill = rsiValue != null && (rsiValue <= 50 || trendColor === 'red')

    return {
      close,
      rsi: rsiValue,
      ma50: ma50Value,
      ma150: ma150Value,
      trendColor,
      bullishFill,
      bearishFill,
    }
  })
}

/**
 * @param {number[]} values
 * @param {number} period
 * @returns {(number | null)[]}
 */
function computeSma(values, period) {
  const out = []
  for (let i = 0; i < values.length; i += 1) {
    if (i < period - 1) {
      out.push(null)
      continue
    }
    let sum = 0
    for (let j = i - period + 1; j <= i; j += 1) sum += values[j]
    out.push(sum / period)
  }
  return out
}

/**
 * @param {number[]} closes
 * @param {number} period
 * @returns {(number | null)[]}
 */
function computeRsi(closes, period) {
  const out = []
  for (let i = 0; i < closes.length; i += 1) {
    if (i < period) {
      out.push(null)
      continue
    }
    let sumGain = 0
    let sumLoss = 0
    for (let j = i - period + 1; j <= i; j += 1) {
      const change = closes[j] - closes[j - 1]
      if (change > 0) sumGain += change
      else sumLoss += Math.abs(change)
    }
    const avgGain = sumGain / period
    const avgLoss = sumLoss / period
    if (avgLoss === 0) {
      out.push(100)
      continue
    }
    const rs = avgGain / avgLoss
    out.push(100 - 100 / (1 + rs))
  }
  return out
}
