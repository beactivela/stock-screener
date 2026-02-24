/**
 * Unit tests for Turtle Trader agent filter logic.
 * Run: node --test server/agents/turtleTrader.test.js
 */
import { describe, it } from 'node:test'
import assert from 'node:assert'
import turtleTrader from './turtleTrader.js'

function baseSignal(overrides = {}) {
  return {
    ticker: 'TEST',
    entryDate: '2026-02-21',
    entryPrice: 100,
    returnPct: 5,
    context: {
      signalFamily: 'turtle',
      turtleBreakout20: true,
      turtleBreakout55: false,
      maAlignmentValid: true,
      priceAboveAllMAs: true,
      ma200Rising: true,
      atr20Pct: 3,
      relativeStrength: 85,
      ...overrides.context,
    },
    ...overrides,
  }
}

describe('Turtle Trader agent', () => {
  it('filters to valid Turtle breakout signals only', () => {
    const signals = [
      baseSignal(),
      baseSignal({ context: { signalFamily: 'opus45' } }),
      baseSignal({ context: { turtleBreakout20: false, turtleBreakout55: false } }),
      baseSignal({ context: { atr20Pct: 12 } }),
      baseSignal({ context: { maAlignmentValid: false } }),
    ]

    const filtered = turtleTrader.filterSignals(signals)
    assert.equal(filtered.length, 1)
    assert.equal(filtered[0].context.signalFamily, 'turtle')
  })
})
