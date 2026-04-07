import { useEffect, useMemo, useState } from 'react'
import { API_BASE } from '../utils/api'

type ConfigResponse = {
  managers: Array<{ id: string; label: string; model: string }>
  benchmarkTicker: string
  startingCapitalUsd: number
  constraints: {
    maxConcentrationPct: number
    maxRiskPerTradePct: number
    maxDeployedPct: number
    minCashPct: number
    targetOutperformancePct: number
  }
}

type PositionRow = {
  id: string
  ticker: string
  strategy: string
  instrumentType: string
  quantity: number
  entryPriceUsd: number
  markUsd: number
  unrealizedPnlUsd: number
  dataFreshness?: 'live' | 'stale' | 'approx'
}

type ManagerSummary = {
  equityUsd: number
  runningPnlUsd: number
  deployedUsd: number
  availableCashUsd: number
  positions: PositionRow[]
  benchmark: {
    managerReturnPct: number
    spyReturnPct: number
    outperformancePct: number
    targetMet: boolean
    targetOutperformancePct: number
  }
}

type SummaryResponse = {
  ok: boolean
  asOfDate: string | null
  benchmark: { ticker: string; currentPrice: number | null; startPrice: number | null } | null
  managers: Record<string, ManagerSummary>
}

async function parseJsonSafe<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T
  } catch {
    return null
  }
}

async function extractResponseError(response: Response, fallback: string) {
  const json = await parseJsonSafe<{ error?: string; message?: string }>(response)
  if (json?.error) return json.error
  if (json?.message) return json.message
  const text = await response.text().catch(() => '')
  if (text && text.trim()) return `${fallback}: ${text.slice(0, 240)}`
  return `${fallback} (HTTP ${response.status})`
}

function usd(n: number | null | undefined) {
  const value = Number(n)
  if (!Number.isFinite(value)) return '—'
  return value.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}

