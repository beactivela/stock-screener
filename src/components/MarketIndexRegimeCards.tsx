import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ColorType, createChart } from 'lightweight-charts'
import { API_BASE } from '../utils/api'
import { sma } from '../utils/chartIndicators'
import { classifyMovingAverageRegime, type MarketRegimeLabel } from '../utils/marketRegime.js'
import { BREADTH_TREND_SEGMENTS, getBreadthTrendRatingFromRecentMa50 } from '../utils/breadthTrendRating.js'
import { computePowerTrendSignal } from '../utils/marketStructureIndicators.ts'
import { getVixSentimentBand, vixSentimentTone } from '../utils/vixSentiment'
import MarketStructureIndicatorsStrip from './MarketStructureIndicatorsStrip'

interface Bar {
  t: number
  o: number
  h: number
  l: number
  c: number
}

interface IndexConfig {
  label: string
  ticker: string
  chartTicker?: string
  /** Equity index cards show MA regime + breadth; VIX shows fear badge only (no breadth strip). */
  variant?: 'equity' | 'vix'
}

const INDEXES: IndexConfig[] = [
  { label: 'S&P 500', ticker: '^GSPC', chartTicker: 'ES=F' },
  { label: 'NASDAQ', ticker: '^IXIC' },
  { label: 'RUSSEL 2000', ticker: '^RUT' },
  { label: 'VIX', ticker: '^VIX', variant: 'vix' },
]

const CHART_OPTIONS = {
  layout: { background: { type: ColorType.Solid, color: '#0f172a' }, textColor: '#94a3b8' },
  grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
  timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#334155' },
  rightPriceScale: { borderColor: '#334155' },
}

/** Empty space past the last daily bar on dashboard mini charts (bar widths ≈ sessions). */
const DASHBOARD_INDEX_RIGHT_OFFSET_BARS = 5

/** Mini chart height in px — keep dashboard index row visually light. */
const DASHBOARD_INDEX_CHART_HEIGHT = 132

function getRegimeTone(regime: MarketRegimeLabel): string {
  if (regime === 'Risk ON') return 'text-emerald-950 bg-emerald-300 border-emerald-100'
  return 'text-red-100 bg-red-500/30 border-red-400/70'
}

