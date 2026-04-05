/**
 * Dedicated page for a single market index (S&P 500, NASDAQ, Russell 2000, Dow Jones).
 * Shows a large chart with regime info. Linked from Dashboard's MarketIndexRegimeCards.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { ColorType, PriceScaleMode, createChart, type MouseEventParams, type Time } from 'lightweight-charts'
import { API_BASE } from '../utils/api'
import { sma } from '../utils/chartIndicators'
import { classifyMovingAverageRegime, type MarketRegimeLabel } from '../utils/marketRegime.js'
import { buildVolumeSeries } from '../utils/volumeSeries'
import { buildLegendSnapshot } from '../utils/chartLegend'
import { getIndexStackOrder } from '../utils/indexOrder'

interface Bar {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

interface RsCompareRow {
  ticker: string
  ibdRating: number
  ibdGroupRank: number
  rsRaw: number | null
  ourRating: number | null
  ourRatingAdjusted: number | null
  delta: number | null
  adjustedDelta: number | null
  error?: string
}

interface RsCompareResponse {
  benchmark: string
  from: string
  to: string
  interval: string
  usedUniverse: boolean
  rows: RsCompareRow[]
  sampleSize: number
  universeSize: number
  warning: string | null
}

const TICKER_TO_LABEL: Record<string, string> = {
  '^GSPC': 'S&P 500',
  '^IXIC': 'NASDAQ',
  '^RUT': 'Russell 2000',
  '^VIX': 'VIX',
}

const TIMEFRAMES = [
  { label: '6M', days: 180 },
  { label: '1Y', days: 365 },
] as const
const MIN_DAYS_FOR_RSI = 365

/** Empty space to the right of the last bar, in bar widths (daily bars ≈ trading sessions). */
const INDEX_CHART_RIGHT_OFFSET_BARS = 7

const CHART_OPTIONS = {
  layout: { background: { type: ColorType.Solid, color: '#0f172a' }, textColor: '#94a3b8' },
  grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
  timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#334155' },
  rightPriceScale: { borderColor: '#334155' },
}

function toUnixTime(time: Time | undefined): number | null {
  return typeof time === 'number' ? time : null
}

function getRegimeTone(regime: MarketRegimeLabel): string {
  if (regime === 'Bullish' || regime === 'Mild Bullish') return 'text-emerald-300 bg-emerald-500/15 border-emerald-700/50'
  if (regime === 'Neutral') return 'text-yellow-300 bg-yellow-500/15 border-yellow-700/50'
  return 'text-red-100 bg-red-500/30 border-red-400/70' // Mild Bearish / Bearish: brighter for dark cards
}

function formatChange(value: number): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}`
}

function formatDelta(value: number | null): string {
  if (value == null) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value}`
}

