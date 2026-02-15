import { useEffect, useState, useRef, useMemo } from 'react'
import { useParams, useLocation, Link } from 'react-router-dom'
import { createChart, ColorType } from 'lightweight-charts'
import { sma, rsi, findPullbacks, vcpContraction } from '../utils/chartIndicators'

interface Bar {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

interface ScoreCriterion {
  criterion: string
  matched: boolean
  points: number
  detail?: string
}

interface VCPInfo {
  ticker: string
  vcpBullish: boolean
  reason?: string
  error?: string
  contractions: number
  atMa10: boolean
  atMa20: boolean
  atMa50: boolean
  lastClose?: number
  sma10?: number
  sma20?: number
  sma50?: number
  pullbackPcts?: string[]
  volumeDryUp?: boolean
  volumeRatio?: number | null
  barCount?: number
  score?: number
  recommendation?: 'buy' | 'hold' | 'avoid'
  scoreBreakdown?: ScoreCriterion[]
}

const TIMEFRAMES = [
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '12M', days: 365 },
] as const

const INTERVALS = [
  { label: 'Daily', value: '1d' },
  { label: 'Weekly', value: '1wk' },
  { label: 'Monthly', value: '1mo' },
] as const

/** Derive score breakdown from vcp when API doesn't return it (e.g. cached response) */
function getScoreBreakdown(vcp: VCPInfo | null): ScoreCriterion[] {
  if (!vcp) return []
  const b: ScoreCriterion[] = []
  if (vcp.reason === 'not_enough_bars') {
    b.push({ criterion: 'Not enough bars (need 60+)', matched: false, points: 0 })
    return b
  }
  if (vcp.reason === 'below_50_ma') {
    b.push({ criterion: 'Price above 50 SMA (Stage 2)', matched: false, points: 0 })
    return b
  }
  b.push({ criterion: 'VCP Bullish (contractions + at MA)', matched: vcp.vcpBullish, points: vcp.vcpBullish ? 50 : 0 })
  if (!vcp.vcpBullish) b.push({ criterion: 'Partial setup (above 50 MA, no full VCP)', matched: true, points: 20 })
  const c = vcp.contractions || 0
  const cPts = Math.min(c * 8, 25)
  b.push({ criterion: 'Contractions (each pullback smaller than previous)', matched: c > 0, points: cPts, detail: `${c} contractions` })
  b.push({ criterion: 'Price at 10 MA (within 2%)', matched: vcp.atMa10, points: vcp.atMa10 ? 5 : 0 })
  b.push({ criterion: 'Price at 20 MA (within 2%)', matched: vcp.atMa20, points: vcp.atMa20 ? 5 : 0 })
  b.push({ criterion: 'Price at 50 MA (within 2%)', matched: vcp.atMa50, points: vcp.atMa50 ? 5 : 0 })
  const above50 = vcp.lastClose != null && vcp.sma50 != null && vcp.lastClose >= vcp.sma50
  b.push({ criterion: 'Price above 50 SMA', matched: above50, points: above50 ? 10 : 0 })
  b.push({ criterion: 'Volume drying up on pullbacks (<85% of 20d avg)', matched: !!vcp.volumeDryUp, points: vcp.volumeDryUp ? 10 : 0 })
  return b
}

const CHART_OPTIONS = {
  layout: { background: { type: ColorType.Solid, color: '#0f172a' }, textColor: '#94a3b8' },
  grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
  timeScale: { timeVisible: true, secondsVisible: false },
  rightPriceScale: { borderColor: '#334155' },
}