function formatChange(value: number): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}`
}

function MarketIndexCard({ config }: { config: IndexConfig }) {
  const isVix = config.variant === 'vix'
  const [bars, setBars] = useState<Bar[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const chartTicker = config.chartTicker ?? config.ticker
        const r = await fetch(`${API_BASE}/api/bars/${encodeURIComponent(chartTicker)}?days=365&interval=1d`, { cache: 'no-store' })
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
  }, [config.ticker])

  const {
    candleData,
    ma10Data,
    ma20Data,
    ma50Data,
    latestClose,
    prevClose,
    latestDate,
    ma10Last,
    ma20Last,
    ma50Last,
    regime,
    breadthRating,
    powerTrendTriggered,
  } = useMemo(() => {
    if (bars.length === 0) {
      return {
        candleData: [],
        ma10Data: [],
        ma20Data: [],
        ma50Data: [],
        latestClose: null as number | null,
        prevClose: null as number | null,
        latestDate: null as string | null,
        ma10Last: null as number | null,
        ma20Last: null as number | null,
        ma50Last: null as number | null,
        regime: 'Risk OFF' as MarketRegimeLabel,
        breadthRating: getBreadthTrendRatingFromRecentMa50([]),
        powerTrendTriggered: false,
      }
    }

    const closes = bars.map((b) => b.c)
    const sma10 = sma(closes, 10)
    const sma20 = sma(closes, 20)
    const sma50 = sma(closes, 50)
    const toTime = (t: number) => Math.floor(t / 1000) as any
    const ma10Last = sma10[sma10.length - 1] ?? null
    const ma20Last = sma20[sma20.length - 1] ?? null
    const ma50Last = sma50[sma50.length - 1] ?? null
    const lastBar = bars[bars.length - 1]
    const prevBar = bars[bars.length - 2]

    const regime = classifyMovingAverageRegime({
      close: lastBar?.c ?? null,
      ma10: ma10Last,
      ma20: ma20Last,
      ma50: ma50Last,
      recentMa20: sma20.slice(-12),
      recentMa50: sma50.slice(-12),
    })
    const breadthRating = getBreadthTrendRatingFromRecentMa50(sma50.slice(-10))
    const powerTrendTriggered = config.ticker === '^GSPC' && computePowerTrendSignal(bars).triggered

    return {
      candleData: bars.map((b) => ({ time: toTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c })),
      ma10Data: bars.map((b, i) => ({ time: toTime(b.t), value: sma10[i] })).filter((d) => d.value != null) as { time: number; value: number }[],
      ma20Data: bars.map((b, i) => ({ time: toTime(b.t), value: sma20[i] })).filter((d) => d.value != null) as { time: number; value: number }[],
      ma50Data: bars.map((b, i) => ({ time: toTime(b.t), value: sma50[i] })).filter((d) => d.value != null) as { time: number; value: number }[],
      latestClose: lastBar?.c ?? null,
      prevClose: prevBar?.c ?? null,
      latestDate: new Date(lastBar?.t ?? 0).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      ma10Last,
      ma20Last,
      ma50Last,
      regime,
      breadthRating,
      powerTrendTriggered,
    }
  }, [bars, config.ticker])

  const displayedBreadthRating = useMemo(() => {
    if (regime !== 'Risk ON' || breadthRating.score >= 6) return breadthRating
    const bullishSegment = BREADTH_TREND_SEGMENTS.find((segment) => segment.score === 6)
    if (!bullishSegment) return breadthRating
    return {
      ...breadthRating,
      score: bullishSegment.score,
      label: bullishSegment.label,
      exposureLabel: bullishSegment.exposureLabel,
      exposurePercentage: bullishSegment.exposurePercentage,
    }
  }, [breadthRating, regime])

  useEffect(() => {
    if (!containerRef.current || candleData.length === 0 || loading) return
    if (chartRef.current) {
      chartRef.current.remove()
      chartRef.current = null
    }

    const width = containerRef.current.clientWidth || 320
    const chart = createChart(containerRef.current, {
      ...CHART_OPTIONS,
      width,
      height: DASHBOARD_INDEX_CHART_HEIGHT,
      rightPriceScale: { borderColor: '#334155', scaleMargins: { top: 0.1, bottom: 0.15 } },
    })

    const candles = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      borderVisible: false,
    })
    candles.setData(candleData as any)

    const ma10Series = chart.addLineSeries({ color: '#f59e0b', lineWidth: 1, lastValueVisible: false, priceLineVisible: false })
    const ma20Series = chart.addLineSeries({ color: '#38bdf8', lineWidth: 1, lastValueVisible: false, priceLineVisible: false })
    const ma50Series = chart.addLineSeries({ color: '#a78bfa', lineWidth: 1, lastValueVisible: false, priceLineVisible: false })
    ma10Series.setData(ma10Data as any)
    ma20Series.setData(ma20Data as any)
    ma50Series.setData(ma50Data as any)

    chart.timeScale().fitContent()
    chart.timeScale().applyOptions({ rightOffset: DASHBOARD_INDEX_RIGHT_OFFSET_BARS })
    chartRef.current = chart

    const resizeObserver = new ResizeObserver(() => {
      const nextWidth = containerRef.current?.clientWidth || 320
      if (chartRef.current && nextWidth > 0) {
        chartRef.current.applyOptions({ width: nextWidth })
      }
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      chart.remove()
      chartRef.current = null
    }
  }, [candleData, ma10Data, ma20Data, ma50Data, loading])

  const change = latestClose != null && prevClose != null ? latestClose - prevClose : null
  const changePct = latestClose != null && prevClose != null && prevClose !== 0
    ? ((latestClose - prevClose) / prevClose) * 100
    : null

  const vixSentiment = isVix ? getVixSentimentBand(latestClose) : null

  return (
    <Link
      to={`/market-index/${encodeURIComponent(config.ticker)}`}
      className="block min-w-0 rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden hover:border-slate-600 hover:bg-slate-900/70 transition-colors cursor-pointer"
    >
      <div className="flex items-start justify-between gap-2 px-3 py-2 border-b border-slate-800 text-sm">
        <div className="flex items-start gap-2 min-w-0">
          <span className="text-slate-400 uppercase tracking-wide shrink-0">{config.label}</span>
          <span className="text-slate-500 shrink-0">{latestDate ?? ''}</span>
          {isVix ? (
            vixSentiment ? (
              <span
                className={`inline-flex shrink-0 px-2 py-0.5 rounded border font-medium ${vixSentimentTone(vixSentiment.band)}`}
                title="Risk ON when VIX is below 20; Risk OFF when VIX is 20 or higher"
              >
                {latestClose != null ? latestClose.toFixed(2) : '—'}
              </span>
            ) : (
              <span className="inline-flex shrink-0 px-2 py-0.5 rounded border border-slate-700 text-slate-500 font-medium">
                —
              </span>
            )
          ) : (
            <div className="flex min-w-0 flex-col items-start gap-1">
              <span className={`inline-flex shrink-0 px-2 py-0.5 rounded border font-medium ${getRegimeTone(regime)}`}>
                {regime}
              </span>
              {powerTrendTriggered && (
                <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-300">
                  Power Trend
                </span>
              )}
            </div>
          )}
        </div>
        {change != null && changePct != null && (
          <div className={`font-medium shrink-0 ${change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {formatChange(change)} ({formatChange(changePct)}%)
          </div>
        )}
      </div>

      {loading ? (
        <div
          className="flex items-center justify-center text-slate-500 text-sm"
          style={{ height: DASHBOARD_INDEX_CHART_HEIGHT }}
        >
          Loading…
        </div>
      ) : error ? (
        <div
          className="flex items-center justify-center text-red-400 text-sm px-3 text-center"
          style={{ height: DASHBOARD_INDEX_CHART_HEIGHT }}
        >
          {error}
        </div>
      ) : (
        <div ref={containerRef} style={{ height: DASHBOARD_INDEX_CHART_HEIGHT }} />
      )}

      {!isVix && (
        <div className="px-3 py-2 border-t border-b border-slate-800">
          <div className="mb-1 flex items-center justify-between gap-2 text-xs">
            <span className="text-slate-400">Portfolio allocation in market</span>
            <div className="text-right leading-tight">
                <div className="font-medium text-slate-200">
                  {displayedBreadthRating.label} ({displayedBreadthRating.score}/7)
                </div>
                <div className="text-slate-400">
                  Market exposure: {displayedBreadthRating.exposureLabel} {displayedBreadthRating.exposurePercentage}%
                </div>
              </div>
          </div>
          <div
            className="grid grid-cols-7 overflow-hidden rounded-sm border-2 border-slate-500"
            aria-label={`Portfolio allocation in market ${displayedBreadthRating.score} of 7 (${displayedBreadthRating.label}), market exposure ${displayedBreadthRating.exposurePercentage}%`}
          >
            {BREADTH_TREND_SEGMENTS.map((segment) => {
              const isActive = segment.score === displayedBreadthRating.score
              return (
                <div
                  key={segment.score}
                  className={`${segment.className} ${
                    isActive ? 'border-2 border-slate-100 opacity-100' : 'border border-slate-900/40 opacity-40'
                  } flex min-h-[28px] items-center justify-center px-1 text-center text-xs font-semibold leading-none`}
                  title={`${segment.score}/7 ${segment.label} - ${segment.exposureLabel} ${segment.exposurePercentage}%`}
                >
                  {segment.exposurePercentage}%
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className={`px-3 py-2 space-y-1.5 ${isVix ? 'border-t border-slate-800' : ''}`}>
        <div className="text-xs text-slate-300">Default range: last 12 months</div>
        <div className="text-xs text-slate-500">
          10 MA {ma10Last != null ? ma10Last.toFixed(1) : '—'} · 20 MA {ma20Last != null ? ma20Last.toFixed(1) : '—'} · 50 MA{' '}
          {ma50Last != null ? ma50Last.toFixed(1) : '—'}
        </div>
      </div>
    </Link>
  )
}

export default function MarketIndexRegimeCards() {
  return (
    <section className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {INDEXES.map((cfg) => (
          <MarketIndexCard key={cfg.ticker} config={cfg} />
        ))}
      </div>
      <MarketStructureIndicatorsStrip />
    </section>
  )
}