export default function MarketIndexDetail() {
  const { ticker } = useParams<{ ticker: string }>()
  const navigate = useNavigate()
  const [timeframe, setTimeframe] = useState<(typeof TIMEFRAMES)[number]>(TIMEFRAMES[0])
  const [rsCompare, setRsCompare] = useState<{
    loading: boolean
    error: string | null
    data: RsCompareResponse | null
  }>({ loading: false, error: null, data: null })

  const label = ticker ? TICKER_TO_LABEL[ticker] ?? ticker : null

  useEffect(() => {
    if (ticker !== '^GSPC') {
      setRsCompare({ loading: false, error: null, data: null })
      return
    }
    let cancelled = false
    // Fetch once on entry so the comparison table is fast and consistent.
    setRsCompare((prev) => ({ ...prev, loading: true, error: null }))
    ;(async () => {
      try {
        const r = await fetch(`${API_BASE}/api/rs/ibd-compare`, { cache: 'no-store' })
        const text = await r.text()
        let payload: RsCompareResponse | { error?: string } | null = null
        if (text.trim()) {
          try {
            payload = JSON.parse(text)
          } catch {
            if (!r.ok) throw new Error(text.trim() || `HTTP ${r.status}`)
            throw new Error('Unexpected response format from API')
          }
        }
        if (!r.ok) {
          const message = (payload as { error?: string })?.error || text.trim() || `HTTP ${r.status}`
          throw new Error(message)
        }
        if ((payload as { error?: string })?.error) {
          throw new Error((payload as { error?: string }).error || 'Failed to load RS comparison')
        }
        if (!cancelled) {
          setRsCompare({ loading: false, error: null, data: payload as RsCompareResponse })
        }
      } catch (e) {
        if (cancelled) return
        setRsCompare({ loading: false, error: e instanceof Error ? e.message : 'Failed to load RS comparison', data: null })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ticker])

  if (!ticker) {
    return (
      <div className="p-6">
        <p className="text-slate-400">No index selected.</p>
        <Link to="/" className="text-sky-400 hover:underline mt-2 inline-block">
          ← Back to Dashboard
        </Link>
      </div>
    )
  }

  const orderedTickers = getIndexStackOrder(ticker, Object.keys(TICKER_TO_LABEL))

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <Link
            to="/"
            className="text-slate-400 hover:text-slate-200 transition-colors"
            aria-label="Back to Dashboard"
          >
            ← Back
          </Link>
          <h1 className="text-xl font-semibold text-slate-100">Market Indexes</h1>
          {label && (
            <span className="text-sm text-slate-500">Selected: {label}</span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex gap-1">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf.label}
                onClick={() => setTimeframe(tf)}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  timeframe.label === tf.label
                    ? 'bg-slate-600 text-slate-100'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {orderedTickers.map((itemTicker) => (
          <MarketIndexChart
            key={itemTicker}
            ticker={itemTicker}
            label={TICKER_TO_LABEL[itemTicker] ?? itemTicker}
            timeframe={timeframe}
            onErrorBack={() => navigate('/')}
          />
        ))}
      </div>

      {ticker === '^GSPC' && (
        <section className="mt-8 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-100">RS vs IBD (S&P 500)</h2>
              <p className="text-xs text-slate-500 mt-1">
                IBD RS is a percentile vs the full market. Our RS uses IBD-style weighted returns (3/6/9/12 months, 3m double weight)
                and is ranked vs the latest scan universe.
              </p>
            </div>
            {rsCompare.data && (
              <div className="text-xs text-slate-500">
                Universe: {rsCompare.data.usedUniverse ? `${rsCompare.data.universeSize} tickers` : 'sample-only'} •
                Range: {rsCompare.data.from} → {rsCompare.data.to}
              </div>
            )}
          </div>

          {rsCompare.loading ? (
            <div className="mt-4 text-sm text-slate-400">Loading RS comparison…</div>
          ) : rsCompare.error ? (
            <div className="mt-4 text-sm text-red-400">{rsCompare.error}</div>
          ) : rsCompare.data ? (
            <div className="mt-4 overflow-x-auto">
              {rsCompare.data.warning && (
                <div className="mb-3 rounded-md border border-amber-700/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  {rsCompare.data.warning}
                </div>
              )}
              <table className="w-full text-sm">
                <caption className="sr-only">RS comparison table for IBD sample tickers</caption>
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-800">
                    <th className="pb-2 pr-3" scope="col">Ticker</th>
                    <th className="pb-2 pr-3" scope="col">IBD RS</th>
                    <th className="pb-2 pr-3" scope="col">Group Rank</th>
                    <th className="pb-2 pr-3" scope="col">Our RS</th>
                    <th className="pb-2 pr-3" scope="col">Adjusted RS</th>
                    <th className="pb-2 pr-3" scope="col">Δ (IBD - Our)</th>
                    <th className="pb-2" scope="col">Δ Adjusted</th>
                  </tr>
                </thead>
                <tbody>
                  {rsCompare.data.rows.map((row) => (
                    <tr key={row.ticker} className="border-b border-slate-800/60 text-slate-200">
                      <td className="py-2 pr-3 font-medium">{row.ticker}</td>
                      <td className="py-2 pr-3">{row.ibdRating}</td>
                      <td className="py-2 pr-3">{row.ibdGroupRank}</td>
                      <td className="py-2 pr-3">{row.ourRating ?? '—'}</td>
                      <td className="py-2 pr-3">{row.ourRatingAdjusted ?? '—'}</td>
                      <td className="py-2 pr-3 text-slate-300">{formatDelta(row.delta)}</td>
                      <td className="py-2 text-slate-300">{formatDelta(row.adjustedDelta)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-4 text-sm text-slate-500">No RS comparison data.</div>
          )}
        </section>
      )}
    </div>
  )
}

function MarketIndexChart({
  ticker,
  label,
  timeframe,
  onErrorBack,
}: {
  ticker: string
  label: string
  timeframe: (typeof TIMEFRAMES)[number]
  onErrorBack: () => void
}) {
  const [bars, setBars] = useState<Bar[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [legend, setLegend] = useState<{
    time: number
    open: number
    high: number
    low: number
    close: number
    volume: number
    ma10: number | null
    ma20: number | null
    ma50: number | null
    volumeMa: number | null
  } | null>(null)
  const [tooltipVisible, setTooltipVisible] = useState(false)

  useEffect(() => {
    if (!ticker) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const { days } = timeframe
    const fetchDays = Math.max(days, MIN_DAYS_FOR_RSI)
    ;(async () => {
      try {
        const r = await fetch(`${API_BASE}/api/bars/${encodeURIComponent(ticker)}?days=${fetchDays}&interval=1d`, { cache: 'no-store' })
        const text = await r.text()
        let payload: { error?: string; results?: Bar[] } | null = null
        if (text.trim()) {
          try {
            payload = JSON.parse(text)
          } catch {
            // Keep readable diagnostics when a non-JSON response (e.g. HTML error page) is returned.
            if (!r.ok) throw new Error(text.trim() || `HTTP ${r.status}`)
            throw new Error('Unexpected response format from API')
          }
        }
        if (!r.ok) {
          const message = payload?.error || text.trim() || `HTTP ${r.status}`
          throw new Error(message)
        }
        if (payload?.error) throw new Error(payload.error)
        const raw = (payload?.results || []) as Bar[]
        if (!cancelled) setBars([...raw].sort((a, b) => a.t - b.t))
      } catch (e: unknown) {
        if (cancelled) return
        setBars([])
        setError(e instanceof Error ? e.message : 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ticker, timeframe])

  const {
    candleData,
    ma10Data,
    ma20Data,
    ma50Data,
    volumeData,
    volumeMaData,
    barsByTime,
    ma10ByTime,
    ma20ByTime,
    ma50ByTime,
    volumeMaByTime,
    latestLegend,
    latestClose,
    prevClose,
    latestDate,
    regime,
  } = useMemo(() => {
    const { days } = timeframe
    const displayCount = Math.ceil((days * 252) / 365)
    const displayedBars = bars.slice(-displayCount)
    if (displayedBars.length === 0) {
      return {
        candleData: [] as { time: number; open: number; high: number; low: number; close: number }[],
        ma10Data: [] as { time: number; value: number }[],
        ma20Data: [] as { time: number; value: number }[],
        ma50Data: [] as { time: number; value: number }[],
        volumeData: [] as { time: number; value: number; color: string }[],
        volumeMaData: [] as { time: number; value: number }[],
        barsByTime: new Map<number, Bar>(),
        ma10ByTime: new Map<number, number>(),
        ma20ByTime: new Map<number, number>(),
        ma50ByTime: new Map<number, number>(),
        volumeMaByTime: new Map<number, number>(),
        latestLegend: null as null | {
          time: number
          open: number
          high: number
          low: number
          close: number
          volume: number
          ma10: number | null
          ma20: number | null
          ma50: number | null
          volumeMa: number | null
        },
        latestClose: null as number | null,
        prevClose: null as number | null,
        latestDate: null as string | null,
        regime: 'Risk OFF' as MarketRegimeLabel,
      }
    }
    const displayCloses = displayedBars.map((b) => b.c)
    const sma10 = sma(displayCloses, 10)
    const sma20 = sma(displayCloses, 20)
    const sma50 = sma(displayCloses, 50)
    const toTime = (t: number) => Math.floor(t / 1000) as any
    const { volumeData, volumeMaData } = buildVolumeSeries(displayedBars, 20)
    const barsByTime = new Map<number, Bar>()
    const ma10ByTime = new Map<number, number>()
    const ma20ByTime = new Map<number, number>()
    const ma50ByTime = new Map<number, number>()
    const volumeMaByTime = new Map<number, number>()
    displayedBars.forEach((b, i) => {
      const time = toTime(b.t)
      barsByTime.set(time, b)
      if (sma10[i] != null) ma10ByTime.set(time, sma10[i] as number)
      if (sma20[i] != null) ma20ByTime.set(time, sma20[i] as number)
      if (sma50[i] != null) ma50ByTime.set(time, sma50[i] as number)
    })
    volumeMaData.forEach((d) => {
      if (d.value != null) volumeMaByTime.set(d.time, d.value)
    })
    const lastBar = displayedBars[displayedBars.length - 1]
    const prevBar = displayedBars[displayedBars.length - 2]
    const regime = classifyMovingAverageRegime({
      ma10: sma10[sma10.length - 1] ?? null,
      ma20: sma20[sma20.length - 1] ?? null,
      ma50: sma50[sma50.length - 1] ?? null,
      recentMa20: sma20.slice(-12),
      recentMa50: sma50.slice(-12),
    })
    const latestLegend = lastBar
      ? buildLegendSnapshot({
          time: toTime(lastBar.t),
          barsByTime,
          ma10ByTime,
          ma20ByTime,
          ma50ByTime,
          volumeMaByTime,
        })
      : null

    return {
      candleData: displayedBars.map((b) => ({ time: toTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c })),
      ma10Data: displayedBars.map((b, i) => ({ time: toTime(b.t), value: sma10[i] })).filter((d) => d.value != null) as { time: number; value: number }[],
      ma20Data: displayedBars.map((b, i) => ({ time: toTime(b.t), value: sma20[i] })).filter((d) => d.value != null) as { time: number; value: number }[],
      ma50Data: displayedBars.map((b, i) => ({ time: toTime(b.t), value: sma50[i] })).filter((d) => d.value != null) as { time: number; value: number }[],
      volumeData,
      volumeMaData,
      barsByTime,
      ma10ByTime,
      ma20ByTime,
      ma50ByTime,
      volumeMaByTime,
      latestLegend,
      latestClose: lastBar?.c ?? null,
      prevClose: prevBar?.c ?? null,
      latestDate: new Date(lastBar?.t ?? 0).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      regime,
    }
  }, [bars, timeframe])

  useEffect(() => {
    if (!containerRef.current || candleData.length === 0 || loading) return
    if (chartRef.current) {
      chartRef.current.remove()
      chartRef.current = null
    }
    const width = containerRef.current.clientWidth || 800
    const chart = createChart(containerRef.current, {
      ...CHART_OPTIONS,
      width,
      height: 420,
      rightPriceScale: {
        borderColor: '#334155',
        scaleMargins: { top: 0.1, bottom: 0.15 },
        mode: PriceScaleMode.Logarithmic,
      },
    })
    const candles = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      borderVisible: false,
    })
    candles.setData(candleData as any)
    const ma10Series = chart.addLineSeries({ color: '#f59e0b', lineWidth: 2, lastValueVisible: false, priceLineVisible: false, title: '10 MA' })
    const ma20Series = chart.addLineSeries({ color: '#38bdf8', lineWidth: 2, lastValueVisible: false, priceLineVisible: false, title: '20 MA' })
    const ma50Series = chart.addLineSeries({ color: '#a78bfa', lineWidth: 2, lastValueVisible: false, priceLineVisible: false, title: '50 MA' })
    ma10Series.setData(ma10Data as any)
    ma20Series.setData(ma20Data as any)
    ma50Series.setData(ma50Data as any)
    const volumeSeries = chart.addHistogramSeries({
      priceScaleId: 'volume',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
      title: 'Volume',
    })
    volumeSeries.setData(volumeData as any)
    const volumeMaSeries = chart.addLineSeries({
      priceScaleId: 'volume',
      color: '#a5b4fc',
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
      title: '20 Vol MA',
    })
    volumeMaSeries.setData(volumeMaData as any)
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.75, bottom: 0 },
      borderColor: '#334155',
    })
    chart.timeScale().fitContent()
    // Breathing room past the last candle so price labels don’t hug the right edge.
    chart.timeScale().applyOptions({ rightOffset: INDEX_CHART_RIGHT_OFFSET_BARS })
    chartRef.current = chart
    const handleCrosshairMove = (param: MouseEventParams<Time>) => {
      const unixTime = toUnixTime(param.time)
      if (!unixTime || !param?.point || !wrapperRef.current) {
        setLegend(latestLegend)
        setTooltipVisible(false)
        return
      }
      const snapshot = buildLegendSnapshot({
        time: unixTime,
        barsByTime,
        ma10ByTime,
        ma20ByTime,
        ma50ByTime,
        volumeMaByTime,
      })
      if (snapshot) setLegend(snapshot)

      const bounds = wrapperRef.current.getBoundingClientRect()
      const tooltipWidth = 220
      const tooltipHeight = 120
      const offsetX = 12
      const offsetY = 12
      const clampedX = Math.min(Math.max(param.point.x + offsetX, 8), bounds.width - tooltipWidth - 8)
      const clampedY = Math.min(Math.max(param.point.y + offsetY, 8), bounds.height - tooltipHeight - 8)
      if (tooltipRef.current) {
        tooltipRef.current.style.left = `${clampedX}px`
        tooltipRef.current.style.top = `${clampedY}px`
      }
      setTooltipVisible(true)
    }
    chart.subscribeCrosshairMove(handleCrosshairMove)
    const resizeObserver = new ResizeObserver(() => {
      const nextWidth = containerRef.current?.clientWidth || 800
      if (chartRef.current && nextWidth > 0) {
        chartRef.current.applyOptions({ width: nextWidth })
      }
    })
    resizeObserver.observe(containerRef.current)
    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove)
      resizeObserver.disconnect()
      chart.remove()
      chartRef.current = null
    }
  }, [
    candleData,
    ma10Data,
    ma20Data,
    ma50Data,
    volumeData,
    volumeMaData,
    barsByTime,
    ma10ByTime,
    ma20ByTime,
    ma50ByTime,
    volumeMaByTime,
    latestLegend,
    loading,
  ])

  useEffect(() => {
    setLegend(latestLegend)
  }, [latestLegend])

  const change = latestClose != null && prevClose != null ? latestClose - prevClose : null
  const changePct =
    latestClose != null && prevClose != null && prevClose !== 0
      ? ((latestClose - prevClose) / prevClose) * 100
      : null

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-4">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-slate-100">{label}</h2>
          {latestDate && (
            <span className="text-xs text-slate-500">{latestDate}</span>
          )}
          {!loading && !error && (
            <div className={`inline-flex px-2 py-1 rounded border text-xs font-medium ${getRegimeTone(regime)}`}>
              {regime}
            </div>
          )}
        </div>
        {change != null && changePct != null && (
          <div className={`text-xs font-medium ${change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {formatChange(change)} ({formatChange(changePct)}%)
          </div>
        )}
      </div>

      {loading ? (
        <div className="h-[420px] flex items-center justify-center text-slate-500">Loading…</div>
      ) : error ? (
        <div className="h-[420px] flex flex-col items-center justify-center text-red-400 gap-4">
          <p>{error}</p>
          <button
            onClick={onErrorBack}
            className="text-sky-400 hover:underline"
          >
            Back to Dashboard
          </button>
        </div>
      ) : (
        <div ref={wrapperRef} className="relative h-[420px]">
          <div ref={containerRef} className="absolute inset-0" />
          {legend && (
            <div className="absolute left-3 top-3 z-10 rounded-md border border-slate-700/60 bg-slate-950/80 px-3 py-2 text-xs text-slate-200 backdrop-blur">
              <div className="text-xs text-slate-400">
                {new Date(legend.time * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </div>
              <div className="mt-1 flex gap-3">
                <span>O {legend.open.toFixed(2)}</span>
                <span>H {legend.high.toFixed(2)}</span>
                <span>L {legend.low.toFixed(2)}</span>
                <span>C {legend.close.toFixed(2)}</span>
              </div>
              <div className="mt-1 flex gap-3 text-slate-300">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
                  10MA {legend.ma10 != null ? legend.ma10.toFixed(2) : '—'}
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-sky-400" />
                  20MA {legend.ma20 != null ? legend.ma20.toFixed(2) : '—'}
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full bg-violet-400" />
                  50MA {legend.ma50 != null ? legend.ma50.toFixed(2) : '—'}
                </span>
              </div>
              <div className="mt-1 flex gap-3 text-slate-300">
                <span>Vol {legend.volume.toLocaleString()}</span>
                <span>VolMA {legend.volumeMa != null ? legend.volumeMa.toFixed(0) : '—'}</span>
              </div>
            </div>
          )}
          {legend && tooltipVisible && (
            <div
              ref={tooltipRef}
              className="absolute z-20 w-[220px] rounded-md border border-slate-700/60 bg-slate-950/90 px-3 py-2 text-xs text-slate-100 shadow-lg backdrop-blur"
            >
              <div className="text-xs text-slate-400">
                {new Date(legend.time * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </div>
              <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
                <span>O {legend.open.toFixed(2)}</span>
                <span>H {legend.high.toFixed(2)}</span>
                <span>L {legend.low.toFixed(2)}</span>
                <span>C {legend.close.toFixed(2)}</span>
                <span>10MA {legend.ma10 != null ? legend.ma10.toFixed(2) : '—'}</span>
                <span>20MA {legend.ma20 != null ? legend.ma20.toFixed(2) : '—'}</span>
                <span>50MA {legend.ma50 != null ? legend.ma50.toFixed(2) : '—'}</span>
                <span>Vol {legend.volume.toLocaleString()}</span>
                <span>VolMA {legend.volumeMa != null ? legend.volumeMa.toFixed(0) : '—'}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
