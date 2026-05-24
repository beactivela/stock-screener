import { useMemo } from 'react'

import {
  buildBearCallSpreadSlopedSegmentKnots,
  buildBearPutSpreadSlopedSegmentKnots,
  buildBullPutSpreadSlopedSegmentKnots,
  buildCashSecuredPutPayoffKnots,
  buildLongCallPayoffKnots,
  calculateBearCallSpreadMetrics,
  calculateBearPutSpreadMetrics,
  calculateCashSecuredPutMetrics,
  calculateLongCallMetrics,
  calculatePutCreditSpreadMetrics,
  estimateBearCallChanceOfProfit,
  estimateBearPutChanceOfProfit,
  estimateBullPutChanceOfProfit,
  estimateLongCallChanceOfProfit,
  splitPayoffCurveByProfit,
  mapSlopedSpreadScreenX,
  xForSymmetricPayoffPnL,
  buildLossFillPathBelowPolyline,
  pickOptionBid,
  pickOptionAsk,
  type PayoffPoint,
  type OptionQuoteInput,
  type BearCallSpreadMetrics,
  type BearPutSpreadMetrics,
  type CashSecuredPutMetrics,
  type PutCreditSpreadMetrics,
  type LongCallMetrics,
  type VisualizerStrategyId,
} from '../utils/optionsStrategy'
import {
  chartSpaceYToStrikeOverlayPx,
  type OptionsOpenInterestExpiration,
  type OptionsOpenInterestStrike,
} from '../utils/optionsOpenInterest'
import { resolveStrikeChartY, type StrikePriceBounds } from '../utils/optionStrikeChartSync'

interface OptionsStrategyVisualizerProps {
  layout?: 'inline' | 'stacked'
  putCreditSpreadLabel?: string
  strategyKind: VisualizerStrategyId
  onStrategyKindChange: (next: VisualizerStrategyId) => void
  selectedExpiration: OptionsOpenInterestExpiration | null
  strikes: OptionsOpenInterestStrike[]
  spot: number | null
  pricePaneHeight: number
  fullHeight: number
  belowPaneHeight?: number
  strikeCoordinates: Record<string, number>
  visiblePriceRange?: StrikePriceBounds | null
  priceMin: number | null
  priceMax: number | null
  shortStrike: number | null
  longStrike: number | null
}

function formatStrike(value: number | null | undefined): string {
  if (!Number.isFinite(value)) return '-'
  const n = Number(value)
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '')
}

function formatMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'n/a'
  const sign = value < 0 ? '-' : ''
  return `${sign}$${Math.abs(value).toLocaleString('en-US', {
    maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2,
  })}`
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'n/a'
  return `${Math.round(value * 100)}%`
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function yAlongPriceKnotPolyline(price: number, knots: Array<{ price: number; y: number }>): number | null {
  if (knots.length === 0) return null
  if (price <= knots[0].price) return knots[0].y
  const last = knots[knots.length - 1]
  if (price >= last.price) return last.y
  for (let i = 0; i < knots.length - 1; i += 1) {
    const a = knots[i]
    const b = knots[i + 1]
    if (price >= a.price && price <= b.price) {
      const span = b.price - a.price || 1e-9
      const t = (price - a.price) / span
      return a.y + t * (b.y - a.y)
    }
  }
  return null
}

function svgFmt(n: number): string {
  return n.toFixed(2)
}

/** Resolve loss-segment screen coords, then delegate to shared fill helper. */
function buildLossFillPathBelowStrip(
  points: PayoffPoint[],
  _xLeft: number,
  _xRight: number,
  paneH: number,
  _xForPnL: (pl: number) => number,
  yAt: (price: number) => number | null,
  screenAt?: (p: PayoffPoint) => { x: number; y: number } | null,
): string | null {
  const coords: Array<{ x: number; y: number }> = []
  for (const p of points) {
    const screen = screenAt?.(p)
    if (screen) {
      coords.push(screen)
      continue
    }
    const y = yAt(p.price)
    if (y == null) return null
    coords.push({ x: _xForPnL(p.profitLoss), y })
  }
  return buildLossFillPathBelowPolyline(coords, paneH)
}

