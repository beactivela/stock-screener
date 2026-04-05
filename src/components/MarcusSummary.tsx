import { useCallback, useEffect, useMemo, useState } from 'react'
import { API_BASE } from '../utils/api'

type AgentHealthStatus = 'ok' | 'warn' | 'fail'

interface MarcusOutlook {
  trendLabel: string
  regime: string
  confidence: number
  distributionDays: number | null
  raw: {
    spyClose: number | null
    spy50ma: number | null
    spy200ma: number | null
    qqqClose: number | null
    qqq50ma: number | null
    spyAbove50ma: boolean | null
    qqqAbove50ma: boolean | null
    isFollowThroughDay: boolean | null
  }
}

interface MarcusSummaryResponse {
  updatedAt: string
  market: {
    outlook: MarcusOutlook
    exposureMultiplier: number | null
    agentBudgets: Record<string, number> | null
  }
  aggressiveness: {
    label: string
    recommendedExposurePct: number
    maxPositions: number | null
  }
  news: Array<{
    title: string
    url: string
    publishedAt: string | null
    source: string
  }>
  subagents: Array<{
    agentType: string
    name: string
    status: AgentHealthStatus
    confidencePct: number
    notes: string
    improvements: string[]
    latestAb: null | {
      runNumber: number | null
      signalsEvaluated: number | null
      promoted: boolean
      deltaAvgReturn: number | null
      completedAt: string | null
    }
  }>
  improvements: string[]
}

function pillColorByStatus(status: AgentHealthStatus) {
  if (status === 'ok') return 'bg-emerald-500/20 text-emerald-300 border border-emerald-700/60'
  if (status === 'warn') return 'bg-amber-500/20 text-amber-300 border border-amber-700/60'
  return 'bg-red-500/20 text-red-300 border border-red-700/60'
}

function pillColorByTrend(trendLabel: string) {
  const t = (trendLabel || '').toLowerCase()
  if (t.includes('confirmed')) return 'bg-emerald-500/20 text-emerald-300 border border-emerald-700/60'
  if (t.includes('pressure')) return 'bg-amber-500/20 text-amber-300 border border-amber-700/60'
  if (t.includes('correction')) return 'bg-orange-500/20 text-orange-300 border border-orange-700/60'
  if (t.includes('downtrend')) return 'bg-red-500/20 text-red-300 border border-red-700/60'
  return 'bg-slate-700/60 text-slate-300 border border-slate-600'
}

