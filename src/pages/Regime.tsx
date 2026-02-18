/**
 * Regime (HMM) page: separate SPY and QQQ analysis, forward predictions, 5-year data/plot, and backtest.
 * Data from GET /api/regime, GET /api/regime/backtest, GET /api/regime/bars/:ticker.
 */

import { useEffect, useState, useRef, useMemo } from 'react'
import { createChart, ColorType } from 'lightweight-charts'
import { API_BASE } from '../utils/api'

interface Bar5y {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

interface BacktestMetrics {
  whenBull: { count: number; avgForward1dPct: number | null; avgForward5dPct: number | null; avgForward21dPct: number | null }
  whenBear: { count: number; avgForward1dPct: number | null; avgForward5dPct: number | null; avgForward21dPct: number | null }
  correlation1d: number | null
  correlation5d: number | null
  correlation21d: number | null
  totalDays: number
}

interface BacktestTicker {
  ticker: string
  updatedAt: string
  fullHistory: Array<{ date: string; regime: string; state: number }>
  metrics: BacktestMetrics
}

interface BacktestApiResponse {
  spy: BacktestTicker | null
  qqq: BacktestTicker | null
}

interface RegimeHistoryItem {
  date: string
  regime: string
}

interface RegimePrediction {
  bull: number
  bear: number
  mostLikely: string
}

interface PredictionBlock {
  nextDay?: RegimePrediction
  day5?: RegimePrediction
  day14?: RegimePrediction
}

interface TickerRegime {
  ticker: string
  regime: string
  regimeIndex: number
  updatedAt: string
  history: RegimeHistoryItem[]
  prediction?: PredictionBlock
}

interface RegimeApiResponse {
  spy: TickerRegime | null
  qqq: TickerRegime | null
}

function TickerSection({ label, data }: { label: string; data: TickerRegime }) {
  const isBull = data.regime === 'bull'
  const historyReversed = [...(data.history || [])].reverse()
  const pred = data.prediction

  return (
    <section className="space-y-4 rounded-lg border border-slate-700 bg-slate-800/30 p-6">
      <h2 className="text-xl font-semibold text-slate-100">{label}</h2>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className={`rounded border p-3 ${isBull ? 'border-emerald-700/60 bg-emerald-950/20' : 'border-rose-700/60 bg-rose-950/20'}`}>
          <div className="text-xs text-slate-400">Current regime</div>
          <div className={`font-semibold capitalize ${isBull ? 'text-emerald-300' : 'text-rose-300'}`}>{data.regime}</div>
        </div>
        <div className="rounded border border-slate-600 p-3">
          <div className="text-xs text-slate-400">State</div>
          <div className="text-slate-200">{data.regimeIndex}</div>
        </div>
        <div className="rounded border border-slate-600 p-3">
          <div className="text-xs text-slate-400">Updated</div>
          <div className="text-slate-200 text-sm">{new Date(data.updatedAt).toLocaleDateString()}</div>
        </div>
      </div>

      {pred && (pred.nextDay || pred.day5 || pred.day14) && (
        <div>
          <h3 className="text-sm font-medium text-slate-300 mb-2">Regime outlook (probability)</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {pred.nextDay && (
              <div className="rounded border border-slate-600 p-3 bg-slate-800/50">
                <div className="text-xs text-slate-400">Next trading day</div>
                <div className="mt-1 text-sm">
                  <span className="text-emerald-400">Bull {Math.round(pred.nextDay.bull * 100)}%</span>
                  <span className="text-slate-500 mx-1">/</span>
                  <span className="text-rose-400">Bear {Math.round(pred.nextDay.bear * 100)}%</span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5">Most likely: {pred.nextDay.mostLikely}</div>
              </div>
            )}
            {pred.day5 && (
              <div className="rounded border border-slate-600 p-3 bg-slate-800/50">
                <div className="text-xs text-slate-400">In 5 days</div>
                <div className="mt-1 text-sm">
                  <span className="text-emerald-400">Bull {Math.round(pred.day5.bull * 100)}%</span>
                  <span className="text-slate-500 mx-1">/</span>
                  <span className="text-rose-400">Bear {Math.round(pred.day5.bear * 100)}%</span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5">Most likely: {pred.day5.mostLikely}</div>
              </div>
            )}
            {pred.day14 && (
              <div className="rounded border border-slate-600 p-3 bg-slate-800/50">
                <div className="text-xs text-slate-400">In ~2 weeks (14 days)</div>
                <div className="mt-1 text-sm">
                  <span className="text-emerald-400">Bull {Math.round(pred.day14.bull * 100)}%</span>
                  <span className="text-slate-500 mx-1">/</span>
                  <span className="text-rose-400">Bear {Math.round(pred.day14.bear * 100)}%</span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5">Most likely: {pred.day14.mostLikely}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {historyReversed.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-slate-300 mb-2">Recent history</h3>
          <div className="rounded border border-slate-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-800/70">
                  <th className="text-left py-2 px-3 text-slate-400 font-medium">Date</th>
                  <th className="text-left py-2 px-3 text-slate-400 font-medium">Regime</th>
                </tr>
              </thead>
              <tbody>
                {historyReversed.slice(0, 15).map(({ date, regime }) => (
                  <tr key={date} className="border-b border-slate-800 hover:bg-slate-800/50">
                    <td className="py-1.5 px-3 text-slate-300">{date}</td>
                    <td className="py-1.5 px-3">
                      <span className={`capitalize ${regime === 'bull' ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {regime}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}

/** 5-year price + regime chart (lightweight-charts) */
function Regime5yChart({
  label,
  bars,
  fullHistory,
}: {
  label: string
  bars: Bar5y[]
  fullHistory: Array<{ date: string; regime: string; state: number }>
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null)

  const { priceData, regimeData } = useMemo(() => {
    if (bars.length === 0) return { priceData: [], regimeData: [] }
    const sorted = [...bars].sort((a, b) => a.t - b.t)
    const historySorted = [...fullHistory].sort((a, b) => a.date.localeCompare(b.date))
    const toTime = (t: number) => Math.floor(t / 1000) as any
    const priceData = sorted.map((b) => ({ time: toTime(b.t), value: Number(b.c) }))
    let j = 0
    let currentState = 0
    const regimeData: { time: number; value: number }[] = []
    for (const b of sorted) {
      const dateStr = new Date(b.t).toISOString().slice(0, 10)
      while (j < historySorted.length && historySorted[j].date <= dateStr) {
        currentState = historySorted[j].state
        j++
      }
      regimeData.push({ time: toTime(b.t), value: currentState })
    }
    return { priceData, regimeData }
  }, [bars, fullHistory])

  useEffect(() => {
    if (!containerRef.current || priceData.length === 0) return
    if (chartRef.current) {
      chartRef.current.remove()
      chartRef.current = null
    }
    const w = containerRef.current.clientWidth ?? 0
    if (w <= 0) return
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: '#0f172a' }, textColor: '#94a3b8' },
      grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
      timeScale: { timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: '#334155', scaleMargins: { top: 0.2, bottom: 0.2 } },
      width: w,
      height: 320,
    })
    const priceSeries = chart.addLineSeries({
      color: '#38bdf8',
      lineWidth: 2,
    })
    priceSeries.priceScale().applyOptions({ scaleMargins: { top: 0.2, bottom: 0.4 } })
    priceSeries.setData(priceData as any)
    const regimeSeries = chart.addLineSeries({
      color: '#22c55e',
      lineWidth: 1,
      priceScaleId: 'left',
    })
    chart.priceScale('left').applyOptions({
      scaleMargins: { top: 0.6, bottom: 0.1 },
      borderVisible: true,
    })
    regimeSeries.setData(regimeData as any)
    chart.timeScale().fitContent()
    chartRef.current = chart
    const ro = new ResizeObserver(() => {
      const w = containerRef.current?.clientWidth ?? 0
      if (w > 0 && chartRef.current) chartRef.current.applyOptions({ width: w })
    })
    ro.observe(containerRef.current)
    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
    }
  }, [priceData, regimeData])

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/50 overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-700 text-slate-300 text-sm font-medium">
        {label} — 5-year price (blue) & regime state 0=Bear / 1=Bull (green)
      </div>
      <div ref={containerRef} className="h-80" />
    </div>
  )
}

function BacktestSection({ label, backtest }: { label: string; backtest: BacktestTicker }) {
  const m = backtest.metrics
  return (
    <section className="rounded-lg border border-slate-600 bg-slate-800/20 p-5">
      <h3 className="text-lg font-medium text-slate-200 mb-3">{label} — 5-year backtest</h3>
      <p className="text-slate-500 text-xs mb-3">
        Correlation: regime (bull=1, bear=0) vs actual forward return. Positive = model aligns with realized returns.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-600 text-slate-400">
              <th className="text-left py-2 pr-4">Metric</th>
              <th className="text-right py-2">Value</th>
            </tr>
          </thead>
          <tbody className="text-slate-300">
            <tr className="border-b border-slate-700"><td className="py-1.5 pr-4">Total days</td><td className="text-right">{m.totalDays}</td></tr>
            <tr className="border-b border-slate-700"><td className="py-1.5 pr-4">Days model said Bull</td><td className="text-right text-emerald-400">{m.whenBull.count}</td></tr>
            <tr className="border-b border-slate-700"><td className="py-1.5 pr-4">Days model said Bear</td><td className="text-right text-rose-400">{m.whenBear.count}</td></tr>
            <tr className="border-b border-slate-700"><td className="py-1.5 pr-4">When Bull: avg 1d fwd return</td><td className="text-right">{m.whenBull.avgForward1dPct != null ? `${m.whenBull.avgForward1dPct}%` : '—'}</td></tr>
            <tr className="border-b border-slate-700"><td className="py-1.5 pr-4">When Bull: avg 5d fwd return</td><td className="text-right">{m.whenBull.avgForward5dPct != null ? `${m.whenBull.avgForward5dPct}%` : '—'}</td></tr>
            <tr className="border-b border-slate-700"><td className="py-1.5 pr-4">When Bull: avg 21d fwd return</td><td className="text-right">{m.whenBull.avgForward21dPct != null ? `${m.whenBull.avgForward21dPct}%` : '—'}</td></tr>
            <tr className="border-b border-slate-700"><td className="py-1.5 pr-4">When Bear: avg 1d fwd return</td><td className="text-right">{m.whenBear.avgForward1dPct != null ? `${m.whenBear.avgForward1dPct}%` : '—'}</td></tr>
            <tr className="border-b border-slate-700"><td className="py-1.5 pr-4">When Bear: avg 5d fwd return</td><td className="text-right">{m.whenBear.avgForward5dPct != null ? `${m.whenBear.avgForward5dPct}%` : '—'}</td></tr>
            <tr className="border-b border-slate-700"><td className="py-1.5 pr-4">When Bear: avg 21d fwd return</td><td className="text-right">{m.whenBear.avgForward21dPct != null ? `${m.whenBear.avgForward21dPct}%` : '—'}</td></tr>
            <tr className="border-b border-slate-700"><td className="py-1.5 pr-4">Correlation (regime vs 1d fwd)</td><td className="text-right font-mono">{m.correlation1d != null ? m.correlation1d : '—'}</td></tr>
            <tr className="border-b border-slate-700"><td className="py-1.5 pr-4">Correlation (regime vs 5d fwd)</td><td className="text-right font-mono">{m.correlation5d != null ? m.correlation5d : '—'}</td></tr>
            <tr className="border-b border-slate-700"><td className="py-1.5 pr-4">Correlation (regime vs 21d fwd)</td><td className="text-right font-mono">{m.correlation21d != null ? m.correlation21d : '—'}</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default function Regime() {
  const [data, setData] = useState<RegimeApiResponse | null>(null)
  const [backtest, setBacktest] = useState<BacktestApiResponse | null>(null)
  const [bars5y, setBars5y] = useState<{ spy: Bar5y[]; qqq: Bar5y[] }>({ spy: [], qqq: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      fetch(`${API_BASE}/api/regime`, { cache: 'no-store' }).then((r) => {
        if (!r.ok) return r.json().then((e) => { throw new Error(e.error || r.statusText) })
        return r.json()
      }),
      fetch(`${API_BASE}/api/regime/backtest`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { spy: null, qqq: null })),
    ])
      .then(([regimeData, backtestData]: [RegimeApiResponse, BacktestApiResponse]) => {
        setData(regimeData)
        setBacktest(backtestData)
      })
      .catch((e: Error) => {
        setError(e.message)
        setData(null)
        setBacktest(null)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!backtest?.spy && !backtest?.qqq) return
    Promise.all([
      fetch(`${API_BASE}/api/regime/bars/SPY`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { results: [] })),
      fetch(`${API_BASE}/api/regime/bars/QQQ`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { results: [] })),
    ])
      .then(([spyRes, qqqRes]) => {
        setBars5y({
          spy: (spyRes.results || []) as Bar5y[],
          qqq: (qqqRes.results || []) as Bar5y[],
        })
      })
      .catch(() => setBars5y({ spy: [], qqq: [] }))
  }, [backtest])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-slate-400">Loading regime…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-slate-100">Market Regime (HMM)</h1>
        <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 p-4 text-amber-200">
          <p className="font-medium">Regime data not available</p>
          <p className="mt-1 text-sm text-amber-200/80">{error}</p>
          <p className="mt-2 text-sm text-slate-400">
            Train the model: <code className="rounded bg-slate-800 px-1.5 py-0.5">npm run fetch-regime-data</code> then <code className="rounded bg-slate-800 px-1.5 py-0.5">npm run regime:train</code>.
          </p>
        </div>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-slate-100">Market Regime (HMM)</h1>
      <p className="text-slate-400 text-sm">
        Separate HMMs for SPY and QQQ (5y data, returns + volatility). Outlook uses the transition matrix for the next 1, 5, and 14 days.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {data.spy && <TickerSection label="SPY" data={data.spy} />}
        {data.qqq && <TickerSection label="QQQ" data={data.qqq} />}
      </div>

      {!data.spy && !data.qqq && (
        <div className="text-slate-500">No regime data loaded.</div>
      )}

      {/* 5-year data and regime plot */}
      {(backtest?.spy || backtest?.qqq) && (bars5y.spy.length > 0 || bars5y.qqq.length > 0) && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-slate-100">5-year data & regime plot</h2>
          <p className="text-slate-400 text-sm">
            Price (blue) and HMM regime state 0 = Bear / 1 = Bull (green) over the full 5-year training window.
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {backtest.spy && bars5y.spy.length > 0 && (
              <Regime5yChart label="SPY" bars={bars5y.spy} fullHistory={backtest.spy.fullHistory} />
            )}
            {backtest.qqq && bars5y.qqq.length > 0 && (
              <Regime5yChart label="QQQ" bars={bars5y.qqq} fullHistory={backtest.qqq.fullHistory} />
            )}
          </div>
        </div>
      )}

      {/* 5-year backtest: prediction vs actual forward returns */}
      {(backtest?.spy || backtest?.qqq) && (
        <div className="space-y-6">
          <h2 className="text-xl font-semibold text-slate-100">5-year backtest: prediction vs actual returns</h2>
          <p className="text-slate-400 text-sm">
            For each day in the past 5 years, the model assigned a regime (bull/bear). This table compares that to what actually happened (forward 1d, 5d, 21d returns). Correlation measures how well the regime label lines up with realized returns.
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {backtest.spy && <BacktestSection label="SPY" backtest={backtest.spy} />}
            {backtest.qqq && <BacktestSection label="QQQ" backtest={backtest.qqq} />}
          </div>
        </div>
      )}
    </div>
  )
}