/**
 * Closed path: region **above** the profit polyline (smaller SVG y).
 * Start on the green line, trace it, then close along y=0 between endpoints — avoids a full-strip
 * wedge (xRight,0)→(xRight,first.y) that read visually as “fill downward”.
 */
function buildProfitFillPathAboveStrip(
  points: PayoffPoint[],
  _xLeft: number,
  _xRight: number,
  xForPnL: (pl: number) => number,
  yAt: (price: number) => number | null,
  screenAt?: (p: PayoffPoint) => { x: number; y: number } | null,
): string | null {
  const coords: Array<{ x: number; y: number }> = []
  for (const p of points) {
    const screen = screenAt?.(p)
    if (screen) {
      coords.push(screen)
      continue
    }
    const y = yAt(p.price)
    if (y == null) return null
    coords.push({ x: xForPnL(p.profitLoss), y })
  }
  if (coords.length < 2) return null
  const first = coords[0]
  const last = coords[coords.length - 1]
  const parts = [`M ${svgFmt(first.x)} ${svgFmt(first.y)}`]
  for (let i = 1; i < coords.length; i += 1) {
    parts.push(`L ${svgFmt(coords[i].x)} ${svgFmt(coords[i].y)}`)
  }
  parts.push(`L ${svgFmt(last.x)} 0`, `L ${svgFmt(first.x)} 0`, 'Z')
  return parts.join(' ')
}

function toPutQuoteInput(row: OptionsOpenInterestStrike | undefined): OptionQuoteInput | null {
  if (!row?.putQuote) return null
  return {
    strike: row.strike,
    bid: row.putQuote.bid,
    ask: row.putQuote.ask,
    lastPrice: row.putQuote.lastPrice,
    impliedVolatility: row.putQuote.impliedVolatility,
  }
}

function toCallQuoteInput(row: OptionsOpenInterestStrike | undefined): OptionQuoteInput | null {
  if (!row?.callQuote) return null
  return {
    strike: row.strike,
    bid: row.callQuote.bid,
    ask: row.callQuote.ask,
    lastPrice: row.callQuote.lastPrice,
    impliedVolatility: row.callQuote.impliedVolatility,
  }
}

function getPutMid(row: OptionsOpenInterestStrike | undefined): number | null {
  return row?.putQuote?.mid ?? null
}

function getCallMid(row: OptionsOpenInterestStrike | undefined): number | null {
  return row?.callQuote?.mid ?? null
}

function getPutNaturalSell(row: OptionsOpenInterestStrike | undefined): number | null {
  if (!row?.putQuote) return null
  return pickOptionBid({
    strike: row.strike,
    bid: row.putQuote.bid,
    ask: row.putQuote.ask,
    lastPrice: row.putQuote.lastPrice,
  })
}

function getPutNaturalBuy(row: OptionsOpenInterestStrike | undefined): number | null {
  if (!row?.putQuote) return null
  return pickOptionAsk({
    strike: row.strike,
    bid: row.putQuote.bid,
    ask: row.putQuote.ask,
    lastPrice: row.putQuote.lastPrice,
  })
}

function getCallNaturalSell(row: OptionsOpenInterestStrike | undefined): number | null {
  if (!row?.callQuote) return null
  return pickOptionBid({
    strike: row.strike,
    bid: row.callQuote.bid,
    ask: row.callQuote.ask,
    lastPrice: row.callQuote.lastPrice,
  })
}

function getCallNaturalBuy(row: OptionsOpenInterestStrike | undefined): number | null {
  if (!row?.callQuote) return null
  return pickOptionAsk({
    strike: row.strike,
    bid: row.callQuote.bid,
    ask: row.callQuote.ask,
    lastPrice: row.callQuote.lastPrice,
  })
}

type ActiveMetrics =
  | { kind: 'put_credit_spread'; m: PutCreditSpreadMetrics }
  | { kind: 'bear_put_spread'; m: BearPutSpreadMetrics }
  | { kind: 'bear_call_spread'; m: BearCallSpreadMetrics }
  | { kind: 'long_call'; m: LongCallMetrics }
  | { kind: 'cash_secured_put'; m: CashSecuredPutMetrics }

