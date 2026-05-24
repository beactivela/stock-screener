import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import { URL } from 'node:url'

const appTsx = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
const stockDetail = fs.readFileSync(new URL('../pages/StockDetail.tsx', import.meta.url), 'utf8')
const layout = fs.readFileSync(new URL('../components/Layout.tsx', import.meta.url), 'utf8')

describe('stock chart placement', () => {
  it('registers /stock/:ticker inside the main Layout shell', () => {
    assert.ok(appTsx.includes('path="/stock/:ticker"'), 'App should register /stock/:ticker')
    assert.ok(appTsx.includes('StockDetail'), 'App should lazy-load StockDetail')
    assert.ok(appTsx.includes('<Route element={<Layout />}>'))
    assert.ok(appTsx.includes('path="/stock2/:ticker"'), 'App should redirect legacy /stock2 links')
    assert.ok(appTsx.includes('Stock2Redirect'))
  })

  it('Layout uses full-bleed main for stock chart pages', () => {
    assert.ok(layout.includes('isStockChartPage'))
    assert.ok(layout.includes('/^\\/stock\\/[^/]+/'))
    assert.ok(layout.includes('overflow-hidden'))
  })

  it('mounts OI rail and strategy visualizer on the lightweight chart in StockDetail', () => {
    assert.ok(stockDetail.includes("import OptionsOpenInterestRail from '../components/OptionsOpenInterestRail'"))
    assert.ok(stockDetail.includes("import OptionsStrategyVisualizer from '../components/OptionsStrategyVisualizer'"))
    assert.ok(stockDetail.includes('ref={chartContainerRef}'))
    assert.ok(stockDetail.includes('<OptionsOpenInterestRail'))
    assert.ok(stockDetail.includes('<OptionsStrategyVisualizer'))
    assert.ok(stockDetail.includes('priceToCoordinate'))
    assert.ok(stockDetail.includes('buildVisiblePriceRangeFromChart'))
    assert.ok(stockDetail.includes('visiblePriceRange={visiblePriceRange}'))
    assert.ok(stockDetail.includes('strikeCoordinates={optionStrikeCoordinates}'))
    assert.ok(stockDetail.includes('xl:grid-cols-[minmax(0,1fr)_250px_300px]'))
    assert.ok(stockDetail.includes('chartContainerRef'))
    assert.ok(stockDetail.includes("priceScaleId: 'right'"))
  })

  it('updates strategy price lines without forcing chart re-creation', () => {
    assert.ok(stockDetail.includes('syncStrategyPriceLines'))
    assert.ok(stockDetail.includes('candleSeriesRef'))
    assert.ok(stockDetail.includes('strategyPriceLinesRef'))
  })

  it('syncs chart URL state on /stock/:ticker', () => {
    assert.ok(stockDetail.includes('navigate(`/stock/${ticker}?'))
    assert.ok(stockDetail.includes('parseStock2SearchParams'))
  })

  it('Layout renders nested routes via Outlet', () => {
    assert.ok(layout.includes('Outlet'))
    assert.equal(layout.includes('{children}'), false)
  })
})
