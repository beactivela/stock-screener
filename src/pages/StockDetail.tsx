import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { CandlestickSeries, ColorType, createChart, HistogramSeries, LineSeries } from 'lightweight-charts'
import type { IChartApi, IPriceLine, ISeriesApi } from 'lightweight-charts'

import OptionsOpenInterestRail from '../components/OptionsOpenInterestRail'
import OptionsStrategyVisualizer from '../components/OptionsStrategyVisualizer'
import { API_BASE } from '../utils/api'
import { type Bar, buildPaddedIndicatorSeries, ema, rsi, sma } from '../utils/chartIndicators'
import {
  buildEmaDistanceOverlayLayout,
  emaDistanceOverlayColor,
  formatEmaDistancePercent,
  priceEmaDistancePercent,
  type EmaDistanceOverlayLayout,
} from '../utils/stock2EmaDistance'
import {
  chooseDefaultExpiration,
  type OptionsOpenInterestExpiration,
  type OptionsOpenInterestStrike,
} from '../utils/optionsOpenInterest'
import { type VisualizerStrategyId } from '../utils/optionsStrategy'
import {
  buildOiStrikeAnchorSeriesData,
  buildStrikeCoordinateMap,
  buildVisiblePriceRangeFromChart,
  createOiStrikeAutoscaleInfoProvider,
  strikePriceBounds,
} from '../utils/optionStrikeChartSync'
import {
  computeStock2GridHeightFromViewport,
  computeStock2PricePaneHeight,
  computeStock2StackHeight,
  computeStock2BarsFetchDays,
  EMA315_PERIOD,
  STOCK2_RSI_BLOCK_HEIGHT_PX,
  STOCK2_TOOLBAR_HEIGHT_PX,
} from '../utils/stock2ChartLayout'
import {
  buildStock2SearchParams,
  DEFAULT_EMA_PERIOD_1,
  DEFAULT_EMA_PERIOD_2,
  MAX_EMA_PERIOD,
  MIN_EMA_PERIOD,
  parseEmaPeriod,
  parseStock2SearchParams,
  type Stock2Interval,
} from '../utils/stock2UrlState'

interface GammaLevel {
  strike: number
  netGammaUsd: number
}

interface OptionsGammaResponse {
  ok: boolean
  ticker: string
  spot: number | null
  regime: 'long_gamma' | 'short_gamma' | 'neutral'
  topLevels: GammaLevel[]
  message?: string | null
}

interface OptionsOpenInterestResponse {
  ok: boolean
  ticker: string
  spot: number | null
  selectedExpiration: string | null
  expirations: OptionsOpenInterestExpiration[]
  strikes: OptionsOpenInterestStrike[]
  message?: string | null
}

const EMPTY_EMA_DISTANCE_OVERLAY: EmaDistanceOverlayLayout = {
  x: null,
  topY: null,
  bottomY: null,
  priceY: null,
  emaY: null,
  labelY: null,
  distancePct: null,
  visible: false,
}

const PRICE_CHART_SCALE_MARGINS = { top: 0.12, bottom: 0.08 }
const PRICE_AXIS_MIN_WIDTH = 72
const MA200_PERIOD = 200
const CHART_COLOR_MA200 = '#3b82f6'
const CHART_COLOR_EMA1 = '#22c55e'
const CHART_COLOR_EMA2 = '#eab308'
const CHART_COLOR_EMA315 = '#a855f7'

const VISIBLE_BAR_COUNT: Record<Stock2Interval, number> = {
  '1d': 120,
  '1wk': 52,
  '1mo': 24,
}

const INTERVALS: { label: string; value: Stock2Interval; url: string }[] = [
  { label: '1D', value: '1d', url: '1D' },
  { label: '1W', value: '1wk', url: '1W' },
  { label: '1M', value: '1mo', url: '1M' },
]

const CHART_OPTIONS = {
  layout: { background: { type: ColorType.Solid, color: '#0f172a' }, textColor: '#94a3b8' },
  grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
  timeScale: { timeVisible: true, secondsVisible: false },
  rightPriceScale: { borderColor: '#334155' },
}

function dedupeByTime<T extends { time: string | number }>(arr: T[]): T[] {
  const sorted = [...arr].sort((a, b) => (a.time as number) - (b.time as number))
  return sorted.reduce<T[]>((acc, d) => {
    const t = d.time as number
    if (acc.length === 0 || (acc[acc.length - 1].time as number) < t) acc.push(d)
    else if ((acc[acc.length - 1].time as number) === t) acc[acc.length - 1] = d
    return acc
  }, [])
}