export default function OptionsStrategyVisualizer({
  layout = 'inline',
  putCreditSpreadLabel = 'Put credit spread (PCS)',
  strategyKind,
  onStrategyKindChange,
  selectedExpiration,
  strikes,
  spot,
  pricePaneHeight,
  fullHeight,
  belowPaneHeight,
  strikeCoordinates,
  visiblePriceRange = null,
  priceMin,
  priceMax,
  shortStrike,
  longStrike,
}: OptionsStrategyVisualizerProps) {
  const fallbackPriceRange =
    priceMin != null && priceMax != null && priceMax > priceMin ? { min: priceMin, max: priceMax } : null

  const putRows = useMemo(
    () =>
      [...strikes]
        .filter((row) => {
          const m = getPutMid(row)
          return m != null && m > 0
        })
        .sort((a, b) => a.strike - b.strike),
    [strikes],
  )

  const callRows = useMemo(
    () =>
      [...strikes]
        .filter((row) => {
          const m = getCallMid(row)
          return m != null && m > 0
        })
        .sort((a, b) => a.strike - b.strike),
    [strikes],
  )

  const shortPutRow = putRows.find((row) => row.strike === shortStrike)
  const longPutRow = putRows.find((row) => row.strike === longStrike)
  const shortCallRow = callRows.find((row) => row.strike === shortStrike)
  const longCallRow = callRows.find((row) => row.strike === longStrike)

  const active = useMemo((): ActiveMetrics | null => {
    if (strategyKind === 'put_credit_spread') {
      const shortPut = toPutQuoteInput(shortPutRow)
      const longPut = toPutQuoteInput(longPutRow)
      if (!shortPut || !longPut) return null
      const m = calculatePutCreditSpreadMetrics({ shortPut, longPut })
      return m ? { kind: 'put_credit_spread', m } : null
    }
    if (strategyKind === 'bear_put_spread') {
      const shortPut = toPutQuoteInput(shortPutRow)
      const longPut = toPutQuoteInput(longPutRow)
      if (!shortPut || !longPut) return null
      const m = calculateBearPutSpreadMetrics({ shortPut, longPut })
      return m ? { kind: 'bear_put_spread', m } : null
    }
    if (strategyKind === 'bear_call_spread') {
      const shortCall = toCallQuoteInput(shortCallRow)
      const longCall = toCallQuoteInput(longCallRow)
      if (!shortCall || !longCall) return null
      const m = calculateBearCallSpreadMetrics({ shortCall, longCall })
      return m ? { kind: 'bear_call_spread', m } : null
    }
    if (strategyKind === 'cash_secured_put') {
      const shortPut = toPutQuoteInput(shortPutRow)
      if (!shortPut) return null
      const m = calculateCashSecuredPutMetrics({ shortPut, priceMin, priceMax })
      return m ? { kind: 'cash_secured_put', m } : null
    }
    const call = toCallQuoteInput(longCallRow)
    if (!call) return null
    const m = calculateLongCallMetrics({ call, priceMin, priceMax })
    return m ? { kind: 'long_call', m } : null
  }, [
    strategyKind,
    shortPutRow,
    longPutRow,
    shortCallRow,
    longCallRow,
    priceMin,
    priceMax,
  ])

  const averageIvPut =
    shortPutRow?.putQuote?.impliedVolatility != null && longPutRow?.putQuote?.impliedVolatility != null
      ? (shortPutRow.putQuote.impliedVolatility + longPutRow.putQuote.impliedVolatility) / 2
      : shortPutRow?.putQuote?.impliedVolatility ?? longPutRow?.putQuote?.impliedVolatility ?? null

  const averageIvCallSpread =
    shortCallRow?.callQuote?.impliedVolatility != null && longCallRow?.callQuote?.impliedVolatility != null
      ? (shortCallRow.callQuote.impliedVolatility + longCallRow.callQuote.impliedVolatility) / 2
      : shortCallRow?.callQuote?.impliedVolatility ?? longCallRow?.callQuote?.impliedVolatility ?? null

  const callIv = longCallRow?.callQuote?.impliedVolatility ?? null
  const cspPutIv = shortPutRow?.putQuote?.impliedVolatility ?? null

  const chanceOfProfit = useMemo(() => {
    if (!active || !selectedExpiration) return null
    if (active.kind === 'put_credit_spread' || active.kind === 'cash_secured_put') {
      return estimateBullPutChanceOfProfit({
        spot,
        breakEven: active.m.breakEven,
        impliedVolatility: active.kind === 'cash_secured_put' ? cspPutIv : averageIvPut,
        dte: selectedExpiration.dte,
      })
    }
    if (active.kind === 'bear_put_spread') {
      return estimateBearPutChanceOfProfit({
        spot,
        breakEven: active.m.breakEven,
        impliedVolatility: averageIvPut,
        dte: selectedExpiration.dte,
      })
    }
    if (active.kind === 'bear_call_spread') {
      return estimateBearCallChanceOfProfit({
        spot,
        breakEven: active.m.breakEven,
        impliedVolatility: averageIvCallSpread,
        dte: selectedExpiration.dte,
      })
    }
    if (active.kind === 'long_call') {
      return estimateLongCallChanceOfProfit({
        spot,
        threshold: active.m.breakEven,
        impliedVolatility: callIv,
        dte: selectedExpiration.dte,
      })
    }
    return null
  }, [
    active,
    selectedExpiration,
    spot,
    averageIvPut,
    averageIvCallSpread,
    callIv,
    cspPutIv,
  ])

  /** Same vertical scale as Options OI strike rows: compress chart Y into the lane below the header band. */
  const yForPrice = (price: number): number | null => {
    const chartY = resolveStrikeChartY({
      strike: price,
      pricePaneHeight,
      strikeCoordinates,
      visiblePriceRange,
      fallbackPriceRange,
    })
    if (chartY == null) return null
    return chartSpaceYToStrikeOverlayPx(chartY, pricePaneHeight)
  }

  /** Linear interpolation in chart Y between two strikes with `lowK < highK` (numeric strikes). */
  const yLineBetweenStrikesAsc = (price: number, lowK: number, highK: number): number | null => {
    const yLo = yForPrice(lowK)
    const yHi = yForPrice(highK)
    if (yLo != null && yHi != null && lowK !== highK) {
      const t = (price - lowK) / (highK - lowK)
      return clamp(yLo + t * (yHi - yLo), 0, pricePaneHeight)
    }
    if (!fallbackPriceRange) return null
    const chartY = clamp(
      ((fallbackPriceRange.max - price) / (fallbackPriceRange.max - fallbackPriceRange.min)) * pricePaneHeight,
      0,
      pricePaneHeight,
    )
    return chartSpaceYToStrikeOverlayPx(chartY, pricePaneHeight)
  }

  const yLinePutSpread = (price: number, m: PutCreditSpreadMetrics): number | null =>
    yLineBetweenStrikesAsc(price, m.longStrike, m.shortStrike)

  const longCallScreenKnots = useMemo(() => {
    if (active?.kind !== 'long_call') return null
    const prices = [...new Set(buildLongCallPayoffKnots(active.m).map((p) => p.price))].sort((a, b) => a - b)
    const knots: Array<{ price: number; y: number }> = []
    for (const price of prices) {
      const y = yForPrice(price)
      if (y == null) return null
      knots.push({ price, y })
    }
    return knots
  }, [active, strikeCoordinates, visiblePriceRange, fallbackPriceRange, pricePaneHeight])

  const cspScreenKnots = useMemo(() => {
    if (active?.kind !== 'cash_secured_put') return null
    const prices = [...new Set(buildCashSecuredPutPayoffKnots(active.m).map((p) => p.price))].sort((a, b) => a - b)
    const knots: Array<{ price: number; y: number }> = []
    for (const price of prices) {
      const y = yForPrice(price)
      if (y == null) return null
      knots.push({ price, y })
    }
    return knots
  }, [active, strikeCoordinates, visiblePriceRange, fallbackPriceRange, pricePaneHeight])

  // Graph spans left inset → metrics rail (300px column − 12px sides − 118px cards).
  const graphWidth = 300 - 12 - 118 - 12
  const xCenter = graphWidth / 2

  const maxLossVal =
    active == null
      ? 1
      : active.kind === 'cash_secured_put'
        ? Math.max(Math.abs(active.m.maxLossAtLow), active.m.maxProfit)
        : active.m.maxLoss
  const maxProfitVal =
    active == null ? 1 : active.kind === 'long_call' ? active.m.maxProfitAtCap : active.m.maxProfit

  const xForPnL = (profitLoss: number) =>
    active == null
      ? xCenter
      : clamp(
          xForSymmetricPayoffPnL(profitLoss, {
            maxLoss: maxLossVal,
            maxProfit: maxProfitVal,
            width: graphWidth,
          }),
          0,
          graphWidth,
        )

  /** Sloped leg: X linear in strike (straight 320P→390P line), Y aligned to chart price scale. */
  const verticalSpreadScreenAt = (
    price: number,
    lowStrike: number,
    highStrike: number,
  ): { x: number; y: number } | null => {
    const y = yLineBetweenStrikesAsc(price, lowStrike, highStrike)
    if (y == null) return null
    const x = mapSlopedSpreadScreenX(price, lowStrike, highStrike, 0, graphWidth)
    return { x, y }
  }


  const slopedKnots: PayoffPoint[] = useMemo(() => {
    if (active?.kind === 'put_credit_spread') {
      const m = active.m
      return buildBullPutSpreadSlopedSegmentKnots({
        longStrike: m.longStrike,
        shortStrike: m.shortStrike,
        breakEven: m.breakEven,
        maxLoss: m.maxLoss,
        maxProfit: m.maxProfit,
      })
    }
    if (active?.kind === 'bear_put_spread') {
      const m = active.m
      return buildBearPutSpreadSlopedSegmentKnots({
        shortStrike: m.shortStrike,
        longStrike: m.longStrike,
        breakEven: m.breakEven,
        maxLoss: m.maxLoss,
        maxProfit: m.maxProfit,
      })
    }
    if (active?.kind === 'bear_call_spread') {
      const m = active.m
      return buildBearCallSpreadSlopedSegmentKnots({
        shortStrike: m.shortStrike,
        longStrike: m.longStrike,
        breakEven: m.breakEven,
        maxLoss: m.maxLoss,
        maxProfit: m.maxProfit,
      })
    }
    if (active?.kind === 'long_call') return buildLongCallPayoffKnots(active.m)
    if (active?.kind === 'cash_secured_put') return buildCashSecuredPutPayoffKnots(active.m)
    return []
  }, [active])

  const curveSegments = splitPayoffCurveByProfit(slopedKnots)

  const yForPathPoint = (price: number): number | null => {
    if (active?.kind === 'put_credit_spread') return yLinePutSpread(price, active.m)
    if (active?.kind === 'bear_put_spread')
      return yLineBetweenStrikesAsc(price, active.m.shortStrike, active.m.longStrike)
    if (active?.kind === 'bear_call_spread')
      return yLineBetweenStrikesAsc(price, active.m.shortStrike, active.m.longStrike)
    if (active?.kind === 'long_call' && longCallScreenKnots) return yAlongPriceKnotPolyline(price, longCallScreenKnots)
    if (active?.kind === 'cash_secured_put' && cspScreenKnots) return yAlongPriceKnotPolyline(price, cspScreenKnots)
    return null
  }

  const payoffScreenAt = (point: PayoffPoint): { x: number; y: number } | null => {
    if (active?.kind === 'put_credit_spread') {
      const m = active.m
      return verticalSpreadScreenAt(point.price, m.longStrike, m.shortStrike)
    }
    if (active?.kind === 'bear_put_spread') {
      const m = active.m
      return verticalSpreadScreenAt(point.price, m.shortStrike, m.longStrike)
    }
    if (active?.kind === 'bear_call_spread') {
      const m = active.m
      return verticalSpreadScreenAt(point.price, m.shortStrike, m.longStrike)
    }
    const y = yForPathPoint(point.price)
    if (y == null) return null
    return { x: xForPnL(point.profitLoss), y }
  }

  const pathForSegment = (points: PayoffPoint[]) =>
    points
      .map((point, index) => {
        const screen = payoffScreenAt(point)
        if (screen == null) return null
        return `${index === 0 ? 'M' : 'L'} ${screen.x.toFixed(2)} ${screen.y.toFixed(2)}`
      })
      .filter(Boolean)
      .join(' ')

  const lossPath = pathForSegment(curveSegments.loss)
  const profitPath = pathForSegment(curveSegments.profit)

  const lossFillPath =
    curveSegments.loss.length >= 2
      ? buildLossFillPathBelowStrip(
          curveSegments.loss,
          0,
          xCenter,
          pricePaneHeight,
          xForPnL,
          yForPathPoint,
          payoffScreenAt,
        )
      : null
  const profitFillPath =
    curveSegments.profit.length >= 2
      ? buildProfitFillPathAboveStrip(
          curveSegments.profit,
          xCenter,
          graphWidth,
          xForPnL,
          yForPathPoint,
          payoffScreenAt,
        )
      : null

  const breakEvenY =
    active?.kind === 'put_credit_spread'
      ? yLinePutSpread(active.m.breakEven, active.m) ?? yForPrice(active.m.breakEven)
      : active?.kind === 'bear_put_spread' || active?.kind === 'bear_call_spread'
        ? yLineBetweenStrikesAsc(active.m.breakEven, active.m.shortStrike, active.m.longStrike) ??
          yForPrice(active.m.breakEven)
        : active?.kind === 'long_call' && longCallScreenKnots
          ? yAlongPriceKnotPolyline(active.m.breakEven, longCallScreenKnots) ?? yForPrice(active.m.breakEven)
          : active?.kind === 'cash_secured_put' && cspScreenKnots
            ? yAlongPriceKnotPolyline(active.m.breakEven, cspScreenKnots) ?? yForPrice(active.m.breakEven)
            : null

  const breakEvenScreen =
    active != null && breakEvenY != null && 'breakEven' in active.m
      ? payoffScreenAt({ price: active.m.breakEven, profitLoss: 0 })
      : null

  const subtitleLabel =
    strategyKind === 'put_credit_spread'
      ? shortStrike != null && longStrike != null && shortStrike > longStrike
        ? `${formatStrike(longStrike)}P / ${formatStrike(shortStrike)}P`
        : 'No spread'
      : strategyKind === 'bear_put_spread'
        ? shortStrike != null && longStrike != null && longStrike > shortStrike
          ? `${formatStrike(shortStrike)}P / ${formatStrike(longStrike)}P`
          : 'No spread'
        : strategyKind === 'bear_call_spread'
          ? shortStrike != null && longStrike != null && longStrike > shortStrike
            ? `${formatStrike(shortStrike)}C / ${formatStrike(longStrike)}C`
            : 'No spread'
          : strategyKind === 'cash_secured_put'
            ? shortStrike != null
              ? `${formatStrike(shortStrike)}P (short)`
              : 'No strike'
            : longStrike != null
              ? `${formatStrike(longStrike)}C`
              : 'No strike'

  const strategyTitle =
    strategyKind === 'put_credit_spread'
      ? putCreditSpreadLabel
      : strategyKind === 'bear_put_spread'
        ? 'Bear put spread'
        : strategyKind === 'bear_call_spread'
          ? 'Bear call spread'
          : strategyKind === 'cash_secured_put'
            ? 'Cash secured put'
            : 'Long call'

  const metricsCards = useMemo(() => {
    if (active?.kind === 'put_credit_spread') {
      const m = active.m
      return [
        ['Net Credit', formatMoney(m.netCredit * m.contractMultiplier)],
        ['Est Margin', formatMoney(m.estimatedMargin)],
        ['Max Profit', formatMoney(m.maxProfit)],
        ['Max Loss', formatMoney(m.maxLoss)],
        ['Break Even', `$${formatStrike(m.breakEven)}`, `short − ${formatMoney(m.netCredit)}/sh`],
        ['Chance Profit', formatPercent(chanceOfProfit)],
      ] as const
    }
    if (active?.kind === 'bear_put_spread') {
      const m = active.m
      return [
        ['Net Debit', formatMoney(m.netDebit * m.contractMultiplier)],
        ['Max Profit', formatMoney(m.maxProfit)],
        ['Max Loss', formatMoney(m.maxLoss)],
        ['Width', `$${formatStrike(m.width)}`],
        ['Break Even', `$${formatStrike(m.breakEven)}`, `long − ${formatMoney(m.netDebit)}/sh`],
        ['Chance Profit', formatPercent(chanceOfProfit)],
      ] as const
    }
    if (active?.kind === 'bear_call_spread') {
      const m = active.m
      return [
        ['Net Credit', formatMoney(m.netCredit * m.contractMultiplier)],
        ['Est Margin', formatMoney(m.estimatedMargin)],
        ['Max Profit', formatMoney(m.maxProfit)],
        ['Max Loss', formatMoney(m.maxLoss)],
        ['Break Even', `$${formatStrike(m.breakEven)}`, `short + ${formatMoney(m.netCredit)}/sh`],
        ['Chance Profit', formatPercent(chanceOfProfit)],
      ] as const
    }
    if (active?.kind === 'cash_secured_put') {
      const m = active.m
      return [
        ['Premium', formatMoney(m.premium * m.contractMultiplier)],
        ['Est Cash Secured', formatMoney(m.estimatedMargin)],
        ['Max Profit', formatMoney(m.maxProfit)],
        ['Max Loss (diagram)', formatMoney(m.maxLossAtLow)],
        ['Break Even', `$${formatStrike(m.breakEven)}`, `strike − ${formatMoney(m.premium)}/sh`],
        ['Chance Profit', formatPercent(chanceOfProfit)],
      ] as const
    }
    if (active?.kind === 'long_call') {
      const m = active.m
      return [
        ['Premium', formatMoney(m.premium * m.contractMultiplier)],
        ['Max Loss', formatMoney(m.maxLoss)],
        ['Max Profit (cap)', formatMoney(m.maxProfitAtCap)],
        ['Diagram cap', `$${formatStrike(m.diagramPriceHigh)}`],
        ['Break Even', `$${formatStrike(m.breakEven)}`, `strike + ${formatMoney(m.premium)}/sh`],
        ['Chance Profit', formatPercent(chanceOfProfit)],
      ] as const
    }
    return []
  }, [active, chanceOfProfit])

  const footerLine =
    strategyKind === 'put_credit_spread' || strategyKind === 'bear_put_spread'
      ? `Short leg: ${formatMoney(getPutNaturalSell(shortPutRow))} · Long leg: ${formatMoney(getPutNaturalBuy(longPutRow))}`
      : strategyKind === 'bear_call_spread'
        ? `Short call: ${formatMoney(getCallNaturalSell(shortCallRow))} · Long call: ${formatMoney(getCallNaturalBuy(longCallRow))}`
        : strategyKind === 'cash_secured_put'
          ? `Put premium: ${formatMoney(getPutNaturalSell(shortPutRow))}`
          : `Call premium: ${formatMoney(getCallNaturalBuy(longCallRow))}`

  const emptyMessage =
    strategyKind === 'put_credit_spread' || strategyKind === 'bear_put_spread'
      ? 'Need two put strikes with live bid/ask data (drag chips in OI rail).'
      : strategyKind === 'bear_call_spread'
        ? 'Need two call strikes with live bid/ask (sell lower / buy higher).'
        : strategyKind === 'cash_secured_put'
          ? 'Need a put strike with live bid/ask (drag chip in OI rail).'
          : 'Need a call strike with live bid/ask and open interest (drag chip in OI rail).'

  const visualizerClassName =
    layout === 'stacked'
      ? 'flex h-full max-h-full w-full flex-col overflow-hidden border-t border-slate-800 bg-slate-950/95 text-xs text-slate-300 xl:border-l-0'
      : 'hidden w-[300px] self-stretch border-l border-slate-800 bg-slate-950/95 text-xs text-slate-300 xl:flex xl:h-full xl:max-h-full xl:flex-col xl:overflow-hidden'

  const belowLaneHeight = belowPaneHeight ?? Math.max(0, fullHeight - pricePaneHeight)

  return (
    <aside
      className={visualizerClassName}
      style={{ height: fullHeight, maxHeight: fullHeight }}
      aria-label="Options strategy visualizer"
    >
      <div className="relative shrink-0 overflow-hidden border-b border-slate-800" style={{ height: pricePaneHeight }}>
        <div className="absolute inset-x-0 top-0 z-20 border-b border-slate-800 bg-slate-950/95 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <label className="sr-only" htmlFor="options-strategy-kind">
              Strategy
            </label>
            <select
              id="options-strategy-kind"
              className="max-w-[200px] rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[11px] font-semibold text-slate-100 outline-none focus:border-cyan-500"
              value={strategyKind}
              onChange={(e) => onStrategyKindChange(e.target.value as VisualizerStrategyId)}
            >
              <option value="put_credit_spread">{putCreditSpreadLabel}</option>
              <option value="bear_put_spread">Bear put spread</option>
              <option value="bear_call_spread">Bear call spread</option>
              <option value="long_call">Long call</option>
              <option value="cash_secured_put">Cash secured put</option>
            </select>
            <span className="shrink-0 text-[10px] text-slate-500">{selectedExpiration ? `${selectedExpiration.dte}D` : 'No exp'}</span>
          </div>
          <div className="mt-1 text-[10px] text-slate-500">
            {strategyTitle} · {subtitleLabel} · drag chips in OI rail
          </div>
        </div>

        {active &&
        (active.kind === 'put_credit_spread' ||
          active.kind === 'bear_put_spread' ||
          active.kind === 'bear_call_spread' ||
          (active.kind === 'long_call' && longCallScreenKnots) ||
          (active.kind === 'cash_secured_put' && cspScreenKnots)) ? (
          <>
            <svg
              className="absolute left-3 top-0"
              width={graphWidth}
              height={pricePaneHeight}
              viewBox={`0 0 ${graphWidth} ${pricePaneHeight}`}
              role="img"
              aria-label={`${strategyTitle} risk profile`}
            >
              {lossFillPath && <path d={lossFillPath} fill="rgba(244, 63, 94, 0.2)" stroke="none" />}
              {profitFillPath && <path d={profitFillPath} fill="rgba(16, 185, 129, 0.18)" stroke="none" />}
              {breakEvenY != null && (
                <line x1="0" x2={graphWidth} y1={breakEvenY} y2={breakEvenY} stroke="rgba(96, 165, 250, 0.75)" strokeDasharray="4 4" />
              )}
              {breakEvenY != null && (
                <circle
                  cx={breakEvenScreen?.x ?? xCenter}
                  cy={breakEvenY}
                  r={4}
                  fill="rgba(15, 23, 42, 0.9)"
                  stroke="rgba(148, 163, 184, 0.95)"
                  strokeWidth="1.5"
                />
              )}
              {lossPath && <path d={lossPath} fill="none" stroke="rgb(244, 63, 94)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
              {profitPath && <path d={profitPath} fill="none" stroke="rgb(34, 197, 94)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
            </svg>

            <div className="absolute right-3 top-20 z-10 w-[118px] space-y-1.5">
              {metricsCards.map((row) => {
                const [label, value, hint] = row.length === 3 ? row : [...row, undefined]
                return (
                  <div key={label} className="rounded border border-slate-800 bg-slate-900/90 px-2 py-1 shadow-sm">
                    <div className="text-[9px] uppercase tracking-wide text-slate-500">{label}</div>
                    <div className="font-mono text-[12px] font-semibold text-slate-100">{value}</div>
                    {hint != null && <div className="mt-0.5 text-[9px] leading-tight text-slate-500">{hint}</div>}
                  </div>
                )
              })}
            </div>

            <div className="absolute inset-x-0 bottom-0 z-20 border-t border-slate-800/80 bg-slate-950/90 px-3 py-2 text-[11px] text-slate-500">
              {footerLine}
            </div>
          </>
        ) : (
          <div className="absolute inset-x-0 top-20 px-3 text-slate-500">
            {active?.kind === 'long_call' && !longCallScreenKnots
              ? 'Could not align payoff to chart strikes.'
              : active?.kind === 'cash_secured_put' && !cspScreenKnots
                ? 'Could not align payoff to chart strikes.'
                : emptyMessage}
          </div>
        )}
      </div>
      {belowLaneHeight > 0 ? (
        <div
          className="shrink-0 border-t border-slate-800 bg-slate-950/80"
          style={{ height: belowLaneHeight }}
          aria-hidden="true"
        />
      ) : null}
    </aside>
  )
}
