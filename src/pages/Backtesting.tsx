import { useEffect, useMemo, useRef, useState } from 'react'
import { ColorType, createChart, type LineData, type Time } from 'lightweight-charts'
import { API_BASE } from '../utils/api'

type RunSummary = {
  id: string
  ticker: string
  strategy: string
  startDate: string
  endDate: string
  createdAt: string
  topSetup?: {
    id: string
    deltaTarget: number
    entryDte: number
    sharpe: number | null
    totalProfitUsd: number | null
    totalReturnPct: number | null
  } | null
}

type SetupMetrics = {
  totalProfitUsd: number
  totalReturnPct: number
  annualizedRoyPct: number
  avgTradeAnnualizedRoyPct: number
  cagrPct: number
  maxDrawdownPct: number
  sharpe: number
  sharpeDailyRf0: number
  winRatePct: number
  tradeCount: number
  avgDaysHeld: number
}

type TradeRow = {
  entryDate: string
  exitDate: string
  strike: number
  entryDte: number
  exitDte: number
  targetDelta: number
  premiumOpen: number
  premiumOpenMid?: number
  premiumClose: number
  premiumCloseMid?: number
  collateralUsd: number
  exitReason: string
  assigned: boolean
  pnlUsd: number
  returnPct: number
  annualizedRoyPct: number
  daysHeld: number
}

type SetupRow = {
  id: string
  deltaTarget: number
  entryDte: number
  profitTargetPct: number
  closeDte: number
  metrics: SetupMetrics
  equityCurve: Array<{ time: string; equity: number }>
  trades: TradeRow[]
}

type RunResponse = {
  ok: boolean
  run: {
    id: string
    ticker: string
    strategy: string
    startDate: string
    endDate: string
    createdAt: string
    request?: Record<string, unknown>
  }
  setups: SetupRow[]
  selectedSetupId: string | null
  recentRuns: RunSummary[]
  assumptions: Record<string, string | number>
  warnings: string[]
}

const DELTA_OPTIONS = [0.2, 0.15, 0.1]
const DTE_OPTIONS = [30, 45, 60, 90, 180, 270, 365, 540]
const PROFIT_TARGET_OPTIONS = [30, 40, 50]

function formatUsd(value: number | null | undefined) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '—'
  return numeric.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}

function formatPct(value: number | null | undefined) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '—'
  return `${numeric >= 0 ? '+' : ''}${numeric.toFixed(2)}%`
}

function formatAssumptionKey(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/^./, (char) => char.toUpperCase())
}

function defaultDateRange() {
  return {
    startDate: '2021-04-16',
    endDate: '2026-04-16',
  }
}

function dedupeAndSortEquityCurve(points: Array<{ time: string; equity: number }>) {
  const byTime = new Map<string, { time: string; equity: number }>()
  for (const point of points || []) {
    if (!point?.time) continue
    byTime.set(String(point.time), {
      time: String(point.time),
      equity: Number(point.equity),
    })
  }
  return [...byTime.values()].sort((a, b) => a.time.localeCompare(b.time))
}

