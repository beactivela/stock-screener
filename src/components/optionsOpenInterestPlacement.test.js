import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import { URL } from 'node:url'

const stockDetail = fs.readFileSync(new URL('../pages/StockDetail.tsx', import.meta.url), 'utf8')
const tradingViewWidget = fs.readFileSync(new URL('./TradingViewWidget.tsx', import.meta.url), 'utf8')
const optionsOpenInterestRail = fs.readFileSync(new URL('./OptionsOpenInterestRail.tsx', import.meta.url), 'utf8')
const optionsStrategyVisualizer = fs.readFileSync(new URL('./OptionsStrategyVisualizer.tsx', import.meta.url), 'utf8')

describe('options open interest rail placement', () => {
  it('keeps the OI rail on the StockDetail lightweight chart (not embedded in TradingViewWidget)', () => {
    assert.ok(
      stockDetail.includes("import OptionsOpenInterestRail from '../components/OptionsOpenInterestRail'"),
      'StockDetail should own the OI rail next to the main chart',
    )
    assert.ok(
      stockDetail.includes("import OptionsStrategyVisualizer from '../components/OptionsStrategyVisualizer'"),
      'StockDetail should own the options strategy visualizer next to the OI rail',
    )
    assert.equal(
      tradingViewWidget.includes('OptionsOpenInterestRail'),
      false,
      'TradingViewWidget should not render the OI rail',
    )

    const firstChartIndex = stockDetail.indexOf('ref={chartContainerRef}')
    const railIndex = stockDetail.indexOf('<OptionsOpenInterestRail')
    const strategyIndex = stockDetail.indexOf('<OptionsStrategyVisualizer')
    const lowerTradingViewIndex = stockDetail.indexOf('TradingView Interactive Chart')

    assert.ok(firstChartIndex > 0, 'first chart container should exist')
    assert.ok(railIndex > firstChartIndex, 'OI rail should render after the first chart container')
    assert.ok(strategyIndex > railIndex, 'strategy visualizer should render immediately to the right of the OI rail')
    assert.ok(lowerTradingViewIndex > strategyIndex, 'strategy visualizer should render before the lower TradingView section')
    assert.ok(
      stockDetail.includes('const mainW = chartContainerRef.current?.clientWidth ?? 0'),
      'main chart width should come from chartContainerRef so it does not push the OI rail off-screen',
    )
    assert.ok(
      stockDetail.includes('xl:grid-cols-[minmax(0,1fr)_250px_300px]'),
      'chart stack should reserve desktop columns for the OI rail and strategy visualizer',
    )
    assert.ok(
      stockDetail.includes('const PRICE_CHART_HEIGHT = 600'),
      'main price chart should be 600px tall',
    )
    assert.ok(
      stockDetail.includes('height: PRICE_CHART_HEIGHT'),
      'lightweight price chart should use the shared 600px height constant',
    )
    assert.ok(
      stockDetail.includes('style={{ height: PRICE_CHART_HEIGHT }}'),
      'price chart container should use the shared 600px height constant',
    )
    assert.ok(
      stockDetail.includes('pricePaneHeight={PRICE_CHART_HEIGHT}'),
      'OI strike rows should use the same 600px price-pane scale',
    )
    assert.ok(
      stockDetail.includes('const PRICE_CHART_SCALE_MARGINS = { top: 0.12, bottom: 0.08 }'),
      'price chart and OI rail should share explicit scale margins',
    )
    assert.ok(
      stockDetail.includes('scaleMargins: PRICE_CHART_SCALE_MARGINS'),
      'lightweight price scale should use the same margins as the OI rail range',
    )
    assert.ok(
      stockDetail.includes('priceToCoordinate'),
      'StockDetail should use Lightweight Charts priceToCoordinate as the source of truth for OI row y positions',
    )
    assert.ok(
      stockDetail.includes('strikeCoordinates={optionStrikeCoordinates}'),
      'StockDetail should pass chart-derived strike coordinates into the OI rail',
    )
    assert.ok(
      stockDetail.includes('strategyKind={optionsStrategyKind}'),
      'StockDetail should pass strategy kind into the OI rail for put vs call chips',
    )
    assert.ok(
      stockDetail.includes('onStrategyKindChange'),
      'StockDetail should wire strategy dropdown changes from the visualizer',
    )
    assert.ok(
      stockDetail.includes('chooseDefaultExpiration(res?.expirations || [], selectedOptionsExpiration)'),
      'initial OI load should choose the frontend monthly default instead of preserving a weekly API default',
    )
    assert.ok(
      optionsOpenInterestRail.includes('strikeCoordinates'),
      'OI rail should accept chart-derived strike coordinates',
    )
    assert.ok(
      optionsOpenInterestRail.includes('style={{ height: pricePaneHeight }}'),
      'OI strike plot area should start at chart top and use the full price-pane height',
    )
    assert.ok(
      optionsOpenInterestRail.includes('Sell Put') && optionsOpenInterestRail.includes('Buy Put'),
      'strategy strike handles should render in the OI rail where strike/OI bars live',
    )
    assert.ok(
      optionsOpenInterestRail.includes('setPointerCapture'),
      'strategy strike handles should capture pointer movement for reliable dragging',
    )
    assert.equal(
      optionsStrategyVisualizer.includes('Sell Put') || optionsStrategyVisualizer.includes('Buy Put'),
      false,
      'strategy visualizer should keep risk metrics separate from draggable strike handles',
    )
    assert.equal(
      optionsOpenInterestRail.includes('pricePaneHeight - 83'),
      false,
      'OI strike plot area should not subtract header height because that breaks vertical price alignment',
    )
    assert.ok(
      stockDetail.includes('fullHeight={CHART_STACK_HEIGHT}'),
      'OI rail should visibly span the full chart stack height',
    )
    assert.ok(
      optionsStrategyVisualizer.includes('style={{ height: pricePaneHeight }}'),
      'strategy visualizer should use the same price-pane height for drag-handle alignment',
    )
    assert.ok(
      optionsStrategyVisualizer.includes('chartSpaceYToStrikeOverlayPx'),
      'strategy visualizer should reuse the OI rail strike-lane Y mapping so PCS graph aligns with strike rows',
    )
  })

  it('renders calls on the left and puts on the right of the strike column', () => {
    const callHeaderIndex = optionsOpenInterestRail.indexOf('<span>Call</span>')
    const strikeHeaderIndex = optionsOpenInterestRail.indexOf('<span className="text-center">Strike</span>')
    const putHeaderIndex = optionsOpenInterestRail.indexOf('<span className="text-right">Put</span>')

    assert.ok(callHeaderIndex > 0, 'Call header should exist')
    assert.ok(strikeHeaderIndex > callHeaderIndex, 'Strike header should render after Call')
    assert.ok(putHeaderIndex > strikeHeaderIndex, 'Put header should render after Strike')

    assert.match(
      optionsOpenInterestRail,
      /bg-emerald-500\/80[\s\S]*row\.callWidthPct[\s\S]*\{formatStrike\(row\.strike\)\}[\s\S]*bg-rose-500\/80[\s\S]*row\.putWidthPct/,
      'row markup should render green call bar, then strike, then red put bar',
    )
  })
})
