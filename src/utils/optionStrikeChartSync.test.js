import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildVisiblePriceRangeFromChart,
  buildStrikeCoordinateMap,
  createOiStrikeAutoscaleInfoProvider,
  isValidStrikeCoordinate,
  resolveStrikeChartY,
  strikePriceBounds,
} from './optionStrikeChartSync.ts'

describe('optionStrikeChartSync', () => {
  it('rejects null, non-finite, and edge coordinates that break OI alignment', () => {
    assert.equal(isValidStrikeCoordinate(null, 600), false)
    assert.equal(isValidStrikeCoordinate(0, 600), false)
    assert.equal(isValidStrikeCoordinate(600, 600), false)
    assert.equal(isValidStrikeCoordinate(120, 600), true)
  })

  it('computes min/max strike bounds from OI rows', () => {
    assert.deepEqual(
      strikePriceBounds([
        { strike: 410 },
        { strike: 470 },
        { strike: 440 },
      ]),
      { min: 410, max: 470 },
    )
    assert.equal(strikePriceBounds([]), null)
  })

  it('extends autoscale price range to include OI strike band', () => {
    const provider = createOiStrikeAutoscaleInfoProvider({ min: 380, max: 480 })
    const result = provider(() => ({
      priceRange: { minValue: 400, maxValue: 460 },
    }))
    assert.deepEqual(result?.priceRange, { minValue: 380, maxValue: 480 })
  })

  it('builds coordinate map only for in-pane chart Y values', () => {
    const map = buildStrikeCoordinateMap(
      (price) => {
        if (price === 420) return 200
        if (price === 470) return 0
        if (price === 380) return null
        return null
      },
      [{ strike: 420 }, { strike: 470 }, { strike: 380 }],
      600,
    )
    assert.deepEqual(map, { '420': 200 })
  })

  it('builds live visible price range from chart coordinate inversion', () => {
    const range = buildVisiblePriceRangeFromChart((coordinate) => {
      if (coordinate === 0) return 510
      if (coordinate === 600) return 390
      return null
    }, 600)
    assert.deepEqual(range, { min: 390, max: 510 })
  })

  it('resolves strike Y from direct coordinates before fallback ranges', () => {
    const y = resolveStrikeChartY({
      strike: 420,
      pricePaneHeight: 600,
      strikeCoordinates: { '420': 180 },
      visiblePriceRange: { min: 390, max: 510 },
    })
    assert.equal(y, 180)
  })

  it('falls back to visible chart price range when strike coordinate is missing', () => {
    const y = resolveStrikeChartY({
      strike: 450,
      pricePaneHeight: 600,
      strikeCoordinates: {},
      visiblePriceRange: { min: 390, max: 510 },
    })
    assert.equal(y, 300)
  })

  it('falls back to static range only when visible chart range is unavailable', () => {
    const y = resolveStrikeChartY({
      strike: 450,
      pricePaneHeight: 600,
      strikeCoordinates: {},
      visiblePriceRange: null,
      fallbackPriceRange: { min: 400, max: 500 },
    })
    assert.equal(y, 300)
  })
})