function EquityCurveChart({ points }: { points: Array<{ time: string; equity: number }> }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container || points.length === 0) return
    const normalizedPoints = dedupeAndSortEquityCurve(points)
    if (normalizedPoints.length === 0) return
    const chart = createChart(container, {
      width: container.clientWidth,
      height: 280,
      layout: {
        background: { type: ColorType.Solid, color: '#020617' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: '#1e293b' },
        horzLines: { color: '#1e293b' },
      },
      rightPriceScale: { borderColor: '#334155' },
      timeScale: { borderColor: '#334155' },
    })
    const line = chart.addLineSeries({
      color: '#38bdf8',
      lineWidth: 2,
      priceFormat: {
        type: 'custom',
        minMove: 0.01,
        formatter: (value: number) => `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      },
    })
    const data: LineData<Time>[] = normalizedPoints.map((point) => ({
      time: point.time as Time,
      value: point.equity,
    }))
    line.setData(data)
    chart.timeScale().fitContent()

    const observer = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth })
    })
    observer.observe(container)
    return () => {
      observer.disconnect()
      chart.remove()
    }
  }, [points])

  return <div ref={containerRef} className="h-[280px] w-full rounded-xl border border-slate-800 bg-slate-950/60" />
}

export default function Backtesting() {
  const range = useMemo(() => defaultDateRange(), [])
  const [ticker, setTicker] = useState('QQQ')
  const [deltaTargets, setDeltaTargets] = useState<number[]>([0.15])
  const [dteTargets, setDteTargets] = useState<number[]>([365])
  const [profitTargetPct, setProfitTargetPct] = useState(50)
  const [startDate, setStartDate] = useState(range.startDate)
  const [endDate, setEndDate] = useState(range.endDate)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [payload, setPayload] = useState<RunResponse | null>(null)
  const [recentRuns, setRecentRuns] = useState<RunSummary[]>([])
  const [selectedSetupId, setSelectedSetupId] = useState<string | null>(null)

  const selectedSetup = useMemo(
    () => payload?.setups.find((setup) => setup.id === selectedSetupId) || payload?.setups[0] || null,
    [payload, selectedSetupId],
  )
  const selectedSetupSharpe = selectedSetup?.metrics.sharpeDailyRf0 ?? selectedSetup?.metrics.sharpe ?? 0
  const selectedSetupAvgTradeRoy =
    selectedSetup?.metrics.avgTradeAnnualizedRoyPct ?? selectedSetup?.metrics.annualizedRoyPct ?? 0
  const staleModelWarning = useMemo(() => {
    if (!payload) return null
    const assumptions = payload.assumptions || {}
    const hasCurrentStopRule = typeof assumptions.stopLossRule === 'string'
    const hasCurrentCadence = typeof assumptions.entryCadence === 'string'
    if (hasCurrentStopRule && hasCurrentCadence) return null
    return 'This saved run predates the current ladder/stop model. Re-run the backtest to compare with the latest rules.'
  }, [payload])

  async function loadRecentRuns() {
    const response = await fetch(`${API_BASE}/api/options-backtest/runs`, { cache: 'no-store' })
    const body = (await response.json()) as { ok?: boolean; runs?: RunSummary[]; error?: string }
    if (!response.ok || !body.ok) {
      throw new Error(body?.error || 'Failed to load saved runs.')
    }
    setRecentRuns(body.runs || [])
  }

  async function loadRun(runId: string) {
    setError(null)
    setLoading(true)
    try {
      const response = await fetch(`${API_BASE}/api/options-backtest/runs/${runId}`, { cache: 'no-store' })
      const body = (await response.json()) as RunResponse & { error?: string }
      if (!response.ok || !body.ok) throw new Error(body?.error || 'Failed to load saved run.')
      setPayload(body)
      setRecentRuns(body.recentRuns || [])
      setSelectedSetupId(body.selectedSetupId || body.setups?.[0]?.id || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load saved run.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadRecentRuns().catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to load saved runs.')
    })
  }, [])

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const response = await fetch(`${API_BASE}/api/options-backtest/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          strategy: 'cash_secured_put',
          deltaTargets,
          dteTargets,
          profitTargetPct,
          closeDte: 21,
          startDate,
          endDate,
        }),
      })
      const body = (await response.json()) as RunResponse & { error?: string }
      if (!response.ok || !body.ok) throw new Error(body?.error || 'Backtest failed.')
      setPayload(body)
      setRecentRuns(body.recentRuns || [])
      setSelectedSetupId(body.selectedSetupId || body.setups?.[0]?.id || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backtest failed.')
    } finally {
      setLoading(false)
    }
  }

  function toggleNumber(values: number[], value: number) {
    return values.includes(value) ? values.filter((item) => item !== value) : [...values, value].sort((a, b) => a - b)
  }

  return (
    <div className="space-y-8 text-slate-100">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-sky-300/70">Options Research</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Cash-Secured Put Backtesting</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
              Compare 10, 15, and 20 delta CSP setups across multiple expirations, ladder one new tranche each Monday,
              cap concurrent positions at 10, and review modeled Sharpe, CAGR, drawdown, total profit, and trade-level outcomes in one place.
            </p>
          </div>
          <div className="rounded-xl border border-emerald-900/60 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
            Ladder rules: <span className="font-semibold">1 new Monday entry</span>, <span className="font-semibold">max 10 open</span>, exits at profit target, <span className="font-semibold">2x credit stop</span>, or <span className="font-semibold">21 DTE</span>
          </div>
        </div>
      </section>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-8">
          <form onSubmit={onSubmit} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm text-slate-300">Ticker</span>
                <input
                  value={ticker}
                  onChange={(event) => setTicker(event.target.value.toUpperCase())}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none ring-0"
                  placeholder="AAPL"
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm text-slate-300">Strategy</span>
                <select className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white" value="cash_secured_put" disabled>
                  <option value="cash_secured_put">Cash-Secured Put</option>
                </select>
              </label>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-3">
              <div className="space-y-3">
                <p className="text-sm text-slate-300">Target deltas</p>
                <div className="flex flex-wrap gap-2">
                  {DELTA_OPTIONS.map((value) => {
                    const active = deltaTargets.includes(value)
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setDeltaTargets((current) => toggleNumber(current, value))}
                        className={`rounded-full border px-3 py-2 text-sm ${active ? 'border-sky-400 bg-sky-400/15 text-sky-200' : 'border-slate-700 text-slate-300'}`}
                      >
                        {(value * 100).toFixed(0)} delta
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="space-y-3">
                <p className="text-sm text-slate-300">DTE buckets</p>
                <div className="flex flex-wrap gap-2">
                  {DTE_OPTIONS.map((value) => {
                    const active = dteTargets.includes(value)
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setDteTargets((current) => toggleNumber(current, value))}
                        className={`rounded-full border px-3 py-2 text-sm ${active ? 'border-sky-400 bg-sky-400/15 text-sky-200' : 'border-slate-700 text-slate-300'}`}
                      >
                        {value} DTE
                      </button>
                    )
                  })}
                </div>
              </div>
              <label className="space-y-2">
                <span className="text-sm text-slate-300">Profit target</span>
                <select
                  value={profitTargetPct}
                  onChange={(event) => setProfitTargetPct(Number(event.target.value))}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white"
                >
                  {PROFIT_TARGET_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {value}% profit target
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm text-slate-300">Start date</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white"
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm text-slate-300">End date</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white"
                />
              </label>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-4">
              <button
                type="submit"
                disabled={loading}
                className="rounded-xl bg-sky-400 px-5 py-3 font-medium text-slate-950 transition hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? 'Running backtest…' : 'Run backtest'}
              </button>
              <p className="text-sm text-slate-400">
                Synthetic CSP pricing uses daily-close underlying bars, an IV surface proxy, and estimated spread/slippage.
              </p>
            </div>
            {error ? <p className="mt-4 text-sm text-rose-300">{error}</p> : null}
          </form>

          {payload ? (
            <>
              <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
                <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Run summary</p>
                    <h2 className="mt-2 text-2xl font-semibold text-white">
                      {payload.run.ticker} backtest
                    </h2>
                    <p className="mt-2 text-sm text-slate-400">
                      {payload.run.startDate} to {payload.run.endDate}
                    </p>
                  </div>
                  <div className="text-sm text-slate-400">
                    Saved {new Date(payload.run.createdAt).toLocaleString()}
                  </div>
                </div>

                <div className="mt-6 overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="text-slate-400">
                      <tr>
                        <th className="px-3 py-2 font-medium">Setup</th>
                        <th className="px-3 py-2 font-medium">Sharpe (daily eq, rf=0)</th>
                        <th className="px-3 py-2 font-medium">Total profit</th>
                        <th className="px-3 py-2 font-medium">Total return</th>
                        <th className="px-3 py-2 font-medium">CAGR</th>
                        <th className="px-3 py-2 font-medium">Avg trade ann. ROY</th>
                        <th className="px-3 py-2 font-medium">Max drawdown</th>
                        <th className="px-3 py-2 font-medium">Trades</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payload.setups.map((setup) => {
                        const active = selectedSetup?.id === setup.id
                        const sharpeValue = setup.metrics.sharpeDailyRf0 ?? setup.metrics.sharpe
                        const avgTradeRoyValue = setup.metrics.avgTradeAnnualizedRoyPct ?? setup.metrics.annualizedRoyPct
                        return (
                          <tr
                            key={setup.id}
                            onClick={() => setSelectedSetupId(setup.id)}
                            className={`cursor-pointer border-t border-slate-800 ${active ? 'bg-slate-800/60' : 'hover:bg-slate-800/40'}`}
                          >
                            <td className="px-3 py-3">
                              {(setup.deltaTarget * 100).toFixed(0)} delta / {setup.entryDte} DTE
                            </td>
                            <td className="px-3 py-3">{sharpeValue.toFixed(2)}</td>
                            <td className="px-3 py-3">{formatUsd(setup.metrics.totalProfitUsd)}</td>
                            <td className="px-3 py-3">{formatPct(setup.metrics.totalReturnPct)}</td>
                            <td className="px-3 py-3">{formatPct(setup.metrics.cagrPct)}</td>
                            <td className="px-3 py-3">{formatPct(avgTradeRoyValue)}</td>
                            <td className="px-3 py-3">{formatPct(-setup.metrics.maxDrawdownPct)}</td>
                            <td className="px-3 py-3">{setup.metrics.tradeCount}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              {selectedSetup ? (
                <div className="grid gap-8 2xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                  <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Equity curve</p>
                        <h3 className="mt-2 text-xl font-semibold text-white">
                          {(selectedSetup.deltaTarget * 100).toFixed(0)} delta / {selectedSetup.entryDte} DTE
                        </h3>
                      </div>
                      <div className="text-sm text-slate-400">
                        Profit target {selectedSetup.profitTargetPct}% • forced close {selectedSetup.closeDte} DTE
                      </div>
                    </div>
                    <div className="mt-6">
                      <EquityCurveChart points={selectedSetup.equityCurve} />
                    </div>
                  </section>

                  <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Assumptions & warnings</p>
                    <div className="mt-4 space-y-3 text-sm text-slate-300">
                      {staleModelWarning ? (
                        <div className="rounded-xl border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-amber-200">
                          {staleModelWarning}
                        </div>
                      ) : null}
                      {Object.entries(payload.assumptions || {}).map(([key, value]) => (
                        <div key={key} className="rounded-xl border border-slate-800 bg-slate-950/50 px-4 py-3">
                          <span className="font-medium text-white">{formatAssumptionKey(key)}</span>: {String(value)}
                        </div>
                      ))}
                      {payload.warnings?.length ? payload.warnings.map((warning) => (
                        <div key={warning} className="rounded-xl border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-amber-200">
                          {warning}
                        </div>
                      )) : <div className="rounded-xl border border-slate-800 bg-slate-950/50 px-4 py-3">No warnings on this run.</div>}
                    </div>
                  </section>
                </div>
              ) : null}

              {selectedSetup ? (
                <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
                  <div className="flex flex-wrap gap-4">
                    <div className="rounded-xl border border-slate-800 bg-slate-950/50 px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Sharpe (rf=0)</p>
                      <p className="mt-2 text-2xl font-semibold text-white">{selectedSetupSharpe.toFixed(2)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/50 px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Total profit</p>
                      <p className="mt-2 text-2xl font-semibold text-white">{formatUsd(selectedSetup.metrics.totalProfitUsd)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/50 px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">CAGR</p>
                      <p className="mt-2 text-2xl font-semibold text-white">{formatPct(selectedSetup.metrics.cagrPct)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/50 px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Avg trade ann. ROY</p>
                      <p className="mt-2 text-2xl font-semibold text-white">{formatPct(selectedSetupAvgTradeRoy)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/50 px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Win rate</p>
                      <p className="mt-2 text-2xl font-semibold text-white">{formatPct(selectedSetup.metrics.winRatePct)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/50 px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Avg hold</p>
                      <p className="mt-2 text-2xl font-semibold text-white">{selectedSetup.metrics.avgDaysHeld.toFixed(1)}d</p>
                    </div>
                  </div>

                  <div className="mt-6 overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead className="text-slate-400">
                        <tr>
                          <th className="px-3 py-2 font-medium">Entry</th>
                          <th className="px-3 py-2 font-medium">Exit</th>
                          <th className="px-3 py-2 font-medium">Strike</th>
                          <th className="px-3 py-2 font-medium">Premium in (fill)</th>
                          <th className="px-3 py-2 font-medium">Premium out (fill)</th>
                          <th className="px-3 py-2 font-medium">P/L</th>
                          <th className="px-3 py-2 font-medium">Trade ann. ROY</th>
                          <th className="px-3 py-2 font-medium">Exit reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedSetup.trades.map((trade, index) => (
                          <tr key={`${trade.entryDate}-${trade.exitDate}-${index}`} className="border-t border-slate-800">
                            <td className="px-3 py-3">{trade.entryDate}</td>
                            <td className="px-3 py-3">{trade.exitDate}</td>
                            <td className="px-3 py-3">{trade.strike.toFixed(2)}</td>
                            <td className="px-3 py-3">
                              {formatUsd(trade.premiumOpen * 100)}
                              {trade.premiumOpenMid != null ? <span className="block text-xs text-slate-500">mid {formatUsd(trade.premiumOpenMid * 100)}</span> : null}
                            </td>
                            <td className="px-3 py-3">
                              {formatUsd(trade.premiumClose * 100)}
                              {trade.premiumCloseMid != null ? <span className="block text-xs text-slate-500">mid {formatUsd(trade.premiumCloseMid * 100)}</span> : null}
                            </td>
                            <td className="px-3 py-3">{formatUsd(trade.pnlUsd)}</td>
                            <td className="px-3 py-3">{formatPct(trade.annualizedRoyPct)}</td>
                            <td className="px-3 py-3 text-slate-300">{trade.exitReason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}
            </>
          ) : null}
        </div>

        <aside className="space-y-6">
          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
            <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Saved runs</p>
            <div className="mt-4 space-y-3">
              {recentRuns.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => void loadRun(run.id)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950/50 px-4 py-4 text-left transition hover:border-sky-500/60 hover:bg-slate-950"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-white">{run.ticker}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {new Date(run.createdAt).toLocaleString()}
                      </p>
                    </div>
                    {run.topSetup ? (
                      <div className="text-right text-xs text-slate-400">
                        <div>{(run.topSetup.deltaTarget * 100).toFixed(0)} delta</div>
                        <div>{run.topSetup.entryDte} DTE</div>
                      </div>
                    ) : null}
                  </div>
                  {run.topSetup ? (
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-400">
                      <span>Sharpe (rf=0) {run.topSetup.sharpe?.toFixed(2) ?? '—'}</span>
                      <span>{formatUsd(run.topSetup.totalProfitUsd)}</span>
                    </div>
                  ) : null}
                </button>
              ))}
              {recentRuns.length === 0 ? (
                <p className="text-sm text-slate-500">No saved runs yet. Run your first CSP backtest above.</p>
              ) : null}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