export default function MarcusSummary() {
  const [data, setData] = useState<MarcusSummaryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [runMessage, setRunMessage] = useState<string | null>(null)
  const [briefing, setBriefing] = useState<string | null>(null)

  const refresh = useCallback(() => {
    setLoading(true)
    setError(null)
    fetch(`${API_BASE}/api/marcus/summary`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const j = await res.json()
        setData(j)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const runMission = useCallback(() => {
    if (runStatus === 'running') return
    setRunStatus('running')
    setRunMessage('Starting…')
    setBriefing(null)

    fetch(`${API_BASE}/api/marcus/orchestrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ tickerLimit: 120, forceRefresh: false }),
    })
      .then(async (resp) => {
        if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`)
        const reader = resp.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const parts = buf.split('\n')
          buf = parts.pop() ?? ''

          for (const line of parts) {
            if (!line.startsWith('data:')) continue
            try {
              const ev = JSON.parse(line.slice(5).trim()) as { message?: string; briefing?: string; done?: boolean; result?: { briefing?: string } }
              if (ev.message) setRunMessage(ev.message)
              if (ev.briefing) setBriefing(ev.briefing)
              if (ev.done) {
                setRunStatus('done')
                const b = ev.result?.briefing
                if (typeof b === 'string') setBriefing(b)
                refresh()
              }
            } catch {
              // ignore malformed SSE
            }
          }
        }
      })
      .catch((e: unknown) => {
        setRunStatus('error')
        setRunMessage(e instanceof Error ? e.message : String(e))
      })
  }, [refresh, runStatus])

  const budgetList = useMemo(() => {
    const b = data?.market?.agentBudgets
    if (!b) return []
    return Object.entries(b)
      .sort(([, a], [, c]) => c - a)
      .map(([k, v]) => ({ k, v }))
  }, [data?.market?.agentBudgets])

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <div className="text-slate-400 text-sm">Loading Marcus summary…</div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-slate-100">Marcus — Money Manager</div>
          <div className="text-xs text-slate-500 mt-0.5">
            {data?.updatedAt ? `Updated ${new Date(data.updatedAt).toLocaleString()}` : '—'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={runMission}
            disabled={runStatus === 'running'}
            className="text-xs px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white"
          >
            {runStatus === 'running' ? 'Running…' : 'Run mission'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-red-300 text-sm">
          Failed to load: {error}
        </div>
      )}

      {data && (
        <>
          {/* Market summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-lg border border-slate-800 bg-slate-950/30 p-4">
              <div className="text-xs text-slate-500 mb-1">Market trend</div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${pillColorByTrend(data.market.outlook.trendLabel)}`}>
                  {data.market.outlook.trendLabel}
                </span>
                <span className="text-xs text-slate-500">
                  {data.market.outlook.regime} · {data.market.outlook.confidence}%
                </span>
              </div>
              <div className="text-xs text-slate-400 mt-2">
                Distribution days: {data.market.outlook.distributionDays ?? '—'} · FTD: {data.market.outlook.raw.isFollowThroughDay ? 'Yes' : 'No'}
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/30 p-4">
              <div className="text-xs text-slate-500 mb-1">How aggressive to be</div>
              <div className="flex items-baseline gap-2">
                <div className="text-2xl font-bold text-slate-100">{data.aggressiveness.recommendedExposurePct}%</div>
                <div className="text-sm text-slate-300">{data.aggressiveness.label}</div>
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Max positions: {data.aggressiveness.maxPositions ?? '—'}
              </div>
              {budgetList.length > 0 && (
                <div className="mt-2 text-xs text-slate-500">
                  Budgets: {budgetList.map((b) => `${b.k.replace(/_/g, ' ')} ${(b.v * 100).toFixed(0)}%`).join(' · ')}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/30 p-4">
              <div className="text-xs text-slate-500 mb-1">Focus today</div>
              {data.improvements?.length ? (
                <ul className="text-xs text-slate-300 space-y-1">
                  {data.improvements.slice(0, 3).map((x, i) => (
                    <li key={i}>- {x}</li>
                  ))}
                </ul>
              ) : (
                <div className="text-xs text-slate-400">No warnings.</div>
              )}
            </div>
          </div>

          {/* Run status */}
          {(runMessage || briefing) && (
            <div className="rounded-lg border border-slate-800 bg-slate-950/30 p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-slate-500">Mission status</div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${pillColorByStatus(runStatus === 'done' ? 'ok' : runStatus === 'error' ? 'fail' : 'warn')}`}>
                  {runStatus}
                </span>
              </div>
              {runMessage && <div className="text-sm text-slate-300 mt-2">{runMessage}</div>}
              {briefing && (
                <pre className="mt-3 whitespace-pre-wrap text-xs text-slate-300 font-mono bg-slate-950/50 border border-slate-800 rounded-lg p-3 max-h-80 overflow-auto">
                  {briefing}
                </pre>
              )}
            </div>
          )}

          {/* News */}
          <div className="rounded-lg border border-slate-800 bg-slate-950/30 p-4">
            <div className="text-xs text-slate-500 mb-2">Top news</div>
            {data.news?.length ? (
              <ul className="space-y-2">
                {data.news.slice(0, 8).map((n) => (
                  <li key={n.url} className="text-sm">
                    <a
                      href={n.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sky-300 hover:text-sky-200"
                    >
                      {n.title}
                    </a>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {n.source}{n.publishedAt ? ` · ${new Date(n.publishedAt).toLocaleString()}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-xs text-slate-400">No news available.</div>
            )}
          </div>

          {/* Subagent health */}
          <div className="rounded-lg border border-slate-800 bg-slate-950/30 p-4">
            <div className="text-xs text-slate-500 mb-2">Subagent health</div>
            <div className="overflow-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="text-xs text-slate-500">
                  <tr className="border-b border-slate-800">
                    <th className="text-left py-2 pr-3">Agent</th>
                    <th className="text-left py-2 pr-3">Status</th>
                    <th className="text-right py-2 pr-3">Confidence</th>
                    <th className="text-left py-2 pr-3">Notes</th>
                    <th className="text-left py-2">Improvement</th>
                  </tr>
                </thead>
                <tbody>
                  {data.subagents.map((a) => (
                    <tr key={a.agentType} className="border-b border-slate-800/60 align-top">
                      <td className="py-2 pr-3 text-slate-100 font-medium">{a.name}</td>
                      <td className="py-2 pr-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${pillColorByStatus(a.status)}`}>
                          {a.status}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right font-mono tabular-nums text-slate-200">
                        {a.confidencePct}%
                      </td>
                      <td className="py-2 pr-3 text-slate-400 text-xs">
                        {a.notes}
                      </td>
                      <td className="py-2 text-slate-300 text-xs">
                        {a.improvements?.length ? a.improvements[0] : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </>
      )}
    </div>
  )
}

