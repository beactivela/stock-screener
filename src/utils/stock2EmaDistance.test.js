import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildEmaDistanceOverlayLayout,
  emaDistanceOverlayColor,
  formatEmaDistancePercent,
  priceEmaDistancePercent,
} from './stock2EmaDistance.ts'

describe('stock2EmaDistance', () => {
  it('computes percent distance from price above EMA', () => {
    assert.equal(priceEmaDistancePercent(105, 100), 5)
    assert.equal(priceEmaDistancePercent(97.5, 100), -2.5)
  })

  it('returns null when EMA is missing or zero', () => {
    assert.equal(priceEmaDistancePercent(100, null), null)
    assert.equal(priceEmaDistancePercent(100, 0), null)
    assert.equal(priceEmaDistancePercent(Number.NaN, 100), null)
  })

  it('formats signed percent for display', () => {
    assert.equal(formatEmaDistancePercent(5.123), '+5.12%')
    assert.equal(formatEmaDistancePercent(-2.5), '-2.50%')
    assert.equal(formatEmaDistancePercent(null), '—')
  })

  it('builds a vertical overlay segment from EMA Y to price Y', () => {
    const layout = buildEmaDistanceOverlayLayout({
      price: 105,
      emaValue: 100,
      x: 420,
      priceY: 80,
      emaY: 120,
    })
    assert.equal(layout.visible, true)
    assert.equal(layout.x, 420)
    assert.equal(layout.topY, 80)
    assert.equal(layout.bottomY, 120)
    assert.equal(layout.labelY, 100)
    assert.equal(layout.distancePct, 5)
  })

  it('orders overlay top/bottom when price is below EMA', () => {
    const layout = buildEmaDistanceOverlayLayout({
      price: 95,
      emaValue: 100,
      x: 300,
      priceY: 140,
      emaY: 100,
    })
    assert.equal(layout.topY, 100)
    assert.equal(layout.bottomY, 140)
    assert.equal(layout.distancePct, -5)
  })

  it('enforces a minimum visible line height when EMA and price are nearly coincident', () => {
    const layout = buildEmaDistanceOverlayLayout({
      price: 100.01,
      emaValue: 100,
      x: 250,
      priceY: 100,
      emaY: 101,
    })
    assert.equal(layout.visible, true)
    assert.equal(layout.bottomY - layout.topY, 6)
    assert.equal(layout.labelY, 100.5)
  })

  it('hides overlay when chart coordinates are unavailable', () => {
    const layout = buildEmaDistanceOverlayLayout({
      price: 105,
      emaValue: 100,
      x: null,
      priceY: 80,
      emaY: 120,
    })
    assert.equal(layout.visible, false)
  })

  it('maps positive distance to green and negative to red', () => {
    assert.equal(emaDistanceOverlayColor(2.5), '#22c55e')
    assert.equal(emaDistanceOverlayColor(-1), '#ef4444')
    assert.equal(emaDistanceOverlayColor(null), '#94a3b8')
  })
})
