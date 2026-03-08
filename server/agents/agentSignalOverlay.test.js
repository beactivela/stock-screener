/**
 * Unit tests for agent signal overlay helpers.
 * Run: node --test server/agents/agentSignalOverlay.test.js
 */
import { describe, it } from 'node:test'
import assert from 'node:assert'
import { buildAgentBuyMarkers, AGENT_CHART_CONFIG } from './agentSignalOverlay.js'

function opus45Signal(overrides = {}) {
  return {
    ticker: 'TEST',
    entryDate: '2026-02-21',
    entryPrice: 100,
    entryBarIdx: 1,
    context: {
      signalFamily: 'opus45',
      relativeStrength: 90,
      ma10Slope14d: 8,
      pctFromHigh: 10,
      contractions: 4,
      volumeDryUp: true,
      patternConfidence: 70,
      breakoutVolumeRatio: 1.4,
      ...overrides.context,
    },
    ...overrides,
  }
}

function turtleSignal(overrides = {}) {
  return {
    ticker: 'TEST',
    entryDate: '2026-02-22',
    entryPrice: 110,
    entryBarIdx: 1,
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

describe('buildAgentBuyMarkers', () => {
  it('filters signals by agent rules and maps to chart markers', () => {
    const bars = [{ t: 1000 }, { t: 2000 }, { t: 3000 }]
    const signals = [
      opus45Signal(),
      opus45Signal({ context: { relativeStrength: 60 } }),
      opus45Signal({ context: { signalFamily: 'turtle' } }),
    ]

    const markers = buildAgentBuyMarkers({
      agentType: 'momentum_scout',
      signals,
      bars,
    })

    assert.equal(markers.length, 1)
    assert.equal(markers[0].time, 2) // 2000ms -> 2s
    assert.equal(markers[0].label, AGENT_CHART_CONFIG.momentum_scout.name)
    assert.equal(markers[0].color, AGENT_CHART_CONFIG.momentum_scout.color)
  })

  it('supports turtle signals with entryDate fallback timing', () => {
    const bars = [{ t: 1000 }, { t: 2000 }]
    const signals = [
      turtleSignal(),
      turtleSignal({ entryBarIdx: 99 }),
      turtleSignal({ context: { atr20Pct: 15 } }),
    ]

    const markers = buildAgentBuyMarkers({
      agentType: 'turtle_trader',
      signals,
      bars,
    })

    assert.equal(markers.length, 2)
    assert.equal(markers[0].label, AGENT_CHART_CONFIG.turtle_trader.name)
    assert.equal(markers[0].color, AGENT_CHART_CONFIG.turtle_trader.color)

    const times = markers.map((m) => m.time).sort()
    const entryDateTime = Math.floor(Date.parse('2026-02-22T00:00:00Z') / 1000)
    assert.ok(times.includes(2)) // 2000ms -> 2s
    assert.ok(times.includes(entryDateTime))
  })
})
