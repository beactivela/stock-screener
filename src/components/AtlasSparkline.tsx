import { useEffect, useRef } from 'react'
import { ColorType, createChart } from 'lightweight-charts'

export interface AtlasSparklinePoint {
  time: string
  value: number
}

const HEIGHT = 112

const CHART_OPTIONS = {
  layout: { background: { type: ColorType.Solid, color: '#0f172a' }, textColor: '#94a3b8' },
  grid: { vertLines: { visible: false }, horzLines: { color: '#1e293b55' } },
  timeScale: { visible: false, borderVisible: false },
  rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.15, bottom: 0.15 } },
  crosshair: { vertLine: { visible: false }, horzLine: { visible: false } },
  handleScroll: false,
  handleScale: false,
}

interface AtlasSparklineProps {
  points: AtlasSparklinePoint[]
}

/** Compact portfolio value sparkline (ATLAS backtest trajectory). */
export default function AtlasSparkline({ points }: AtlasSparklineProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el || points.length === 0) return

    if (chartRef.current) {
      chartRef.current.remove()
      chartRef.current = null
    }

    const width = el.clientWidth || 400
    const chart = createChart(el, {
      ...CHART_OPTIONS,
      width,
      height: HEIGHT,
    })

    const series = chart.addLineSeries({
      color: '#38bdf8',
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    })

    series.setData(
      points.map((p) => ({
        time: p.time as import('lightweight-charts').Time,
        value: p.value,
      })),
    )
    chart.timeScale().fitContent()
    chartRef.current = chart

    const ro = new ResizeObserver(() => {
      const w = el.clientWidth
      if (chartRef.current && w > 0) chartRef.current.applyOptions({ width: w })
    })
    ro.observe(el)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
    }
  }, [points])

  if (points.length === 0) return null

  return <div ref={containerRef} className="w-full min-h-[112px] rounded-lg border border-slate-700/80 bg-slate-950/40" />
}
