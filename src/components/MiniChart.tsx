/**
 * 500×400 price chart with 10/20/50/150 MA and volume.
 * Used on the "Tickers by industry" page next to each ticker row.
 */
import { useEffect, useRef, useState } from 'react'
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

const WIDTH = 500
const HEIGHT = 400

const CHART_OPTIONS = {
  layout: { background: { type: ColorType.Solid, color: '#0f172a' }, textColor: '#94a3b8' },
  grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
  timeScale: { timeVisible: true, secondsVisible: false },
  rightPriceScale: { borderColor: '#334155' },
}

interface MiniChartProps {
  ticker: string
  loadWhenVisible?: boolean
}

export default function MiniChart({ ticker, loadWhenVisible = false }: MiniChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null)
  const [shouldLoad, setShouldLoad] = useState(!loadWhenVisible)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>(loadWhenVisible ? 'idle' : 'loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    setShouldLoad(!loadWhenVisible)
    setStatus(loadWhenVisible ? 'idle' : 'loading')
    setErrorMsg(null)
  }, [loadWhenVisible, ticker])

  useEffect(() => {
    if (!loadWhenVisible || shouldLoad) return
    const node = containerRef.current
    if (!node) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoad(true)
          observer.disconnect()
        }
      },
      { rootMargin: '350px 0px' },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [loadWhenVisible, shouldLoad, ticker])

  useEffect(() => {
    if (!ticker || !shouldLoad) return

    setStatus('loading')
    setErrorMsg(null)

    const url = `${API_BASE}/api/bars/${encodeURIComponent(ticker)}?days=365&interval=1d`
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (data?.error) {
          setStatus('error')
          setErrorMsg(data.error)
          return
        }
        const raw: Bar[] = data?.results ?? []
        if (raw.length === 0) {
          setStatus('error')
          setErrorMsg('No data')
          return
        }
        const sorted = [...raw].sort((a, b) => a.t - b.t)
        const closes = sorted.map((b) => Number(b.c) || 0)
        const sma10 = sma(closes, 10)
        const sma20 = sma(closes, 20)
        const sma50 = sma(closes, 50)
        const sma150 = sma(closes, 150)
        const toTime = (t: number) => Math.floor(t / 1000) as any

        const candleData = sorted.map((b) => ({
          time: toTime(b.t),
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
        }))
        const volumeData = sorted.map((b) => ({
          time: toTime(b.t),
          value: b.v,
          color: b.c >= b.o ? '#22c55e' : '#ef4444',
        }))
        const ma10Data = sorted
          .map((b, i) => ({ time: toTime(b.t), value: sma10[i] }))
          .filter((d) => d.value != null) as { time: number; value: number }[]
        const ma20Data = sorted
          .map((b, i) => ({ time: toTime(b.t), value: sma20[i] }))
          .filter((d) => d.value != null) as { time: number; value: number }[]
        const ma50Data = sorted
          .map((b, i) => ({ time: toTime(b.t), value: sma50[i] }))
          .filter((d) => d.value != null) as { time: number; value: number }[]
        const ma150Data = sorted
          .map((b, i) => ({ time: toTime(b.t), value: sma150[i] }))
          .filter((d) => d.value != null) as { time: number; value: number }[]

        const container = containerRef.current
        if (!container) return
        if (chartRef.current) {
          chartRef.current.remove()
          chartRef.current = null
        }

        const chart = createChart(container, {
          ...CHART_OPTIONS,
          width: WIDTH,
          height: HEIGHT,
          rightPriceScale: { borderColor: '#334155', minimumWidth: 40 },
        })

        const candle = chart.addCandlestickSeries({
          upColor: '#22c55e',
          downColor: '#ef4444',
          borderVisible: false,
        })
        candle.setData(candleData)

        const volumeSeries = chart.addHistogramSeries({
          priceFormat: { type: 'volume' },
          priceScaleId: '',
        })
        volumeSeries.priceScale().applyOptions({
          scaleMargins: { top: 0.8, bottom: 0 },
          borderVisible: false,
        })
        volumeSeries.setData(volumeData as any)

        const ma10Series = chart.addLineSeries({
          color: '#f59e0b',
          lineWidth: 1,
          lastValueVisible: false,
          priceLineVisible: false,
        })
        const ma20Series = chart.addLineSeries({
          color: '#3b82f6',
          lineWidth: 1,
          lastValueVisible: false,
          priceLineVisible: false,
        })
        const ma50Series = chart.addLineSeries({
          color: '#8b5cf6',
          lineWidth: 1,
          lastValueVisible: false,
          priceLineVisible: false,
        })
        const ma150Series = chart.addLineSeries({
          color: '#ec4899',
          lineWidth: 1,
          lastValueVisible: false,
          priceLineVisible: false,
        })
        ma10Series.setData(ma10Data as any)
        ma20Series.setData(ma20Data as any)
        ma50Series.setData(ma50Data as any)
        ma150Series.setData(ma150Data as any)

        chartRef.current = chart
        setStatus('ok')
      })
      .catch((e) => {
        setStatus('error')
        setErrorMsg(e?.message ?? 'Failed to load')
      })

    return () => {
      if (chartRef.current) {
        chartRef.current.remove()
        chartRef.current = null
      }
    }
  }, [shouldLoad, ticker])

  // Chart container must always be in the DOM so ref is set when fetch completes.
  return (
    <div className="relative rounded border border-slate-700" style={{ width: WIDTH, height: HEIGHT }}>
      <div ref={containerRef} className="rounded" style={{ width: WIDTH, height: HEIGHT }} />
      {status === 'loading' && (
        <div
          className="absolute inset-0 flex items-center justify-center rounded bg-slate-900/50 text-slate-500 text-xs"
          style={{ width: WIDTH, height: HEIGHT }}
        >
          Loading…
        </div>
      )}
      {status === 'idle' && (
        <div
          className="absolute inset-0 flex items-center justify-center rounded bg-slate-900/50 text-slate-500 text-xs"
          style={{ width: WIDTH, height: HEIGHT }}
        >
          Scroll to load
        </div>
      )}
      {status === 'error' && (
        <div
          className="absolute inset-0 flex items-center justify-center rounded bg-slate-900/50 text-red-400 text-xs"
          style={{ width: WIDTH, height: HEIGHT }}
          title={errorMsg ?? undefined}
        >
          {errorMsg ?? 'Error'}
        </div>
      )}
    </div>
  )
}
