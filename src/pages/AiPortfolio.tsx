import { useEffect, useMemo, useState } from 'react'
import { AiPortfolioOpenRouterCostChart } from '../components/AiPortfolioOpenRouterCostChart'
import { displaySlugForManager } from '../data/aiPortfolioDefaultModels'
import { API_BASE } from '../utils/api'
import { consumeSseFromResponse } from '../utils/aiPortfolioDailyStream'

type ConfigResponse = {
  llm?: { provider: string; openRouterKeySet?: boolean }
  modelDefaults?: Record<string, string>
  managers: Array<{ id: string; label: string; model: string; defaultModel?: string }>
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

type LlmInsightRow = {
  asOfDate?: string
  thesis?: string
  /** Model’s explicit book review (sectors, overlap, risk). */
  portfolioReview?: string
  /** When opening a new line: why this instrument/setup (from model JSON `entryThesis`). */
  entryThesis?: string
  /** When opening a new line: conviction level + clause (`entryConviction`). */
  entryConviction?: string
  rawText?: string
  positionStance?: string
  actionIntent?: string
  model?: string
  parseOk?: boolean
  openedNewPosition?: boolean
  executionNote?: string
  errorMessage?: string | null
  /** OpenRouter billed USD for this manager call when returned on `usage.cost`. */
  costUsd?: number | null
}

type ManagerSummary = {
  equityUsd: number
  runningPnlUsd: number
  deployedUsd: number
  /** Total ledger cash (may differ from equity − positions for options collateral). */
  cashUsd?: number
  availableCashUsd: number
  positions: PositionRow[]
  lastLlmInsight?: LlmInsightRow | null
  benchmark: {
    managerReturnPct: number
    spyReturnPct: number
    outperformancePct: number
    targetMet: boolean
    targetOutperformancePct: number
  }
}

type LiveManagerRun = {
  phase: 'thinking' | 'responded' | 'executed' | 'error'
  llm?: LlmInsightRow | null
  suggestion?: { action?: string; ticker?: string; reason?: string }
  execution?: LlmInsightRow | null
  streamError?: string
}

type SummaryResponse = {
  ok: boolean
  asOfDate: string | null
  benchmark: { ticker: string; currentPrice: number | null; startPrice: number | null } | null
  managers: Record<string, ManagerSummary>
  openRouterDailyCosts?: Array<{ date: string; costUsd: number; byManager?: Record<string, number> }>
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

function actionIntentLabel(intent?: string) {
  const i = String(intent || '').toLowerCase()
  if (i === 'enter') return 'New entry (buy / open)'
  if (i === 'exit') return 'Exit / close line'
  if (i === 'exit_invalid') return 'Exit intent (bad payload)'
  if (i === 'hold') return 'Hold (no new trade)'
  if (i === 'error') return 'Model error'
  return 'Pass / no new trade'
}

function actionIntentBadgeClass(intent?: string) {
  const i = String(intent || '').toLowerCase()
  if (i === 'enter') return 'border-sky-600/80 bg-sky-950/50 text-sky-200'
  if (i === 'exit') return 'border-rose-600/70 bg-rose-950/35 text-rose-200'
  if (i === 'exit_invalid') return 'border-amber-600/70 bg-amber-950/40 text-amber-200'
  if (i === 'hold') return 'border-amber-600/70 bg-amber-950/40 text-amber-200'
  if (i === 'error') return 'border-red-700/70 bg-red-950/40 text-red-200'
  return 'border-slate-600 bg-slate-900/80 text-slate-300'
}

export default function AiPortfolio() {
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [config, setConfig] = useState<ConfigResponse | null>(null)
  const [summary, setSummary] = useState<SummaryResponse | null>(null)
  /** Per-manager OpenRouter stream state while a daily run is in flight. */
  const [liveByManager, setLiveByManager] = useState<Record<string, LiveManagerRun>>({})

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
      .map((m) => {
        /** What OpenRouter actually calls (env AI_PORTFOLIO_MODEL_* or server default). */
        const activeModel = String(m.model || '').trim()
        /** Shipped slug: UI mirror of server defaults first (survives stale API), then config defaultModel. */
        const packageDefault =
          String(displaySlugForManager(m.id) || '').trim() ||
          String(m.defaultModel || '').trim() ||
          ''
        const model = packageDefault || activeModel || '—'
        const modelOverridden = Boolean(
          activeModel && packageDefault && activeModel !== packageDefault,
        )
        return {
          id: m.id,
          label: m.label,
          model,
          /** When set, differs from `model` because server env overrides the package default. */
          activeModel: modelOverridden ? activeModel : undefined,
          modelOverridden,
          data: summary.managers[m.id],
        }
      })
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

  const openRouterCostRows = useMemo(() => summary?.openRouterDailyCosts ?? [], [summary?.openRouterDailyCosts])

  const openRouterSpendTotal = useMemo(
    () => openRouterCostRows.reduce((s, r) => s + (Number(r.costUsd) || 0), 0),
    [openRouterCostRows],
  )

  const runDaily = async () => {
    setRunning(true)
    setError(null)
    setLiveByManager({})
    try {
      const response = await fetch(`${API_BASE}/api/ai-portfolio/simulate/daily-stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({}),
      })

      if (response.status === 409) {
        const body = await parseJsonSafe<{ error?: string }>(response)
        throw new Error(body?.error || 'A daily run is already in progress on the server.')
      }

      if (!response.ok) {
        throw new Error(await extractResponseError(response, 'Daily run failed'))
      }

      let streamHadError = false
      await consumeSseFromResponse(response, (eventName, data) => {
        const payload = data as Record<string, unknown>
        if (eventName === 'manager_thinking') {
          const managerId = String(payload.managerId || '')
          if (!managerId) return
          setLiveByManager((prev) => ({
            ...prev,
            [managerId]: { phase: 'thinking' },
          }))
          return
        }
        if (eventName === 'manager_response') {
          const managerId = String(payload.managerId || '')
          if (!managerId) return
          setLiveByManager((prev) => ({
            ...prev,
            [managerId]: {
              phase: 'responded',
              llm: (payload.llm as LlmInsightRow) || null,
              suggestion: (payload.suggestion as LiveManagerRun['suggestion']) || undefined,
            },
          }))
          return
        }
        if (eventName === 'manager_executed') {
          const managerId = String(payload.managerId || '')
          if (!managerId) return
          const insight = payload.insight as LlmInsightRow | undefined
          setLiveByManager((prev) => ({
            ...prev,
            [managerId]: {
              ...prev[managerId],
              phase: 'executed',
              execution: insight || null,
            },
          }))
          return
        }
        if (eventName === 'error') {
          streamHadError = true
          const msg = String((payload as { message?: string }).message || 'Stream error')
          setError(msg)
        }
      })

      if (!streamHadError) {
        await load()
        setLiveByManager({})
      }
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
          {config?.llm && (
            <p className="text-xs text-slate-500 mt-1">
              Router: <span className="text-slate-400">{config.llm.provider}</span>
              {config.llm.provider === 'openrouter' && config.llm.openRouterKeySet === false ? (
                <span className="text-amber-400/90"> · add OPENROUTER_API_KEY on the API server for live model calls</span>
              ) : null}
              <span className="block mt-1 text-slate-500 leading-relaxed">
                <span className="text-slate-600">Package model defaults</span>
                {(['claude', 'gpt', 'gemini', 'deepseek'] as const).map((id) => (
                  <span key={id} className="ml-2 inline-block">
                    <span className="text-slate-600 capitalize">{id}</span>{' '}
                    <span className="font-mono text-slate-400 text-[11px]">
                      {config.modelDefaults?.[id] ?? displaySlugForManager(id) ?? '—'}
                    </span>
                  </span>
                ))}
              </span>
            </p>
          )}
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
            <p className="text-xs text-slate-500">
              <span className="text-slate-400">Portfolio value</span> = total equity (cash + marks ± P/L).{' '}
              <span className="text-slate-400">Value</span> = sum of open positions at last mark (stocks + options exposure).{' '}
              <span className="text-slate-400">Cash</span> = ledger cash balance.
            </p>
            <div className="overflow-x-auto rounded-lg border border-slate-700/80">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-slate-700 bg-slate-900/60 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2 font-medium">Manager</th>
                    <th className="px-3 py-2 font-medium">Model (OpenRouter)</th>
                    <th className="px-3 py-2 font-medium">Portfolio value</th>
                    <th className="px-3 py-2 font-medium">Value</th>
                    <th className="px-3 py-2 font-medium">Cash</th>
                    <th className="px-3 py-2 font-medium">Running P/L</th>
                    <th className="px-3 py-2 font-medium">SPY delta</th>
                  </tr>
                </thead>
                <tbody>
                  {managerRows.map((row) => {
                    const cashLedger = Number(row.data.cashUsd)
                    const cashDisplay = Number.isFinite(cashLedger) ? cashLedger : row.data.availableCashUsd
                    return (
                      <tr key={row.id} className="border-b border-slate-700/50 last:border-b-0">
                        <td className="px-3 py-2 text-slate-100 font-medium">{row.label}</td>
                        <td className="px-3 py-2 text-slate-300 font-mono text-[11px] text-slate-200">
                          <div>{row.model}</div>
                          {row.modelOverridden && row.activeModel ? (
                            <div className="text-[10px] text-slate-500 font-sans normal-case mt-0.5 tracking-normal">
                              Active (server env):{' '}
                              <span className="font-mono text-slate-500">{row.activeModel}</span>
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-slate-100 font-medium">{usd(row.data.equityUsd)}</td>
                        <td className="px-3 py-2 text-slate-200">{usd(row.data.deployedUsd)}</td>
                        <td className="px-3 py-2 text-slate-200">{usd(cashDisplay)}</td>
                        <td className={`px-3 py-2 ${row.data.runningPnlUsd >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                          {usd(row.data.runningPnlUsd)}
                        </td>
                        <td className={`${row.data.benchmark?.outperformancePct >= 0 ? 'text-emerald-300' : 'text-red-300'} px-3 py-2`}>
                          {pct(row.data.benchmark?.outperformancePct)}
                        </td>
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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-semibold text-slate-100">{row.label} portfolio</h3>
                    <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                      <span>{row.model}</span>
                      {row.modelOverridden && row.activeModel ? (
                        <span className="block text-[10px] text-slate-600 font-sans mt-0.5">
                          Active (server env): {row.activeModel}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <span className="text-xs text-slate-500">
                    Goal: beat SPY by {config?.constraints?.targetOutperformancePct ?? 5}% ·{' '}
                    <span className={row.data.benchmark?.targetMet ? 'text-emerald-300' : 'text-amber-300'}>
                      {row.data.benchmark?.targetMet ? 'on target' : 'below target'}
                    </span>
                  </span>
                </div>

                <ManagerDecisionPanel
                  managerId={row.id}
                  live={liveByManager[row.id]}
                  persisted={row.data.lastLlmInsight}
                  running={running}
                />

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

          <section className="rounded-xl border border-slate-700 bg-slate-800/40 p-5 space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-200">OpenRouter daily cost (AI Portfolio)</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Total billed across recorded days:{' '}
                  <span className="text-slate-300 font-medium">
                    {openRouterSpendTotal > 0
                      ? openRouterSpendTotal >= 0.01
                        ? `$${openRouterSpendTotal.toFixed(3)}`
                        : `$${openRouterSpendTotal.toFixed(6)}`
                      : '—'}
                  </span>
                </p>
              </div>
            </div>
            <AiPortfolioOpenRouterCostChart rows={openRouterCostRows} />
          </section>
        </>
      )}
    </div>
  )
}

function ManagerDecisionPanel({
  live,
  persisted,
  running,
}: {
  managerId: string
  live?: LiveManagerRun
  persisted?: LlmInsightRow | null
  running: boolean
}) {
  const thinking = running && live?.phase === 'thinking'
  const insight = live?.execution || live?.llm || persisted
  const intent =
    live?.execution?.actionIntent ||
    live?.llm?.actionIntent ||
    persisted?.actionIntent ||
    'pass'

  if (thinking && !live?.llm) {
    return (
      <div className="rounded-lg border border-sky-800/60 bg-sky-950/25 px-3 py-2 text-sm text-sky-200/90">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-sky-400 align-middle mr-2" />
        Waiting for OpenRouter…
      </div>
    )
  }

  if (!insight && !thinking) {
    return (
      <p className="text-xs text-slate-500">
        Run <span className="text-slate-400">Daily cycle</span> to pull today&apos;s thesis and trade intent from the model.
      </p>
    )
  }

  const thesis = insight?.thesis || '—'
  const bookReview = insight?.portfolioReview
  const stance = insight?.positionStance
  const entryThesis = insight?.entryThesis
  const entryConviction = insight?.entryConviction
  const executionNote = live?.execution?.executionNote || persisted?.executionNote
  const raw = insight?.rawText
  const openedEntry = Boolean(
    live?.execution?.openedNewPosition ||
      persisted?.openedNewPosition ||
      String(intent).toLowerCase() === 'enter',
  )
  const showEntryRationale =
    openedEntry || Boolean((entryThesis && entryThesis.trim()) || (entryConviction && entryConviction.trim()))

  return (
    <div className="rounded-lg border border-slate-600/80 bg-slate-900/50 p-3 space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${actionIntentBadgeClass(intent)}`}
        >
          {actionIntentLabel(intent)}
        </span>
        {insight?.model ? (
          <span className="text-[10px] font-mono text-slate-500">{insight.model}</span>
        ) : null}
        {insight?.costUsd != null && Number(insight.costUsd) > 0 ? (
          <span className="text-[10px] text-slate-500">
            OpenRouter ~$
            {Number(insight.costUsd) >= 0.01
              ? Number(insight.costUsd).toFixed(4)
              : Number(insight.costUsd).toFixed(6)}
          </span>
        ) : null}
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-slate-500">Thesis</div>
        <p className="text-slate-200 text-sm leading-snug mt-0.5">{thesis}</p>
      </div>
      {bookReview ? (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Book review</div>
          <p className="text-slate-300 text-xs leading-snug mt-0.5">{bookReview}</p>
        </div>
      ) : null}
      {stance ? (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Open positions</div>
          <p className="text-slate-300 text-xs leading-snug mt-0.5">{stance}</p>
        </div>
      ) : null}
      {showEntryRationale ? (
        <div className="rounded-md border border-sky-900/50 bg-sky-950/20 px-2 py-2 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-sky-400/90">New entry — conviction &amp; thesis</div>
          {entryConviction && entryConviction.trim() ? (
            <p className="text-sky-100 text-xs font-medium leading-snug">
              <span className="text-sky-500/90 font-normal">Conviction — </span>
              {entryConviction}
            </p>
          ) : openedEntry ? (
            <p className="text-slate-500 text-xs italic">No conviction note returned for this entry.</p>
          ) : null}
          {entryThesis && entryThesis.trim() ? (
            <p className="text-slate-300 text-xs leading-snug">
              <span className="text-slate-500 block text-[10px] uppercase tracking-wide mb-0.5">Entry thesis</span>
              {entryThesis}
            </p>
          ) : openedEntry ? (
            <p className="text-slate-500 text-xs italic">No entry thesis returned for this trade.</p>
          ) : null}
        </div>
      ) : null}
      {executionNote ? (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Execution</div>
          <p className="text-slate-300 text-xs leading-snug mt-0.5">{executionNote}</p>
        </div>
      ) : null}
      {raw && String(raw).trim() ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-slate-500 hover:text-slate-400">Raw model JSON / text</summary>
          <pre className="mt-2 max-h-40 overflow-auto rounded border border-slate-700 bg-slate-950/80 p-2 text-[10px] text-slate-400 whitespace-pre-wrap">
            {String(raw).slice(0, 8000)}
          </pre>
        </details>
      ) : null}
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