function pct(n: number | null | undefined) {
  const value = Number(n)
  if (!Number.isFinite(value)) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function freshnessBadgeClass(v?: string) {
  if (v === 'live') return 'border-emerald-700/70 bg-emerald-950/40 text-emerald-300'
  if (v === 'stale') return 'border-amber-700/70 bg-amber-950/40 text-amber-300'
  return 'border-slate-600 bg-slate-900/80 text-slate-300'
}

export default function AiPortfolio() {
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [config, setConfig] = useState<ConfigResponse | null>(null)
  const [summary, setSummary] = useState<SummaryResponse | null>(null)

  const load = async () => {
    setError(null)
    setLoading(true)
    try {
      const [cfgRes, sumRes] = await Promise.all([
        fetch(`${API_BASE}/api/ai-portfolio/config`, { cache: 'no-store' }),
        fetch(`${API_BASE}/api/ai-portfolio/summary`, { cache: 'no-store' }),
      ])
      const cfg = await parseJsonSafe<ConfigResponse>(cfgRes)
      const sum = await parseJsonSafe<SummaryResponse>(sumRes)
      if (!cfgRes.ok || !cfg) {
        throw new Error(await extractResponseError(cfgRes, 'Failed to load AI Portfolio config'))
      }
      if (!sumRes.ok || !sum?.ok) {
        throw new Error(await extractResponseError(sumRes, 'Failed to load AI Portfolio summary'))
      }
      setConfig(cfg)
      setSummary(sum)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load AI Portfolio.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const managerRows = useMemo(() => {
    if (!summary?.managers || !config?.managers) return []
    return config.managers
      .map((m) => ({
        id: m.id,
        label: m.label,
        model: m.model,
        data: summary.managers[m.id],
      }))
      .filter((row) => Boolean(row.data))
  }, [summary, config])

  const bestRow = useMemo(() => {
    return [...managerRows].sort(
      (a, b) => (b.data?.benchmark?.outperformancePct || 0) - (a.data?.benchmark?.outperformancePct || 0),
    )[0]
  }, [managerRows])

  const worstRow = useMemo(() => {
    return [...managerRows].sort(
      (a, b) => (a.data?.benchmark?.outperformancePct || 0) - (b.data?.benchmark?.outperformancePct || 0),
    )[0]
  }, [managerRows])

  const runDaily = async () => {
    setRunning(true)
    setError(null)
    try {
      const response = await fetch(`${API_BASE}/api/ai-portfolio/simulate/daily`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const body = await parseJsonSafe<{ ok?: boolean; error?: string }>(response)
      if (!response.ok || !body?.ok) {
        const err = body?.error || (await extractResponseError(response, 'Daily run failed'))
        throw new Error(err)
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Daily run failed.')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">AI Portfolio</h1>
          <p className="text-sm text-slate-500 mt-1">
            Live paper portfolios (house money) with strict 10/2/80/20 risk controls.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void runDaily()}
          disabled={running || loading}
          className="text-sm px-4 py-2 rounded-lg border border-sky-600 bg-sky-900/30 text-sky-300 hover:bg-sky-800/40 hover:border-sky-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {running ? 'Running daily cycle…' : 'Run Daily Cycle'}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-800/80 bg-red-950/35 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-slate-400">Loading AI Portfolio…</div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <MetricCard label="As of date" value={summary?.asOfDate || '—'} />
            <MetricCard label="Benchmark" value={summary?.benchmark?.ticker || config?.benchmarkTicker || 'SPY'} />
            <MetricCard label="Best manager" value={bestRow ? `${bestRow.label} (${pct(bestRow.data.benchmark?.outperformancePct)})` : '—'} />
            <MetricCard label="Worst manager" value={worstRow ? `${worstRow.label} (${pct(worstRow.data.benchmark?.outperformancePct)})` : '—'} />
          </div>

          <section className="rounded-xl border border-slate-700 bg-slate-800/40 p-5 space-y-3">
            <h2 className="text-sm font-semibold text-slate-200">Manager comparison</h2>
            <div className="overflow-x-auto rounded-lg border border-slate-700/80">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-slate-700 bg-slate-900/60 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2 font-medium">Manager</th>
                    <th className="px-3 py-2 font-medium">Model</th>
                    <th className="px-3 py-2 font-medium">Equity</th>
                    <th className="px-3 py-2 font-medium">Running P/L</th>
                    <th className="px-3 py-2 font-medium">SPY delta</th>
                    <th className="px-3 py-2 font-medium">Deployed %</th>
                    <th className="px-3 py-2 font-medium">Cash %</th>
                  </tr>
                </thead>
                <tbody>
                  {managerRows.map((row) => {
                    const equity = row.data.equityUsd || 0
                    const deployedPct = equity > 0 ? (row.data.deployedUsd / equity) * 100 : 0
                    const cashPct = equity > 0 ? (row.data.availableCashUsd / equity) * 100 : 0
                    return (
                      <tr key={row.id} className="border-b border-slate-700/50 last:border-b-0">
                        <td className="px-3 py-2 text-slate-100 font-medium">{row.label}</td>
                        <td className="px-3 py-2 text-slate-400">{row.model}</td>
                        <td className="px-3 py-2 text-slate-200">{usd(row.data.equityUsd)}</td>
                        <td className={`px-3 py-2 ${row.data.runningPnlUsd >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                          {usd(row.data.runningPnlUsd)}
                        </td>
                        <td className={`${row.data.benchmark?.outperformancePct >= 0 ? 'text-emerald-300' : 'text-red-300'} px-3 py-2`}>
                          {pct(row.data.benchmark?.outperformancePct)}
                        </td>
                        <td className="px-3 py-2 text-slate-300">{pct(deployedPct)}</td>
                        <td className="px-3 py-2 text-slate-300">{pct(cashPct)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-4">
            {managerRows.map((row) => {
              const unrealizedTotalUsd = row.data.positions.reduce((s, p) => s + p.unrealizedPnlUsd, 0)
              const realizedPnlUsd = row.data.runningPnlUsd - unrealizedTotalUsd
              return (
              <div key={row.id} className="rounded-xl border border-slate-700 bg-slate-800/40 p-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-semibold text-slate-100">{row.label} portfolio</h3>
                  <span className="text-xs text-slate-500">
                    Goal: beat SPY by {config?.constraints?.targetOutperformancePct ?? 5}% ·{' '}
                    <span className={row.data.benchmark?.targetMet ? 'text-emerald-300' : 'text-amber-300'}>
                      {row.data.benchmark?.targetMet ? 'on target' : 'below target'}
                    </span>
                  </span>
                </div>
                <div className="overflow-x-auto rounded-lg border border-slate-700/80">
                  <table className="w-full text-sm text-left">
                    <thead>
                      <tr className="border-b border-slate-700 bg-slate-900/60 text-xs uppercase tracking-wide text-slate-500">
                        <th className="px-3 py-2 font-medium">Symbol / contract</th>
                        <th className="px-3 py-2 font-medium">Side / strategy</th>
                        <th className="px-3 py-2 font-medium">Qty</th>
                        <th className="px-3 py-2 font-medium">Avg cost</th>
                        <th className="px-3 py-2 font-medium">Mark</th>
                        <th className="px-3 py-2 font-medium">Unrealized P/L</th>
                        <th className="px-3 py-2 font-medium">Realized P/L</th>
                        <th className="px-3 py-2 font-medium">Running total P/L</th>
                        <th className="px-3 py-2 font-medium">Freshness</th>
                      </tr>
                    </thead>
                    <tbody>
                      {row.data.positions.length === 0 ? (
                        <tr>
                          <td className="px-3 py-3 text-slate-500" colSpan={9}>
                            No open positions.
                          </td>
                        </tr>
                      ) : (
                        row.data.positions.map((position) => (
                          <tr key={position.id} className="border-b border-slate-700/50 last:border-b-0">
                            <td className="px-3 py-2 text-slate-100 font-medium">{position.ticker}</td>
                            <td className="px-3 py-2 text-slate-300">Long · {position.strategy}</td>
                            <td className="px-3 py-2 text-slate-300">{position.quantity}</td>
                            <td className="px-3 py-2 text-slate-300">{usd(position.entryPriceUsd)}</td>
                            <td className="px-3 py-2 text-slate-300">{usd(position.markUsd)}</td>
                            <td className={`px-3 py-2 ${position.unrealizedPnlUsd >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                              {usd(position.unrealizedPnlUsd)}
                            </td>
                            <td className={`px-3 py-2 ${realizedPnlUsd >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                              {usd(realizedPnlUsd)}
                            </td>
                            <td className={`px-3 py-2 ${row.data.runningPnlUsd >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                              {usd(row.data.runningPnlUsd)}
                            </td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs ${freshnessBadgeClass(position.dataFreshness)}`}>
                                {position.dataFreshness || 'live'}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              )
            })}
          </section>
        </>
      )}
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-100">{value}</div>
    </div>
  )
}

