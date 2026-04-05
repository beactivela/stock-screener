/**
 * Compact chart for a single ticker: 6 months of data with 10/20/50/150 MAs.
 * Used in Dashboard's "View as charts" grid.
 * Memoized to avoid re-renders when parent (Dashboard) updates.
 */
import { useEffect, useRef, useMemo, useState, memo } from 'react'
import { Link } from 'react-router-dom'
import { createChart, ColorType } from 'lightweight-charts'
import { sma } from '../utils/chartIndicators'
import { API_BASE } from '../utils/api'

interface Bar {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

const CHART_OPTIONS = {
  layout: { background: { type: ColorType.Solid, color: '#0f172a' }, textColor: '#94a3b8' },
  grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
  timeScale: { timeVisible: true, secondsVisible: false },
  rightPriceScale: { borderColor: '#334155' },
}

interface TickerChartProps {
  ticker: string
  score?: number
  recommendation?: 'buy' | 'hold' | 'avoid'
}

function TickerChart({ ticker, score, recommendation }: TickerChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null)
  const [bars, setBars] = useState<Bar[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Fetch 6 months of daily bars
  useEffect(() => {
    if (!ticker) return
    setLoading(true)
    setError(null)
    fetch(`${API_BASE}/api/bars/${encodeURIComponent(ticker)}?days=180&interval=1d`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((res) => {
        if (res.error) throw new Error(res.error)
        const raw = res.results || []
        setBars([...raw].sort((a: Bar, b: Bar) => a.t - b.t))
      })
      .catch((e) => {
        setBars([])
        setError(e instanceof Error ? e.message : 'Failed to load')
      })
      .finally(() => setLoading(false))
  }, [ticker])

  const { candleData, ma10Data, ma20Data, ma50Data, ma150Data, volumeData } = useMemo(() => {
    if (bars.length === 0) return { candleData: [], ma10Data: [], ma20Data: [], ma50Data: [], ma150Data: [], volumeData: [] }
    const sorted = [...bars].sort((a, b) => a.t - b.t)
    const closes = sorted.map((b) => Number(b.c) || 0)
    const sma10 = sma(closes, 10)
    const sma20 = sma(closes, 20)
    const sma50 = sma(closes, 50)
    const sma150 = sma(closes, 150)
    const toTime = (t: number) => Math.floor(t / 1000) as any
    return {
      candleData: sorted.map((b) => ({ time: toTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c })),
      ma10Data: sorted.map((b, i) => ({ time: toTime(b.t), value: sma10[i] })).filter((d) => d.value != null) as { time: number; value: number }[],
      ma20Data: sorted.map((b, i) => ({ time: toTime(b.t), value: sma20[i] })).filter((d) => d.value != null) as { time: number; value: number }[],
      ma50Data: sorted.map((b, i) => ({ time: toTime(b.t), value: sma50[i] })).filter((d) => d.value != null) as { time: number; value: number }[],
      ma150Data: sorted.map((b, i) => ({ time: toTime(b.t), value: sma150[i] })).filter((d) => d.value != null) as { time: number; value: number }[],
      volumeData: sorted.map((b) => ({ time: toTime(b.t), value: b.v ?? 0, color: b.c >= b.o ? '#22c55e' : '#ef4444' })),
    }
  }, [bars])

  useEffect(() => {
    if (!containerRef.current || bars.length === 0 || loading) return
    if (chartRef.current) {
      chartRef.current.remove()
      chartRef.current = null
    }

    const w = containerRef.current.clientWidth ?? 0
    if (w <= 0) return

    const chart = createChart(containerRef.current, {
      ...CHART_OPTIONS,
      width: w,
      height: 240,
      rightPriceScale: { borderColor: '#334155', scaleMargins: { top: 0.15, bottom: 0.25 } },
    })

    const dedupeByTime = <T extends { time: unknown }>(arr: T[]) => {
      const sorted = [...arr].sort((a, b) => (a.time as number) - (b.time as number))
      return sorted.reduce<T[]>((acc, d) => {
        if (acc.length === 0 || (acc[acc.length - 1].time as number) < (d.time as number)) acc.push(d)
        else if ((acc[acc.length - 1].time as number) === (d.time as number)) acc[acc.length - 1] = d
        return acc
      }, [])
    }

    const candle = chart.addCandlestickSeries({ upColor: '#22c55e', downColor: '#ef4444', borderVisible: false })
    candle.setData(dedupeByTime(candleData) as any)

    // Volume histogram at bottom (green/red by candle direction)
    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    })
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.75, bottom: 0 },
      borderVisible: false,
    })
    volumeSeries.setData(dedupeByTime(volumeData) as any)

    const ma10Series = chart.addLineSeries({ color: '#f59e0b', lineWidth: 1, lastValueVisible: false, priceLineVisible: false })
    const ma20Series = chart.addLineSeries({ color: '#3b82f6', lineWidth: 1, lastValueVisible: false, priceLineVisible: false })
    const ma50Series = chart.addLineSeries({ color: '#8b5cf6', lineWidth: 1, lastValueVisible: false, priceLineVisible: false })
    const ma150Series = chart.addLineSeries({ color: '#ec4899', lineWidth: 1, lastValueVisible: false, priceLineVisible: false })
    ma10Series.setData(dedupeByTime(ma10Data) as any)
    ma20Series.setData(dedupeByTime(ma20Data) as any)
    ma50Series.setData(dedupeByTime(ma50Data) as any)
    ma150Series.setData(dedupeByTime(ma150Data) as any)

    chart.timeScale().fitContent()

    chartRef.current = chart

    const resize = () => {
      const w = containerRef.current?.clientWidth ?? 0
      if (w > 0) chart.applyOptions({ width: w })
    }
    const ro = new ResizeObserver(resize)
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
    }
  }, [bars, candleData, ma10Data, ma20Data, ma50Data, ma150Data, volumeData, loading])

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 min-h-[240px] flex items-center justify-center">
        <span className="text-slate-500 text-sm">Loading {ticker}…</span>
      </div>
    )
  }

  if (error || bars.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 min-h-[240px] flex flex-col items-center justify-center gap-2">
        <Link to={`/stock/${ticker}`} className="text-sky-400 hover:text-sky-300 font-medium">
          {ticker}
        </Link>
        <span className="text-amber-400/90 text-sm">{error ?? 'No data'}</span>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 bg-slate-900/80">
        <Link to={`/stock/${ticker}`} className="text-sky-400 hover:text-sky-300 font-medium">
          {ticker}
        </Link>
        <div className="flex items-center gap-2">
          {score != null && (
            <span className="text-slate-400 text-sm tabular-nums">{score}/100</span>
          )}
          {recommendation === 'buy' && (
            <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-emerald-500/20 text-emerald-400">Buy</span>
          )}
          {recommendation === 'hold' && (
            <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-amber-500/20 text-amber-400">Hold</span>
          )}
          {recommendation === 'avoid' && (
            <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-slate-600 text-slate-400">Avoid</span>
          )}
        </div>
      </div>
      <div ref={containerRef} style={{ height: 240 }} />
      <div className="px-3 py-1.5 text-xs text-slate-500 border-t border-slate-800 flex gap-3">
        <span>Vol</span>
        <span>10 MA</span>
        <span>20 MA</span>
        <span>50 MA</span>
        <span>150 MA</span>
      </div>
    </div>
  )
}

export default memo(TickerChart)
