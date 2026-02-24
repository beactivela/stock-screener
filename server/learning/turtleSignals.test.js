import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  computeATR,
  donchianHigh,
  donchianLow,
  detectBreakout,
  simulateTurtleTrade,
} from './turtleSignals.js'

function makeBars(count, { start = 100, high = 101, low = 99, close = 100, step = 0 } = {}) {
  return Array.from({ length: count }).map((_, i) => {
    const base = start + i * step
    return {
      t: i + 1,
      o: base,
      h: high + i * step,
      l: low + i * step,
      c: close + i * step,
      v: 1_000_000,
    }
  })
}

describe('turtleSignals helpers', () => {
  it('computes ATR(20) for constant range bars', () => {
    const bars = makeBars(25, { start: 100, high: 101, low: 99, close: 100 })
    const atr = computeATR(bars, 20)
    assert.ok(Array.isArray(atr))
    assert.equal(atr.length, bars.length)
    // ATR becomes available at index 19 (20th bar)
    assert.equal(atr[19], 2)
    assert.equal(atr[24], 2)
  })

  it('computes Donchian high/low using prior bars only', () => {
    const bars = [
      { t: 1, h: 10, l: 5, c: 8 },
      { t: 2, h: 11, l: 6, c: 9 },
      { t: 3, h: 12, l: 7, c: 10 },
      { t: 4, h: 9,  l: 4, c: 6 },
    ]
    assert.equal(donchianHigh(bars, 3, 3), 12)
    assert.equal(donchianLow(bars, 3, 3), 5)
  })

  it('detects a 20-day breakout only after enough history', () => {
    const bars = makeBars(21, { start: 100, high: 110, low: 99, close: 105 })
    // Keep first 20 highs flat at 110
    const flat = bars.map((b, i) => ({ ...b, h: i < 20 ? 110 : 112 }))
    assert.equal(detectBreakout(flat, 19, 20), false)
    assert.equal(detectBreakout(flat, 20, 20), true)
  })

  it('exits on 2N stop for a long trade', () => {
    const bars = makeBars(25, { start: 100, high: 101, low: 99, close: 100 })
    // Entry at index 20 (price 100), ATR=2 → stop at 96
    bars[21] = { ...bars[21], l: 95, c: 96 }
    const result = simulateTurtleTrade({
      bars,
      entryIndex: 20,
      system: 'S1',
      atrPeriod: 20,
      stopMultiple: 2,
      exitLookback: 10,
    })
    assert.equal(result.exitType, 'TURTLE_STOP')
    assert.equal(result.exitPrice, 96)
  })

  it('exits on Donchian low for S1 when stop not hit', () => {
    const bars = makeBars(30, { start: 100, high: 102, low: 98, close: 100 })
    // Entry at index 20, ATR=2 → stop at 96, keep lows above stop
    bars[24] = { ...bars[24], l: 97, c: 98 } // new 10-day low triggers exit
    const result = simulateTurtleTrade({
      bars,
      entryIndex: 20,
      system: 'S1',
      atrPeriod: 20,
      stopMultiple: 2,
      exitLookback: 10,
    })
    assert.equal(result.exitType, 'TURTLE_EXIT_LOW')
    assert.equal(result.exitPrice, 98)
  })
})
