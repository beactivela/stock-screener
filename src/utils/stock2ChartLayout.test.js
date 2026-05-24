import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  approximateTradingDays,
  computeStock2PricePaneHeight,
  computeStock2StackHeight,
  computeStock2BarsFetchDays,
  EMA315_PERIOD,
  minCalendarDaysForTradingBars,
  STOCK2_MIN_PRICE_PANE_HEIGHT_PX,
  STOCK2_RSI_BLOCK_HEIGHT_PX,
  STOCK2_TOOLBAR_HEIGHT_PX,
} from './stock2ChartLayout.ts'

describe('stock2ChartLayout', () => {
  it('fills the chart grid cell minus RSI block when indicators are on', () => {
    const gridHeight = 900
    assert.equal(
      computeStock2PricePaneHeight({ gridHeight, showIndicators: true }),
      gridHeight - STOCK2_RSI_BLOCK_HEIGHT_PX,
    )
  })

  it('uses the full grid cell when RSI is hidden (TradeVision default)', () => {
    assert.equal(computeStock2PricePaneHeight({ gridHeight: 820, showIndicators: false }), 820)
  })

  it('never returns a pane taller than the grid cell', () => {
    const pane = computeStock2PricePaneHeight({ gridHeight: 700, showIndicators: true })
    assert.ok(pane <= 700)
    assert.equal(pane, 700 - STOCK2_RSI_BLOCK_HEIGHT_PX)
  })

  it('shrinks price pane when viewport is tighter than preferred minimum', () => {
    const tightGrid = STOCK2_MIN_PRICE_PANE_HEIGHT_PX + STOCK2_RSI_BLOCK_HEIGHT_PX - 80
    const pane = computeStock2PricePaneHeight({ gridHeight: tightGrid, showIndicators: true })
    assert.equal(pane, tightGrid - STOCK2_RSI_BLOCK_HEIGHT_PX)
  })

  it('computes stack height as price pane plus optional RSI block', () => {
    assert.equal(computeStock2StackHeight(600, false), 600)
    assert.equal(computeStock2StackHeight(600, true), 600 + STOCK2_RSI_BLOCK_HEIGHT_PX)
  })

  it('derives viewport fallback from header and toolbar chrome', () => {
    const viewport = 1200
    const fallbackGrid =
      viewport - 88 - STOCK2_TOOLBAR_HEIGHT_PX
    const pane = computeStock2PricePaneHeight({
      gridHeight: fallbackGrid,
      showIndicators: false,
    })
    assert.equal(pane, fallbackGrid)
  })

  it('365 calendar days is not enough trading bars for EMA 315', () => {
    assert.ok(approximateTradingDays(365) < EMA315_PERIOD)
  })

  it('requests at least 730 calendar days on daily for EMA 315 warmup', () => {
    const days = computeStock2BarsFetchDays('1d')
    assert.ok(days >= 730)
    assert.ok(approximateTradingDays(days) >= EMA315_PERIOD)
  })

  it('sizes weekly/monthly fetch windows to server minimums', () => {
    assert.equal(computeStock2BarsFetchDays('1wk'), 730)
    assert.equal(computeStock2BarsFetchDays('1mo'), 1825)
  })

  it('minCalendarDaysForTradingBars inverts approximateTradingDays', () => {
    const calendar = minCalendarDaysForTradingBars(315)
    assert.ok(approximateTradingDays(calendar) >= 315)
  })
})
