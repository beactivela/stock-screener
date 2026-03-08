import { describe, it } from 'node:test'
import assert from 'node:assert'
import { calculateBeactiveRsiTrend } from './beactiveRsiTrend.js'

describe('beactiveRsiTrend utils', () => {
  it('returns empty output for no close data', () => {
    assert.deepEqual(calculateBeactiveRsiTrend([]), [])
  })

  it('marks trend as green only when close is above both 50 and 150 SMA', () => {
    const closes = Array.from({ length: 200 }, (_, i) => 100 + i)
    const points = calculateBeactiveRsiTrend(closes)
    const last = points[points.length - 1]
    assert.equal(last.trendColor, 'green')
    assert.equal(last.bearishFill, false)
  })

  it('marks trend as red when close falls below 50 or 150 SMA', () => {
    const closes = [
      ...Array.from({ length: 180 }, (_, i) => 100 + i * 0.8),
      ...Array.from({ length: 20 }, (_, i) => 50 - i),
    ]
    const points = calculateBeactiveRsiTrend(closes)
    const last = points[points.length - 1]
    assert.equal(last.trendColor, 'red')
    assert.equal(last.bearishFill, true)
  })

  it('follows fill rules: bullish when RSI > 50 and trend green', () => {
    const closes = Array.from({ length: 220 }, (_, i) => 100 + i * 0.5)
    const points = calculateBeactiveRsiTrend(closes)
    const last = points[points.length - 1]
    assert.equal(last.trendColor, 'green')
    assert.equal(last.rsi != null && last.rsi > 50, true)
    assert.equal(last.bullishFill, true)
    assert.equal(last.bearishFill, false)
  })
})