export default function StockDetail() {
  const { ticker } = useParams<{ ticker: string }>()
  const location = useLocation()
  const scanResult = (location.state as { scanResult?: VCPInfo } | null)?.scanResult
  const [bars, setBars] = useState<Bar[]>([])
  const [vcp, setVcp] = useState<VCPInfo | null>(null)
  const [companyName, setCompanyName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [timeframe, setTimeframe] = useState<(typeof TIMEFRAMES)[number]>(TIMEFRAMES[1])
  const [interval, setInterval] = useState<(typeof INTERVALS)[number]['value']>('1d')
  const [chartView, setChartView] = useState<'tradingview' | 'custom'>('tradingview')
  const chartWrapperRef = useRef<HTMLDivElement>(null)
  const tradingViewContainerRef = useRef<HTMLDivElement>(null)
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const rsiChartRef = useRef<HTMLDivElement>(null)
  const vcpChartRef = useRef<HTMLDivElement>(null)
  const chartInstance = useRef<ReturnType<typeof createChart> | null>(null)
  const rsiChartInstance = useRef<ReturnType<typeof createChart> | null>(null)
  const vcpChartInstance = useRef<ReturnType<typeof createChart> | null>(null)

  // Fetch bars and VCP separately so a VCP failure doesn't block chart update (fixes daily/weekly showing same)
  // Only fetch bars when using custom chart; TradingView fetches its own data
  useEffect(() => {
    if (!ticker) return
    if (chartView === 'tradingview') {
      setLoading(false)
      return
    }
    setLoading(true)
    const barsUrl = `/api/bars/${ticker}?days=${timeframe.days}&interval=${interval}`
    // cache: 'no-store' prevents browser from returning cached daily when switching to weekly
    fetch(barsUrl, { cache: 'no-store' })
      .then((r) => r.json())
      .then((barsRes) => {
        if (barsRes.error) throw new Error(barsRes.error)
        setBars(barsRes.results || [])
      })
      .catch((e) => {
        console.error('Bars fetch failed:', e)
        setBars([])
      })
      .finally(() => setLoading(false))
    // VCP in parallel; failures are non-fatal (we keep scanResult or previous vcp)
    fetch(`/api/vcp/${ticker}`)
      .then((r) => r.json())
      .then((vcpRes) => {
        const hasValidVcp = vcpRes && !vcpRes.error && (vcpRes.score != null || vcpRes.vcpBullish != null)
        setVcp(hasValidVcp ? vcpRes : (scanResult && !scanResult.error ? scanResult : vcpRes))
      })
      .catch(() => {})
  }, [ticker, timeframe, interval, chartView])

  // TradingView embed: inject widget when chartView is tradingview (has built-in Daily/Weekly/Monthly)
  useEffect(() => {
    if (!ticker || chartView !== 'tradingview' || !tradingViewContainerRef.current) return
    const container = tradingViewContainerRef.current
    container.innerHTML = ''
    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'
    script.async = true
    // TradingView symbol: NASDAQ for most, NYSE for tickers with dot (e.g. BRK.B)
    const symbol = ticker.includes('.') ? `NYSE:${ticker}` : `NASDAQ:${ticker}`
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval: 'D',
      timezone: 'America/New_York',
      theme: 'dark',
      style: '1',
      locale: 'en',
      enable_publishing: false,
      hide_top_toolbar: false,
      hide_legend: false,
      save_image: false,
      calendar: false,
      studies: ['RSI@tv-basicstudies'],
      support_host: 'https://www.tradingview.com',
    })
    container.appendChild(script)
    return () => {
      container.innerHTML = ''
    }
  }, [ticker, chartView])

  // Fetch company name separately so it doesn't block chart load; failures are non-fatal
  useEffect(() => {
    if (!ticker) return
    fetch(`/api/quote/${encodeURIComponent(ticker)}`)
      .then((r) => (r.ok ? r.json() : { name: null }))
      .then((data) => setCompanyName(data?.name ?? null))
      .catch(() => setCompanyName(null))
  }, [ticker])

  const { candleData, ma10Data, ma20Data, ma50Data, ma150Data, volumeData, ma20VolumeData, rsiData, vcpContractionData, pullbacks } = useMemo(() => {
    if (bars.length === 0) return { candleData: [], ma10Data: [], ma20Data: [], ma50Data: [], ma150Data: [], volumeData: [], ma20VolumeData: [], rsiData: [], vcpContractionData: [], pullbacks: [] }
    const closes = bars.map((b) => b.c)
    const volumes = bars.map((b) => b.v)
    const sma10 = sma(closes, 10)
    const sma20 = sma(closes, 20)
    const sma50 = sma(closes, 50)
    const sma150 = sma(closes, 150)
    const sma20Vol = sma(volumes, 20)
    const rsi14 = rsi(closes, 14)
    const vcpContr = vcpContraction(bars, 6)
    // Use UTCTimestamp (seconds) for all intervals – avoids business-day issues with weekly/monthly
    const toTime = (t: number) => Math.floor(t / 1000) as any
    const vcpPullbacks = findPullbacks(bars, 80)
    return {
      candleData: bars.map((b) => ({ time: toTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c })),
      ma10Data: bars.map((b, i) => ({ time: toTime(b.t), value: sma10[i] })).filter((d) => d.value != null) as { time: string; value: number }[],
      volumeData: bars.map((b) => ({
        time: toTime(b.t),
        value: b.v,
        color: b.c >= b.o ? '#22c55e' : '#ef4444',
      })),
      ma20VolumeData: bars
        .map((b, i) => ({ time: toTime(b.t), value: sma20Vol[i] }))
        .filter((d) => d.value != null) as { time: string; value: number }[],
      ma20Data: bars.map((b, i) => ({ time: toTime(b.t), value: sma20[i] })).filter((d) => d.value != null) as { time: string; value: number }[],
      ma50Data: bars.map((b, i) => ({ time: toTime(b.t), value: sma50[i] })).filter((d) => d.value != null) as { time: string; value: number }[],
      ma150Data: bars.map((b, i) => ({ time: toTime(b.t), value: sma150[i] })).filter((d) => d.value != null) as { time: string; value: number }[],
      // Pad RSI with first 14 bars (same value as first RSI) so time range matches price chart
      rsiData: (() => {
        const filtered = bars.map((b, i) => ({ time: toTime(b.t), value: rsi14[i] })).filter((d) => d.value != null) as { time: string; value: number }[]
        if (filtered.length === 0) return []
        const firstVal = filtered[0].value
        const padCount = bars.length - filtered.length
        const pad = bars.slice(0, padCount).map((b) => ({ time: toTime(b.t), value: firstVal }))
        return [...pad, ...filtered]
      })(),
      vcpContractionData: (() => {
        const filtered = bars.map((b, i) => ({ time: toTime(b.t), value: vcpContr[i] })).filter((d) => d.value != null) as { time: string; value: number }[]
        if (filtered.length === 0) return []
        const firstVal = filtered[0].value
        const padCount = bars.length - filtered.length
        const pad = bars.slice(0, padCount).map((b) => ({ time: toTime(b.t), value: firstVal }))
        return [...pad, ...filtered]
      })(),
      pullbacks: vcpPullbacks.slice(-6), // last 6 pullbacks for VCP setup lines
    }
  }, [bars])

  useEffect(() => {
    if (!chartWrapperRef.current || !chartContainerRef.current || !rsiChartRef.current || !vcpChartRef.current || bars.length === 0) return
    if (chartInstance.current) {
      chartInstance.current.remove()
      chartInstance.current = null
    }
    if (rsiChartInstance.current) {
      rsiChartInstance.current.remove()
      rsiChartInstance.current = null
    }
    if (vcpChartInstance.current) {
      vcpChartInstance.current.remove()
      vcpChartInstance.current = null
    }

    const w = chartWrapperRef.current?.clientWidth ?? 0
    if (w <= 0) return

    const mainChart = createChart(chartContainerRef.current, {
      ...CHART_OPTIONS,
      width: w,
      height: 380,
      rightPriceScale: { borderColor: '#334155', minimumWidth: 60 },
    })
    const rsiChart = createChart(rsiChartRef.current, {
      ...CHART_OPTIONS,
      width: w,
      height: 140,
      rightPriceScale: { borderColor: '#334155', minimumWidth: 60, scaleMargins: { top: 0.1, bottom: 0.1 } },
    })
    const vcpChart = createChart(vcpChartRef.current, {
      ...CHART_OPTIONS,
      width: w,
      height: 100,
      rightPriceScale: {
        borderColor: '#334155',
        minimumWidth: 60,
        scaleMargins: { top: 0.1, bottom: 0.1 },
        autoScale: true,
      },
    })

    const candle = mainChart.addCandlestickSeries({ upColor: '#22c55e', downColor: '#ef4444', borderVisible: false })
    candle.setData(candleData)

    // Buy arrows: VCP returned to tight (1–2.5) after recent spike (≥2.5), price above 50 MA
    // Matches Dec 1–3, Jan 9–12, Jan 28–29, Feb 5: spike → drop = setup complete
    const sma50AtTime = (t: string | number) => ma50Data.find((d) => d.time === t)?.value ?? 0
    const closeAtTime = (t: string | number) => candleData.find((d) => d.time === t)?.close ?? 0
    const lookbackBars = 30
    const buyMarkers = vcpContractionData
      .filter((d, i) => {
        const close = closeAtTime(d.time)
        const ma50 = sma50AtTime(d.time)
        if (ma50 <= 0 || close <= ma50) return false
        const isTight = d.value >= 0.8 && d.value <= 2.5
        if (!isTight) return false
        const start = Math.max(0, i - lookbackBars)
        const hadRecentSpike = vcpContractionData.slice(start, i + 1).some((v) => v.value >= 2.5)
        return hadRecentSpike
      })
      .map((d) => ({ time: d.time, position: 'belowBar' as const, shape: 'arrowUp' as const, color: '#3b82f6' }))
    candle.setMarkers(buyMarkers)

    const ma10Series = mainChart.addLineSeries({ color: '#f59e0b', lineWidth: 2, lastValueVisible: false, priceLineVisible: false })
    const ma20Series = mainChart.addLineSeries({ color: '#3b82f6', lineWidth: 2, lastValueVisible: false, priceLineVisible: false })
    const ma50Series = mainChart.addLineSeries({ color: '#8b5cf6', lineWidth: 2, lastValueVisible: false, priceLineVisible: false })
    const ma150Series = mainChart.addLineSeries({ color: '#ec4899', lineWidth: 2, lastValueVisible: false, priceLineVisible: false })
    ma10Series.setData(ma10Data)

    // Volume histogram (overlay at bottom) + 20 MA volume line
    const volumeSeries = mainChart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    })
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
      borderVisible: false,
    })
    volumeSeries.setData(volumeData)
    const ma20VolSeries = mainChart.addLineSeries({
      color: '#f59e0b',
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
      priceScaleId: '',
    })
    ma20VolSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
      borderVisible: false,
    })
    ma20VolSeries.setData(ma20VolumeData)

    ma10Series.setData(ma10Data)
    ma20Series.setData(ma20Data)
    ma50Series.setData(ma50Data)
    ma150Series.setData(ma150Data)

    const VCP_COLORS = ['#22c55e', '#16a34a', '#15803d', '#166534', '#14532d', '#052e16']
    pullbacks.forEach((pb, i) => {
      const color = VCP_COLORS[Math.min(i, VCP_COLORS.length - 1)]
      const vcpLine = mainChart.addLineSeries({
        color,
        lineWidth: 2,
        lineStyle: 2,
        lastValueVisible: false,
        priceLineVisible: false,
      })
      vcpLine.setData([
        { time: (pb.highTimeUtc ?? Math.floor(new Date(pb.highTime).getTime() / 1000)) as any, value: pb.highPrice },
        { time: (pb.lowTimeUtc ?? Math.floor(new Date(pb.lowTime).getTime() / 1000)) as any, value: pb.lowPrice },
      ])
    })
    if (pullbacks.length > 0) {
      const last = pullbacks[pullbacks.length - 1]
      candle.createPriceLine({ price: last.highPrice, color: '#22c55e', lineWidth: 1, lineStyle: 1, title: `VCP high ${last.pct.toFixed(1)}%` })
      candle.createPriceLine({ price: last.lowPrice, color: '#ef4444', lineWidth: 1, lineStyle: 1, title: `VCP low` })
    }

    const rsiSeries = rsiChart.addLineSeries({ color: '#06b6d4', lineWidth: 2 })
    rsiSeries.setData(rsiData)

    const vcpSeries = vcpChart.addLineSeries({ color: '#a855f7', lineWidth: 2 })
    vcpSeries.setData(vcpContractionData)

    // Sync crosshair across all panes: when hovering any chart, show vertical line on all
    const findValAtTime = (data: { time: string | number; value?: number; close?: number }[], time: string | number | undefined) => {
      if (time == null) return 0
      const pt = data.find((d) => d.time === time)
      if (pt) return (pt.value ?? pt.close) ?? 0
      const idx = data.findIndex((d) => (typeof d.time === 'number' && typeof time === 'number' ? d.time >= time : String(d.time) >= String(time)))
      if (idx <= 0) return (data[0]?.value ?? data[0]?.close) ?? 0
      return (data[idx - 1]?.value ?? data[idx - 1]?.close) ?? 0
    }
    const mainPriceAtTime = (t: string | number | undefined) => findValAtTime(candleData, t)
    let crosshairSyncing = false
    const syncCrosshair = (time: string | number | undefined) => {
      if (!time || crosshairSyncing) return
      crosshairSyncing = true
      try {
        const timeVal = time as import('lightweight-charts').Time
        mainChart.setCrosshairPosition(mainPriceAtTime(time), timeVal, candle)
        rsiChart.setCrosshairPosition(findValAtTime(rsiData, time), timeVal, rsiSeries)
        vcpChart.setCrosshairPosition(findValAtTime(vcpContractionData, time), timeVal, vcpSeries)
      } finally {
        crosshairSyncing = false
      }
    }
    const clearCrosshair = () => {
      if (crosshairSyncing) return
      mainChart.clearCrosshairPosition()
      rsiChart.clearCrosshairPosition()
      vcpChart.clearCrosshairPosition()
    }
    mainChart.subscribeCrosshairMove((param) => {
      if (param.time != null) syncCrosshair(param.time as string | number)
      else clearCrosshair()
    })
    rsiChart.subscribeCrosshairMove((param) => {
      if (param.time != null) syncCrosshair(param.time as string | number)
      else clearCrosshair()
    })
    vcpChart.subscribeCrosshairMove((param) => {
      if (param.time != null) syncCrosshair(param.time as string | number)
      else clearCrosshair()
    })

    // Sync by logical range so right margin is preserved (time range strips it)
    let syncing = false
    const syncToOthers = (range: { from: number; to: number } | null) => {
      if (!range || syncing) return
      syncing = true
      rsiChart.timeScale().setVisibleLogicalRange(range)
      vcpChart.timeScale().setVisibleLogicalRange(range)
      mainChart.timeScale().setVisibleLogicalRange(range)
      syncing = false
    }
    mainChart.timeScale().subscribeVisibleLogicalRangeChange(syncToOthers)
    rsiChart.timeScale().subscribeVisibleLogicalRangeChange(syncToOthers)
    vcpChart.timeScale().subscribeVisibleLogicalRangeChange(syncToOthers)

    // Fit content first, then add right margin (50px gap)
    mainChart.timeScale().fitContent()
    const RIGHT_MARGIN_PX = 50
    const barSpacing = mainChart.timeScale().options().barSpacing
    const rightOffsetBars = Math.max(15, Math.ceil(RIGHT_MARGIN_PX / barSpacing))
    mainChart.timeScale().applyOptions({ rightOffset: rightOffsetBars })
    rsiChart.timeScale().applyOptions({ rightOffset: rightOffsetBars })
    vcpChart.timeScale().applyOptions({ rightOffset: rightOffsetBars })
    const logicalRange = mainChart.timeScale().getVisibleLogicalRange()
    if (logicalRange) {
      rsiChart.timeScale().setVisibleLogicalRange(logicalRange)
      vcpChart.timeScale().setVisibleLogicalRange(logicalRange)
    }

    chartInstance.current = mainChart
    rsiChartInstance.current = rsiChart
    vcpChartInstance.current = vcpChart

    const resize = () => {
      const w = chartWrapperRef.current?.clientWidth ?? 0
      if (w > 0) {
        mainChart.applyOptions({ width: w })
        rsiChart.applyOptions({ width: w })
        vcpChart.applyOptions({ width: w })
      }
    }
    const ro = new ResizeObserver(resize)
    ro.observe(chartWrapperRef.current!)
    resize()

    return () => {
      ro.disconnect()
      mainChart.remove()
      rsiChart.remove()
      vcpChart.remove()
      chartInstance.current = null
      rsiChartInstance.current = null
      vcpChartInstance.current = null
    }
  }, [bars, candleData, ma10Data, ma20Data, ma50Data, ma150Data, volumeData, ma20VolumeData, rsiData, vcpContractionData, pullbacks])

  // Use scan result for display when API failed but we have it from dashboard navigation
  const displayVcp = vcp ?? (scanResult && !scanResult.error ? scanResult : null)

  if (loading || !ticker) {
    return (
      <div className="py-12 text-slate-400">
        {loading ? 'Loading…' : 'Missing ticker.'}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-4">
        <Link to="/" className="text-slate-400 hover:text-slate-200 text-sm">
          ← Dashboard
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-100">{ticker}</h1>
          {companyName && <p className="text-slate-400 text-sm mt-0.5">{companyName}</p>}
        </div>
        {displayVcp?.score != null && (
          <span className="px-2 py-1 rounded bg-slate-700 text-slate-200 text-sm font-medium">
            Score: {displayVcp.score}/100
          </span>
        )}
        {displayVcp?.recommendation === 'buy' && (
          <span className="px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 text-sm font-medium">
            Buy
          </span>
        )}
        {displayVcp?.recommendation === 'hold' && (
          <span className="px-2 py-1 rounded bg-amber-500/20 text-amber-400 text-sm font-medium">
            Hold
          </span>
        )}
        {displayVcp?.recommendation === 'avoid' && (
          <span className="px-2 py-1 rounded bg-slate-600 text-slate-400 text-sm font-medium">
            Avoid
          </span>
        )}
        {displayVcp?.vcpBullish && !displayVcp?.recommendation && (
          <span className="px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 text-sm font-medium">
            VCP Bullish
          </span>
        )}
      </div>

      {displayVcp && (
        <>
        {(displayVcp.scoreBreakdown?.length ? displayVcp.scoreBreakdown : getScoreBreakdown(displayVcp)).length > 0 && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <div className="text-slate-400 text-sm font-medium mb-2">Why this score?</div>
            <ul className="space-y-1.5 text-sm">
              {(displayVcp.scoreBreakdown?.length ? displayVcp.scoreBreakdown : getScoreBreakdown(displayVcp)).map((c, i) => (
                <li key={i} className={c.matched ? 'text-slate-200' : 'text-slate-500'}>
                  {c.matched ? '✓' : '–'} {c.criterion}
                  {c.detail && <span className="text-slate-500"> ({c.detail})</span>}
                  {c.points > 0 && <span className="text-sky-400 ml-1">+{c.points}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <div>
            <div className="text-slate-500 text-xs">Close</div>
            <div className="text-slate-200 font-mono">{displayVcp.lastClose?.toFixed(2) ?? '–'}</div>
          </div>
          <div>
            <div className="text-slate-500 text-xs">Contractions</div>
            <div className="text-slate-200">{displayVcp.contractions}</div>
          </div>
          <div>
            <div className="text-slate-500 text-xs">At 10 / 20 / 50 MA</div>
            <div className="text-slate-200">
              {displayVcp.atMa10 ? '✓' : '–'} / {displayVcp.atMa20 ? '✓' : '–'} / {displayVcp.atMa50 ? '✓' : '–'}
            </div>
          </div>
          <div>
            <div className="text-slate-500 text-xs">SMA 50</div>
            <div className="text-slate-200 font-mono">{displayVcp.sma50?.toFixed(2) ?? '–'}</div>
          </div>
          <div>
            <div className="text-slate-500 text-xs">Volume dry up</div>
            <div className="text-slate-200">{displayVcp.volumeDryUp ? '✓' : '–'}</div>
          </div>
          <div>
            <div className="text-slate-500 text-xs">Vol ratio (5d/20d)</div>
            <div className="text-slate-200 font-mono">{displayVcp.volumeRatio != null ? displayVcp.volumeRatio.toFixed(2) : '–'}</div>
          </div>
        </div>
        </>
      )}

      <div>
        {chartView === 'custom' && bars.length === 0 && displayVcp && (
          <p className="mb-4 text-amber-400/90 text-sm">
            Chart data unavailable (API may be rate limited). Score and breakdown above are from the last scan.
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-2">
          <h2 className="text-lg font-medium text-slate-200">
            {chartView === 'tradingview'
              ? 'TradingView chart (use 1D/1W/1M in toolbar)'
              : `${INTERVALS.find((i) => i.value === interval)?.label ?? 'Daily'} chart`}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setChartView('tradingview')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  chartView === 'tradingview'
                    ? 'bg-sky-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                }`}
              >
                TradingView
              </button>
              <button
                type="button"
                onClick={() => setChartView('custom')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  chartView === 'custom'
                    ? 'bg-sky-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                }`}
              >
                Custom
              </button>
            </div>
            {chartView === 'custom' && (
              <>
                <span className="text-slate-500 text-sm">|</span>
                <div className="flex gap-1">
                  {INTERVALS.map((i) => (
                    <button
                      key={i.value}
                      type="button"
                      onClick={() => setInterval(i.value)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                        interval === i.value
                          ? 'bg-sky-600 text-white'
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                      }`}
                    >
                      {i.label}
                    </button>
                  ))}
                </div>
                <span className="text-slate-500 text-sm">|</span>
                <div className="flex gap-1">
                  {TIMEFRAMES.map((tf) => (
                    <button
                      key={tf.label}
                      type="button"
                      onClick={() => setTimeframe(tf)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                        timeframe.label === tf.label
                          ? 'bg-sky-600 text-white'
                          : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                      }`}
                    >
                      {tf.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        {chartView === 'tradingview' ? (
          <div
            ref={tradingViewContainerRef}
            className="tradingview-widget-container rounded-xl border border-slate-800 overflow-hidden"
            style={{ height: 500 }}
          />
        ) : (
          <div ref={chartWrapperRef} className="rounded-xl border border-slate-800 overflow-hidden">
            <div ref={chartContainerRef} style={{ height: 380 }} />
            <div className="border-t border-slate-800">
              <div className="px-3 py-1.5 text-xs text-slate-500 bg-slate-900/50">RSI (14)</div>
              <div ref={rsiChartRef} style={{ height: 140 }} />
            </div>
            <div className="border-t border-slate-800">
              <div className="px-3 py-1.5 text-xs text-slate-500 bg-slate-900/50">VCP Contraction (consecutive smaller pullbacks)</div>
              <div ref={vcpChartRef} style={{ height: 100 }} />
            </div>
          </div>
        )}
      </div>

      <p className="text-slate-500 text-sm">
        <strong>TradingView:</strong> Built-in 1D/1W/1M in toolbar. <strong>Custom:</strong> MAs 10/20/50/150, volume, VCP pullbacks, RSI 14. Data: Yahoo Finance.
      </p>
    </div>
  )
}
