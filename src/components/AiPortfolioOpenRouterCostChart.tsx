import { useEffect, useRef } from 'react'
import { ColorType, createChart, type HistogramData, type Time } from 'lightweight-charts'

export type OpenRouterDailyCostRow = {
  date: string
  costUsd: number
  byManager?: Record<string, number>
}

type Props = {
  rows: OpenRouterDailyCostRow[]
}

/**
 * Histogram of billed OpenRouter USD per calendar day (from API `usage.cost` on each manager call).
 */
export function AiPortfolioOpenRouterCostChart({ rows }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el || rows.length === 0) return

    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date))
    const chart = createChart(el, {
      width: el.clientWidth,
      height: 220,
      layout: {
        background: { type: ColorType.Solid, color: '#0f172a' },
        textColor: '#94a3b8',
      },
      grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
      rightPriceScale: { borderColor: '#334155' },
      timeScale: { borderColor: '#334155' },
    })
    chartRef.current = chart

    const series = chart.addHistogramSeries({
      color: '#38bdf8',
      priceFormat: {
        type: 'custom',
        minMove: 0.000001,
        formatter: (price: number) =>
          price >= 0.01 ? `$${price.toFixed(3)}` : `$${price.toFixed(6)}`,
      },
    })

    const data: HistogramData<Time>[] = sorted.map((r) => ({
      time: r.date as Time,
      value: Math.max(0, Number(r.costUsd) || 0),
      color: '#38bdf8',
    }))
    series.setData(data)
    chart.timeScale().fitContent()

    const ro = new ResizeObserver(() => {
      if (!containerRef.current || !chartRef.current) return
      chartRef.current.applyOptions({ width: containerRef.current.clientWidth })
    })
    ro.observe(el)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
    }
  }, [rows])

  if (rows.length === 0) {
    return (
      <p className="text-sm text-slate-500 leading-relaxed">
        No OpenRouter spend recorded yet. After each daily cycle with{' '}
        <code className="text-slate-400">AI_PORTFOLIO_LLM_PROVIDER=openrouter</code>, we store the billed amount from
        OpenRouter&apos;s <code className="text-slate-400">usage.cost</code> field when present.
      </p>
    )
  }

  return <div ref={containerRef} className="w-full h-[220px] rounded-lg border border-slate-700 overflow-hidden bg-slate-950/40" />
}