function formatSpot(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function regimeLabel(regime: 'long_gamma' | 'short_gamma' | 'neutral' | null): string | null {
  if (regime === 'long_gamma') return 'Long γ'
  if (regime === 'short_gamma') return 'Short γ'
  if (regime === 'neutral') return 'Neutral γ'
  return null
}

export default function StockDetail() {
  const { ticker } = useParams<{ ticker: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const symbol = (ticker || '').toUpperCase()

  const urlState = useMemo(() => parseStock2SearchParams(searchParams), [searchParams])

  const [bars, setBars] = useState<Bar[]>([])
  const [loading, setLoading] = useState(true)
  const [interval, setInterval] = useState<Stock2Interval>(urlState.interval)
  const [showIndicators, setShowIndicators] = useState(urlState.indicators)
  const [showEmaDistance, setShowEmaDistance] = useState(urlState.emaDistance)
  const [emaPeriod1, setEmaPeriod1] = useState(urlState.ema1)
  const [emaPeriod2, setEmaPeriod2] = useState(urlState.ema2)
  const [optionsGamma, setOptionsGamma] = useState<OptionsGammaResponse | null>(null)
  const [optionsOpenInterest, setOptionsOpenInterest] = useState<OptionsOpenInterestResponse | null>(null)
  const [optionsOpenInterestLoading, setOptionsOpenInterestLoading] = useState(false)
  const [selectedOptionsExpiration, setSelectedOptionsExpiration] = useState<string | null>(urlState.expiration)
  const [optionStrikeCoordinates, setOptionStrikeCoordinates] = useState<Record<string, number>>({})
  const [visiblePriceRange, setVisiblePriceRange] = useState<{ min: number; max: number } | null>(null)
  const [optionsStrategyKind, setOptionsStrategyKind] = useState<VisualizerStrategyId>(urlState.strategy)
  const [selectedOptionsSpread, setSelectedOptionsSpread] = useState<{
    shortStrike: number | null
    longStrike: number | null
  }>({
    shortStrike: urlState.trades?.shortStrike ?? null,
    longStrike: urlState.trades?.longStrike ?? null,
  })
  const [pricePaneHeight, setPricePaneHeight] = useState(600)
  const [emaDistanceOverlay, setEmaDistanceOverlay] = useState<EmaDistanceOverlayLayout>(EMPTY_EMA_DISTANCE_OVERLAY)

  const chartContainerRef = useRef<HTMLDivElement>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const chartInstance = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const strategyPriceLinesRef = useRef<IPriceLine[]>([])
  const chartOverlaySyncRef = useRef<(() => void) | null>(null)
  const showEmaDistanceRef = useRef(showEmaDistance)
  // Ref so closures inside the chart effect always see the latest pricePaneHeight
  const pricePaneHeightRef = useRef(pricePaneHeight)
  const emaOverlayInputsRef = useRef<{
    candleData: Array<{ time: number; close: number }>
    ma200Data: Array<{ time: number; value: number }>
  }>({ candleData: [], ma200Data: [] })

  const stackHeight = computeStock2StackHeight(pricePaneHeight, showIndicators)
  const sideColumnBelowPaneHeight = Math.max(0, stackHeight - pricePaneHeight)

  // Keep pricePaneHeightRef current so the strike-coordinate closure is always accurate
  useEffect(() => {
    pricePaneHeightRef.current = pricePaneHeight
  }, [pricePaneHeight])

  useEffect(() => {
    showEmaDistanceRef.current = showEmaDistance
  }, [showEmaDistance])

  // Update the main pane height when pricePaneHeight changes — no full chart recreation needed.
  // autoSize keeps the chart width filled; pane setHeight() adjusts the internal Y split.
  useEffect(() => {
    const chart = chartInstance.current
    if (!chart) return
    const panes = chart.panes()
    if (panes[0]) panes[0].setHeight(pricePaneHeight)
  }, [pricePaneHeight])

  const pushUrl = useCallback(
    (patch: {
      expiration?: string | null
      strategy?: VisualizerStrategyId
      interval?: Stock2Interval
      indicators?: boolean
      emaDistance?: boolean
      ema1?: number
      ema2?: number
      shortStrike?: number | null
      longStrike?: number | null
    }) => {
      if (!ticker) return
      const next = buildStock2SearchParams({
        expiration: patch.expiration !== undefined ? patch.expiration : selectedOptionsExpiration,
        strategy: patch.strategy ?? optionsStrategyKind,
        interval: patch.interval ?? interval,
        indicators: patch.indicators ?? showIndicators,
        emaDistance: patch.emaDistance ?? showEmaDistance,
        ema1: patch.ema1 ?? emaPeriod1,
        ema2: patch.ema2 ?? emaPeriod2,
        shortStrike: patch.shortStrike !== undefined ? patch.shortStrike : selectedOptionsSpread.shortStrike,
        longStrike: patch.longStrike !== undefined ? patch.longStrike : selectedOptionsSpread.longStrike,
        axisOverlay: 'OpenInterest',
        commission: urlState.commission ?? '0.00',
      })
      navigate(`/stock/${ticker}?${next.toString()}`, { replace: true })
    },
    [
      ticker,
      navigate,
      selectedOptionsExpiration,
      optionsStrategyKind,
      interval,
      showIndicators,
      showEmaDistance,
      emaPeriod1,
      emaPeriod2,
      selectedOptionsSpread,
      urlState.commission,
    ],
  )

  const commitEmaPeriod = useCallback(
    (which: 1 | 2, raw: string) => {
      const fallback = which === 1 ? DEFAULT_EMA_PERIOD_1 : DEFAULT_EMA_PERIOD_2
      const next = parseEmaPeriod(raw, fallback)
      if (which === 1) {
        setEmaPeriod1(next)
        pushUrl({ ema1: next })
      } else {
        setEmaPeriod2(next)
        pushUrl({ ema2: next })
      }
    },
    [pushUrl],
  )

  const syncStrategyPriceLines = useCallback(() => {
    const candle = candleSeriesRef.current
    if (!candle) return

    for (const line of strategyPriceLinesRef.current) {
      candle.removePriceLine(line)
    }
    strategyPriceLinesRef.current = []
  }, [])

  useEffect(() => {
    const parsed = parseStock2SearchParams(searchParams)
    setInterval(parsed.interval)
    setShowIndicators(parsed.indicators)
    setShowEmaDistance(parsed.emaDistance)
    setEmaPeriod1(parsed.ema1)
    setEmaPeriod2(parsed.ema2)
    setOptionsStrategyKind(parsed.strategy)
    if (parsed.expiration) setSelectedOptionsExpiration(parsed.expiration)
    if (parsed.trades) {
      setSelectedOptionsSpread({
        shortStrike: parsed.trades.shortStrike,
        longStrike: parsed.trades.longStrike,
      })
    }
  }, [searchParams])

  // Workspace height → pricePaneHeight state (drives both chart container CSS and pane heights)
  useEffect(() => {
    const measure = () => {
      const rawWorkspaceHeight = workspaceRef.current?.clientHeight ?? 0
      const workspaceHeight =
        rawWorkspaceHeight > STOCK2_TOOLBAR_HEIGHT_PX && rawWorkspaceHeight < 10000
          ? rawWorkspaceHeight
          : 0
      const gridHeight =
        workspaceHeight > STOCK2_TOOLBAR_HEIGHT_PX
          ? workspaceHeight - STOCK2_TOOLBAR_HEIGHT_PX
          : computeStock2GridHeightFromViewport(window.innerHeight)
      const nextHeight = computeStock2PricePaneHeight({ gridHeight, showIndicators })
      setPricePaneHeight((prev) => (prev === nextHeight ? prev : nextHeight))
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (workspaceRef.current) ro.observe(workspaceRef.current)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [showIndicators])

  useEffect(() => {
    if (!ticker) return
    let cancelled = false
    setLoading(true)
    fetch(
      `${API_BASE}/api/bars/${encodeURIComponent(ticker)}?days=${computeStock2BarsFetchDays(interval)}&interval=${interval}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return
        if (data?.results?.length) {
          setBars([...data.results].sort((a: Bar, b: Bar) => a.t - b.t))
        } else {
          setBars([])
        }
      })
      .catch(() => {
        if (!cancelled) setBars([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [ticker, interval])

  useEffect(() => {
    if (!ticker) return
    let cancelled = false
    fetch(`${API_BASE}/api/options-gamma/${encodeURIComponent(ticker)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((res: OptionsGammaResponse | null) => {
        if (!cancelled && res) {
          setOptionsGamma(res)
        }
      })
      .catch(() => {
        if (!cancelled) setOptionsGamma(null)
      })
    return () => {
      cancelled = true
    }
  }, [ticker])

  useEffect(() => {
    if (!ticker) return
    let cancelled = false
    setOptionsOpenInterestLoading(true)
    const optionsParams = new URLSearchParams({ quotes: '1' })
    if (selectedOptionsExpiration) optionsParams.set('expiration', selectedOptionsExpiration)
    fetch(`${API_BASE}/api/options-open-interest/${encodeURIComponent(ticker)}?${optionsParams.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((res: OptionsOpenInterestResponse | null) => {
        if (cancelled) return
        setOptionsOpenInterest(res)
        const nextSelected = chooseDefaultExpiration(res?.expirations || [], selectedOptionsExpiration)
        setSelectedOptionsExpiration(nextSelected)
      })
      .catch(() => {
        if (!cancelled) {
          setOptionsOpenInterest({
            ok: false,
            ticker,
            spot: null,
            selectedExpiration: selectedOptionsExpiration,
            expirations: [],
            strikes: [],
            message: 'No useful open interest data',
          })
        }
      })
      .finally(() => {
        if (!cancelled) setOptionsOpenInterestLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [ticker, selectedOptionsExpiration, optionsGamma?.spot])

  useEffect(() => {
    setSelectedOptionsExpiration(null)
    setOptionsOpenInterest(null)
    setSelectedOptionsSpread({ shortStrike: null, longStrike: null })
  }, [ticker])

  const selectedOptionsExpirationMeta = useMemo(() => {
    const selected = selectedOptionsExpiration || optionsOpenInterest?.selectedExpiration || null
    return optionsOpenInterest?.expirations.find((expiration) => expiration.date === selected) || null
  }, [optionsOpenInterest?.expirations, optionsOpenInterest?.selectedExpiration, selectedOptionsExpiration])

  const { candleData, ema1Data, ema2Data, ema315Data, ma200Data, volumeData, rsiData } = useMemo(() => {
    const empty = {
      candleData: [] as Array<{ time: number; open: number; high: number; low: number; close: number }>,
      ema1Data: [] as Array<{ time: number; value: number }>,
      ema2Data: [] as Array<{ time: number; value: number }>,
      ema315Data: [] as Array<{ time: number; value: number }>,
      ma200Data: [] as Array<{ time: number; value: number }>,
      volumeData: [] as Array<{ time: number; value: number; color: string }>,
      rsiData: [] as Array<{ time: number; value: number }>,
    }
    if (bars.length === 0) return empty
    const sorted = [...bars].sort((a, b) => a.t - b.t)
    const closes = sorted.map((b) => Number(b.c) || 0)
    const emaSeries1 = ema(closes, emaPeriod1)
    const emaSeries2 = ema(closes, emaPeriod2)
    const emaSeries315 = ema(closes, EMA315_PERIOD)
    const ma200Series = sma(closes, MA200_PERIOD)
    const rsi14 = rsi(closes, 14)
    const toTime = (t: number) => Math.floor(t / 1000)
    return {
      candleData: sorted.map((b) => ({ time: toTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c })),
      ema1Data: sorted.map((b, i) => ({ time: toTime(b.t), value: emaSeries1[i]! })).filter((d) => d.value != null),
      ema2Data: sorted.map((b, i) => ({ time: toTime(b.t), value: emaSeries2[i]! })).filter((d) => d.value != null),
      ema315Data: sorted.map((b, i) => ({ time: toTime(b.t), value: emaSeries315[i]! })).filter((d) => d.value != null),
      ma200Data: sorted.map((b, i) => ({ time: toTime(b.t), value: ma200Series[i]! })).filter((d) => d.value != null),
      volumeData: sorted.map((b) => ({
        time: toTime(b.t),
        value: b.v,
        color: b.c >= b.o ? '#22c55e' : '#ef4444',
      })),
      rsiData: buildPaddedIndicatorSeries(sorted, rsi14, toTime),
    }
  }, [bars, emaPeriod1, emaPeriod2])

  const ma200DistancePct = useMemo(() => {
    if (candleData.length === 0 || ma200Data.length === 0) return null
    const lastClose = candleData[candleData.length - 1]?.close
    const lastMa = ma200Data[ma200Data.length - 1]?.value
    return priceEmaDistancePercent(lastClose, lastMa)
  }, [candleData, ma200Data])

  useEffect(() => {
    emaOverlayInputsRef.current = { candleData, ma200Data }
  }, [candleData, ma200Data])

  useEffect(() => {
    if (!showEmaDistance) {
      setEmaDistanceOverlay(EMPTY_EMA_DISTANCE_OVERLAY)
      return
    }
    chartOverlaySyncRef.current?.()
  }, [showEmaDistance, candleData, ma200Data, pricePaneHeight])

  const firstChartPriceRange = useMemo(() => {
    const visibleBars = candleData
      .filter((bar) => Number.isFinite(Number(bar.high)) && Number.isFinite(Number(bar.low)))
      .slice(-Math.max(20, VISIBLE_BAR_COUNT[interval]))
    if (visibleBars.length === 0) return { min: null as number | null, max: null as number | null }

    const dataMin = Math.min(...visibleBars.map((bar) => Number(bar.low)))
    const dataMax = Math.max(...visibleBars.map((bar) => Number(bar.high)))

    const oiBounds = optionsOpenInterest?.ok ? strikePriceBounds(optionsOpenInterest.strikes) : null
    const min = oiBounds ? Math.min(dataMin, oiBounds.min) : dataMin
    const max = oiBounds ? Math.max(dataMax, oiBounds.max) : dataMax
    const span = Math.max(max - min, 1)
    const paddedRange = span / Math.max(0.1, 1 - PRICE_CHART_SCALE_MARGINS.top - PRICE_CHART_SCALE_MARGINS.bottom)

    return {
      min: min - paddedRange * PRICE_CHART_SCALE_MARGINS.bottom,
      max: max + paddedRange * PRICE_CHART_SCALE_MARGINS.top,
    }
  }, [candleData, interval, optionsOpenInterest])

  useEffect(() => {
    if (!optionsOpenInterest?.ok) return
    const spot = optionsOpenInterest.spot ?? optionsGamma?.spot ?? null

    if (selectedOptionsSpread.shortStrike != null && selectedOptionsSpread.longStrike != null) {
      if (optionsStrategyKind === 'put_credit_spread') {
        if (selectedOptionsSpread.shortStrike > selectedOptionsSpread.longStrike) return
      }
      if (optionsStrategyKind === 'bear_put_spread') {
        if (selectedOptionsSpread.longStrike > selectedOptionsSpread.shortStrike) return
      }
    }

    if (optionsStrategyKind === 'put_credit_spread') {
      const pricedPuts = [...optionsOpenInterest.strikes]
        .filter((row) => row.putOpenInterest > 0 && row.putQuote?.mid != null && row.putQuote.mid > 0)
        .sort((a, b) => a.strike - b.strike)
      if (pricedPuts.length < 2) return
      const shortCandidate =
        [...pricedPuts].reverse().find((row) => spot == null || row.strike < spot) || pricedPuts[pricedPuts.length - 1]
      const shortIndex = pricedPuts.findIndex((row) => row.strike === shortCandidate.strike)
      const longCandidate = pricedPuts[Math.max(0, shortIndex - 1)]
      if (longCandidate && shortCandidate.strike > longCandidate.strike) {
        setSelectedOptionsSpread({ shortStrike: shortCandidate.strike, longStrike: longCandidate.strike })
      }
      return
    }

    if (optionsStrategyKind === 'bear_put_spread') {
      const pricedPuts = [...optionsOpenInterest.strikes]
        .filter((row) => row.putOpenInterest > 0 && row.putQuote?.mid != null && row.putQuote.mid > 0)
        .sort((a, b) => a.strike - b.strike)
      if (pricedPuts.length < 2) return
      const longCandidate =
        pricedPuts.find((row) => spot == null || row.strike >= spot) || pricedPuts[pricedPuts.length - 1]
      const longIndex = pricedPuts.findIndex((row) => row.strike === longCandidate.strike)
      const shortCandidate = pricedPuts[Math.max(0, longIndex - 1)]
      if (shortCandidate && longCandidate.strike > shortCandidate.strike) {
        setSelectedOptionsSpread({ shortStrike: shortCandidate.strike, longStrike: longCandidate.strike })
      }
      return
    }

    if (optionsStrategyKind === 'bear_call_spread') {
      const pricedCalls = [...optionsOpenInterest.strikes]
        .filter((row) => row.callOpenInterest > 0 && row.callQuote?.mid != null && row.callQuote.mid > 0)
        .sort((a, b) => a.strike - b.strike)
      if (pricedCalls.length < 2) return
      const sRow = optionsOpenInterest.strikes.find((r) => r.strike === selectedOptionsSpread.shortStrike)
      const lRow = optionsOpenInterest.strikes.find((r) => r.strike === selectedOptionsSpread.longStrike)
      if (
        sRow?.callQuote &&
        lRow?.callQuote &&
        selectedOptionsSpread.shortStrike != null &&
        selectedOptionsSpread.longStrike != null &&
        selectedOptionsSpread.shortStrike < selectedOptionsSpread.longStrike
      ) {
        return
      }
      const shortCandidate =
        pricedCalls.find((row) => spot == null || row.strike > spot) || pricedCalls[pricedCalls.length - 1]
      const shortIndex = pricedCalls.findIndex((row) => row.strike === shortCandidate.strike)
      const longCandidate = pricedCalls[Math.min(pricedCalls.length - 1, shortIndex + 1)]
      if (longCandidate && longCandidate.strike > shortCandidate.strike) {
        setSelectedOptionsSpread({ shortStrike: shortCandidate.strike, longStrike: longCandidate.strike })
      }
    }
  }, [optionsOpenInterest, optionsStrategyKind, optionsGamma?.spot, selectedOptionsSpread.shortStrike, selectedOptionsSpread.longStrike])

  // ── MAIN CHART EFFECT ─────────────────────────────────────────────────────
  // Single LWC v5 chart with multi-pane RSI. autoSize: true handles all width
  // resizing — no manual ResizeObserver needed for width. pricePaneHeight is
  // intentionally NOT a dep here; the separate pane-height effect applies height
  // changes without recreating the chart.
  useEffect(() => {
    if (!chartContainerRef.current || bars.length === 0 || candleData.length === 0) return

    emaOverlayInputsRef.current = { candleData, ma200Data }

    chartInstance.current?.remove()
    chartInstance.current = null
    candleSeriesRef.current = null
    strategyPriceLinesRef.current = []
    chartOverlaySyncRef.current = null
    setOptionStrikeCoordinates({})
    setVisiblePriceRange(null)
    setEmaDistanceOverlay(EMPTY_EMA_DISTANCE_OVERLAY)

    const chart = createChart(chartContainerRef.current, {
      ...CHART_OPTIONS,
      // autoSize watches the container via its own internal ResizeObserver.
      // This fixes the "chart never appears on load" bug: no clientWidth check needed.
      autoSize: true,
      crosshair: {
        vertLine: { visible: true, labelVisible: true },
        horzLine: { visible: false, labelVisible: false },
      },
      leftPriceScale: { visible: false },
      rightPriceScale: {
        visible: true,
        borderColor: '#334155',
        minimumWidth: PRICE_AXIS_MIN_WIDTH,
        scaleMargins: PRICE_CHART_SCALE_MARGINS,
      },
    })

    const oiStrikeBounds =
      optionsOpenInterest?.ok && optionsOpenInterest.strikes.length > 0
        ? strikePriceBounds(optionsOpenInterest.strikes)
        : null

    // ── Pane 0: price chart ──────────────────────────────────────────────────
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      priceScaleId: 'right',
      lastValueVisible: true,
      priceLineVisible: false,
      autoscaleInfoProvider: createOiStrikeAutoscaleInfoProvider(oiStrikeBounds),
    })
    candleSeriesRef.current = candle
    candle.setData(dedupeByTime(candleData) as never)

    // Invisible anchor series widens autoscale to include the full OI strike band
    const candleSorted = dedupeByTime(candleData)
    const strikeAnchorData = buildOiStrikeAnchorSeriesData(
      candleSorted.map((bar) => bar.time as number),
      oiStrikeBounds,
    )
    if (strikeAnchorData) {
      const anchor = chart.addSeries(LineSeries, {
        color: 'rgba(0,0,0,0)',
        lineWidth: 1,
        lastValueVisible: false,
        priceLineVisible: false,
        priceScaleId: 'right',
        crosshairMarkerVisible: false,
        autoscaleInfoProvider: createOiStrikeAutoscaleInfoProvider(oiStrikeBounds),
      })
      anchor.setData(strikeAnchorData as never)
    }

    const ma200Series = chart.addSeries(LineSeries, {
      color: CHART_COLOR_MA200,
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
      priceScaleId: 'right',
    })
    const ema1Series = chart.addSeries(LineSeries, {
      color: CHART_COLOR_EMA1,
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
      priceScaleId: 'right',
    })
    const ema2Series = chart.addSeries(LineSeries, {
      color: CHART_COLOR_EMA2,
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
      priceScaleId: 'right',
    })
    const ema315Series = chart.addSeries(LineSeries, {
      color: CHART_COLOR_EMA315,
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
      priceScaleId: 'right',
    })
    ma200Series.setData(dedupeByTime(ma200Data) as never)
    ema1Series.setData(dedupeByTime(ema1Data) as never)
    ema2Series.setData(dedupeByTime(ema2Data) as never)
    ema315Series.setData(dedupeByTime(ema315Data) as never)

    const volumeSeries = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: '' })
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 }, borderVisible: false })
    volumeSeries.setData(dedupeByTime(volumeData) as never)

    syncStrategyPriceLines()

    // ── Pane 1: RSI (pane index 1 is auto-created) ───────────────────────────
    if (showIndicators) {
      const rsiSeries = chart.addSeries(
        LineSeries,
        {
          color: '#06b6d4',
          lineWidth: 2,
          priceScaleId: 'right',
          lastValueVisible: true,
          priceLineVisible: false,
        },
        1, // pane index 1
      )
      rsiSeries.setData(dedupeByTime(rsiData) as never)
      rsiSeries.createPriceLine({ price: 70, color: '#5eead4', lineWidth: 1, lineStyle: 1, axisLabelVisible: false })
      rsiSeries.createPriceLine({ price: 30, color: '#5eead4', lineWidth: 1, lineStyle: 1, axisLabelVisible: false })
      // Match scale width to main pane so right-axis columns are vertically aligned
      rsiSeries.priceScale().applyOptions({
        minimumWidth: PRICE_AXIS_MIN_WIDTH,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      })
      const panes = chart.panes()
      if (panes[1]) panes[1].setHeight(STOCK2_RSI_BLOCK_HEIGHT_PX)
    }

    // Set main pane height from ref (updated separately when pricePaneHeight changes)
    const initPanes = chart.panes()
    if (initPanes[0]) initPanes[0].setHeight(pricePaneHeightRef.current)

    chart.timeScale().fitContent()
    const RIGHT_MARGIN_PX = 50
    const barSpacing = chart.timeScale().options().barSpacing
    const rightOffsetBars = Math.max(15, Math.ceil(RIGHT_MARGIN_PX / barSpacing))
    chart.timeScale().applyOptions({ rightOffset: rightOffsetBars })

    // ── Strike coordinate sync (lifted to OI + strategy columns) ────────────
    // Uses pricePaneHeightRef so it stays accurate as the user resizes
    const updateEmaDistanceOverlay = () => {
      if (!showEmaDistanceRef.current) {
        setEmaDistanceOverlay(EMPTY_EMA_DISTANCE_OVERLAY)
        return
      }

      const latestCandles = emaOverlayInputsRef.current.candleData.length
        ? emaOverlayInputsRef.current.candleData
        : candleData
      const latestMa200 = emaOverlayInputsRef.current.ma200Data.length
        ? emaOverlayInputsRef.current.ma200Data
        : ma200Data
      const lastCandle = latestCandles[latestCandles.length - 1]
      const lastMa = latestMa200[latestMa200.length - 1]
      if (!lastCandle || !lastMa) {
        setEmaDistanceOverlay(EMPTY_EMA_DISTANCE_OVERLAY)
        return
      }

      const x = chart.timeScale().timeToCoordinate(lastCandle.time as never)
      const priceY = candle.priceToCoordinate(lastCandle.close)
      const maY = candle.priceToCoordinate(lastMa.value)
      const nextOverlay = buildEmaDistanceOverlayLayout({
        price: lastCandle.close,
        emaValue: lastMa.value,
        x,
        priceY,
        emaY: maY,
      })

      setEmaDistanceOverlay((prev) => {
        if (
          prev.visible === nextOverlay.visible &&
          prev.x === nextOverlay.x &&
          prev.topY === nextOverlay.topY &&
          prev.bottomY === nextOverlay.bottomY &&
          prev.priceY === nextOverlay.priceY &&
          prev.emaY === nextOverlay.emaY &&
          prev.labelY === nextOverlay.labelY &&
          prev.distancePct === nextOverlay.distancePct
        ) {
          return prev
        }
        return nextOverlay
      })
    }

    const updateOptionStrikeCoordinates = () => {
      const h = pricePaneHeightRef.current
      const nextVisibleRange = buildVisiblePriceRangeFromChart(
        (coordinate) => candle.coordinateToPrice(coordinate),
        h,
      )
      setVisiblePriceRange((prev) => {
        if (prev == null && nextVisibleRange == null) return prev
        if (prev != null && nextVisibleRange != null && prev.min === nextVisibleRange.min && prev.max === nextVisibleRange.max) {
          return prev
        }
        return nextVisibleRange
      })

      if (!optionsOpenInterest?.ok) {
        setOptionStrikeCoordinates({})
        return
      }
      const nextCoordinates = buildStrikeCoordinateMap(
        (price) => candle.priceToCoordinate(price),
        optionsOpenInterest.strikes,
        h,
      )
      setOptionStrikeCoordinates((prev) => {
        const prevKeys = Object.keys(prev)
        const nextKeys = Object.keys(nextCoordinates)
        if (prevKeys.length !== nextKeys.length) return nextCoordinates
        for (const key of nextKeys) {
          if (prev[key] !== nextCoordinates[key]) return nextCoordinates
        }
        return prev
      })
    }

    const scheduleStrikeCoordinateSync = () => {
      updateOptionStrikeCoordinates()
      updateEmaDistanceOverlay()
      requestAnimationFrame(() => {
        updateOptionStrikeCoordinates()
        updateEmaDistanceOverlay()
        requestAnimationFrame(() => {
          updateOptionStrikeCoordinates()
          updateEmaDistanceOverlay()
        })
      })
    }

    chartOverlaySyncRef.current = () => {
      updateOptionStrikeCoordinates()
      updateEmaDistanceOverlay()
    }

    chart.timeScale().subscribeVisibleLogicalRangeChange(scheduleStrikeCoordinateSync)
    scheduleStrikeCoordinateSync()

    chartInstance.current = chart

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(scheduleStrikeCoordinateSync)
      chartOverlaySyncRef.current = null
      chart.remove()
      chartInstance.current = null
      candleSeriesRef.current = null
      strategyPriceLinesRef.current = []
    }
  }, [
    bars,
    candleData,
    ema1Data,
    ema2Data,
    ema315Data,
    ma200Data,
    emaPeriod1,
    emaPeriod2,
    volumeData,
    rsiData,
    optionsOpenInterest,
    showIndicators,
    // syncStrategyPriceLines intentionally omitted — separate effect handles price-line updates
    // pricePaneHeight intentionally omitted — separate pane-height effect avoids full recreation
  ])

  useEffect(() => {
    syncStrategyPriceLines()
  }, [syncStrategyPriceLines])

  const spot = optionsOpenInterest?.spot ?? optionsGamma?.spot ?? null
  const gammaChip = regimeLabel(optionsGamma?.regime ?? null)

  return (
    <div ref={workspaceRef} className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div
        className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-800 bg-slate-900/50 px-4"
        style={{ minHeight: STOCK2_TOOLBAR_HEIGHT_PX }}
      >
        <div className="flex items-baseline gap-2 pr-2">
          <span className="text-base font-semibold text-slate-100">{symbol || '—'}</span>
          <span className="font-mono text-sm text-slate-400">{formatSpot(spot)}</span>
          {gammaChip && (
            <span className="rounded border border-slate-700 bg-slate-800/80 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
              {gammaChip}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {INTERVALS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => {
                setInterval(item.value)
                pushUrl({ interval: item.value })
              }}
              className={`rounded px-2.5 py-1 text-xs font-medium ${
                interval === item.value
                  ? 'bg-sky-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={showIndicators}
            onChange={(e) => {
              setShowIndicators(e.target.checked)
              pushUrl({ indicators: e.target.checked })
            }}
            className="rounded border-slate-600 bg-slate-800 text-sky-500 focus:ring-sky-500"
          />
          RSI indicator
        </label>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className="text-green-400">EMA</span>
          <input
            type="number"
            min={MIN_EMA_PERIOD}
            max={MAX_EMA_PERIOD}
            value={emaPeriod1}
            onChange={(e) => setEmaPeriod1(parseEmaPeriod(e.target.value, DEFAULT_EMA_PERIOD_1))}
            onBlur={(e) => commitEmaPeriod(1, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            aria-label="First EMA period"
            className="w-14 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-center text-slate-200 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
          <span className="text-slate-500">/</span>
          <input
            type="number"
            min={MIN_EMA_PERIOD}
            max={MAX_EMA_PERIOD}
            value={emaPeriod2}
            onChange={(e) => setEmaPeriod2(parseEmaPeriod(e.target.value, DEFAULT_EMA_PERIOD_2))}
            onBlur={(e) => commitEmaPeriod(2, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            aria-label="Second EMA period"
            className="w-14 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-center text-slate-200 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={showEmaDistance}
            onChange={(e) => {
              setShowEmaDistance(e.target.checked)
              pushUrl({ emaDistance: e.target.checked })
            }}
            className="rounded border-slate-600 bg-slate-800 text-sky-500 focus:ring-sky-500"
          />
          MA {MA200_PERIOD} distance
          {showEmaDistance && (
            <span
              className={
                ma200DistancePct == null
                  ? 'text-slate-500'
                  : ma200DistancePct >= 0
                    ? 'font-medium text-green-400'
                    : 'font-medium text-red-400'
              }
            >
              {formatEmaDistancePercent(ma200DistancePct)}
            </span>
          )}
        </label>
        {loading && <span className="text-xs text-slate-500">Loading bars…</span>}
      </div>

      {/* ── Chart grid ──────────────────────────────────────────────────────── */}
      <div className="grid h-full min-h-0 flex-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_250px_300px]">

        {/* Single LWC chart container — height driven by stackHeight CSS */}
        <div className="relative min-h-0 min-w-0">
          {/* Container sized to full chart height (price pane + RSI pane when visible).
              autoSize: true fills this container's width automatically. */}
          <div className="relative" style={{ height: stackHeight }}>
            <div ref={chartContainerRef} className="absolute inset-0" />

            {/* EMA legend — floats over top-left of price pane */}
            <div className="pointer-events-none absolute left-2 top-2 z-10 flex flex-wrap items-center gap-2 rounded border border-slate-700/50 bg-slate-900/95 px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur-sm">
              <span className="text-green-400">━</span> <span className="text-slate-300">EMA {emaPeriod1}</span>
              <span className="text-yellow-400">━</span> <span className="text-slate-300">EMA {emaPeriod2}</span>
              {ema315Data.length > 0 && (
                <>
                  <span className="text-purple-400">━</span>{' '}
                  <span className="text-slate-300">EMA {EMA315_PERIOD}</span>
                </>
              )}
              <span className="text-blue-400">━</span> <span className="text-slate-300">MA {MA200_PERIOD}</span>
            </div>

            {/* EMA distance measure — vertical line from EMA to last close on the final bar */}
            {showEmaDistance && emaDistanceOverlay.visible && emaDistanceOverlay.x != null && (
              <div
                className="pointer-events-none absolute left-0 top-0 z-[5] overflow-hidden"
                style={{ width: '100%', height: pricePaneHeight }}
                aria-hidden
              >
                {(() => {
                  const color = emaDistanceOverlayColor(emaDistanceOverlay.distancePct)
                  const lineTop = emaDistanceOverlay.topY ?? 0
                  const lineHeight = Math.max(0, (emaDistanceOverlay.bottomY ?? lineTop) - lineTop)
                  const labelTop = (emaDistanceOverlay.labelY ?? lineTop) - 10
                  const x = emaDistanceOverlay.x
                  const priceDotY = emaDistanceOverlay.priceY ?? lineTop
                  const emaDotY = emaDistanceOverlay.emaY ?? (emaDistanceOverlay.bottomY ?? lineTop)

                  return (
                    <>
                      <div
                        style={{
                          position: 'absolute',
                          left: x - 1,
                          top: lineTop,
                          width: 2,
                          height: lineHeight,
                          background: color,
                          opacity: 0.9,
                          borderRadius: 1,
                        }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          left: x - 4,
                          top: priceDotY - 4,
                          width: 8,
                          height: 8,
                          borderRadius: '9999px',
                          background: color,
                          boxShadow: '0 0 0 2px rgba(15,23,42,0.85)',
                        }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          left: x - 4,
                          top: emaDotY - 4,
                          width: 8,
                          height: 8,
                          borderRadius: '9999px',
                          background: CHART_COLOR_MA200,
                          boxShadow: '0 0 0 2px rgba(15,23,42,0.85)',
                        }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          left: x + 8,
                          top: labelTop,
                          fontSize: '11px',
                          lineHeight: '18px',
                          color,
                          background: 'rgba(15,23,42,0.92)',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          border: `1px solid ${color}99`,
                          whiteSpace: 'nowrap',
                          fontFamily: 'ui-monospace, monospace',
                          fontWeight: 600,
                        }}
                      >
                        {formatEmaDistancePercent(emaDistanceOverlay.distancePct)}
                      </div>
                    </>
                  )
                })()}
              </div>
            )}

            {/* RSI pane label — positioned at the top of the RSI pane area */}
            {showIndicators && (
              <div
                className="pointer-events-none absolute left-3 z-10 text-xs font-semibold text-cyan-400"
                style={{ top: pricePaneHeight + 4 }}
              >
                RSI (14)
              </div>
            )}
          </div>
        </div>

        <OptionsOpenInterestRail
          layout="stacked"
          expirations={optionsOpenInterest?.expirations || []}
          selectedExpiration={selectedOptionsExpiration || optionsOpenInterest?.selectedExpiration || null}
          strikes={optionsOpenInterest?.ok ? optionsOpenInterest.strikes : []}
          spot={optionsOpenInterest?.spot ?? optionsGamma?.spot ?? null}
          pricePaneHeight={pricePaneHeight}
          fullHeight={stackHeight}
          belowPaneHeight={sideColumnBelowPaneHeight}
          strikeCoordinates={optionStrikeCoordinates}
          visiblePriceRange={visiblePriceRange}
          priceMin={firstChartPriceRange.min}
          priceMax={firstChartPriceRange.max}
          loading={optionsOpenInterestLoading}
          message={optionsOpenInterest?.message || null}
          onExpirationChange={(exp) => {
            setSelectedOptionsExpiration(exp)
            pushUrl({ expiration: exp })
          }}
          strategyKind={optionsStrategyKind}
          strategyShortStrike={selectedOptionsSpread.shortStrike}
          strategyLongStrike={selectedOptionsSpread.longStrike}
          onStrategyStrikeChange={(next) => {
            setSelectedOptionsSpread(next)
            pushUrl({ shortStrike: next.shortStrike, longStrike: next.longStrike })
          }}
        />

        <OptionsStrategyVisualizer
          layout="stacked"
          putCreditSpreadLabel="Bull put spread"
          strategyKind={optionsStrategyKind}
          onStrategyKindChange={(next) => {
            setOptionsStrategyKind(next)
            setSelectedOptionsSpread({ shortStrike: null, longStrike: null })
            pushUrl({ strategy: next, shortStrike: null, longStrike: null })
          }}
          selectedExpiration={selectedOptionsExpirationMeta}
          strikes={optionsOpenInterest?.ok ? optionsOpenInterest.strikes : []}
          spot={optionsOpenInterest?.spot ?? optionsGamma?.spot ?? null}
          pricePaneHeight={pricePaneHeight}
          fullHeight={stackHeight}
          belowPaneHeight={sideColumnBelowPaneHeight}
          strikeCoordinates={optionStrikeCoordinates}
          visiblePriceRange={visiblePriceRange}
          priceMin={firstChartPriceRange.min}
          priceMax={firstChartPriceRange.max}
          shortStrike={selectedOptionsSpread.shortStrike}
          longStrike={selectedOptionsSpread.longStrike}
        />
      </div>
    </div>
  )
}
