/**
 * Agents — Visual Hierarchy Dashboard
 *
 * Displays the full multi-agent system hierarchy and the Northstar doctrine
 * that governs every agent's decision-making.
 */

import { useEffect, useState, useCallback } from 'react'
import { API_BASE } from '../utils/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentMeta {
  name: string
  agentType: string
  model?: string
  role?: string
  description?: string
  mandatoryOverrides?: Record<string, unknown>
}

/** Metrics shown on strategy agent cards (Avg Return, Win Rate, PF, Activity%, runs/promoted) */
interface StrategyAgentMetrics {
  avgReturnPct: number
  winRatePct: number
  profitFactor: number
  activityPct: number
  runs: number
  promoted: number
  weightsLabel?: string
}

/** Default strategy metrics (from design); can be overridden by Marcus summary / API */
const DEFAULT_STRATEGY_METRICS: Record<string, { metrics: StrategyAgentMetrics; description: string }> = {
  momentum_scout: {
    description: 'Steep uptrend, RS 85+, near 52w highs',
    metrics: { avgReturnPct: 3.9, winRatePct: 55.7, profitFactor: 2.98, activityPct: 10, runs: 17, promoted: 0, weightsLabel: 'Default weights' },
  },
  base_hunter: {
    description: 'Deep VCP bases, 4+ contractions, volume dry-up',
    metrics: { avgReturnPct: 5.2, winRatePct: 57.0, profitFactor: 3.66, activityPct: 70, runs: 17, promoted: 1, weightsLabel: 'Default weights' },
  },
  breakout_tracker: {
    description: 'Tight consolidation, within 5% of highs',
    metrics: { avgReturnPct: 0.8, winRatePct: 47.3, profitFactor: 1.3, activityPct: 20, runs: 11, promoted: 0, weightsLabel: 'Default weights' },
  },
  turtle_trader: {
    description: 'Donchian 20/55d breakouts, 2N stop, 10/20d exit',
    metrics: { avgReturnPct: 4.3, winRatePct: 52.5, profitFactor: 2.2, activityPct: 25, runs: 8, promoted: 0, weightsLabel: 'Default weights' },
  },
  ma_crossover_10_20: {
    description: 'Buy on 10/20 MA cross, exit below 10 MA',
    metrics: { avgReturnPct: 3.2, winRatePct: 50.4, profitFactor: 1.8, activityPct: 15, runs: 0, promoted: 0, weightsLabel: 'Default weights' },
  },
}

interface ManifestResponse {
  ceo: AgentMeta & { title?: string; northStar?: string; subagents?: string[] }
  subagents?: AgentMeta[]
}

/** Cron state from GET /api/heartbeat (5-min in-server scheduler) */
interface HeartbeatCronState {
  enabled: boolean
  status: 'idle' | 'running'
  lastRun: string | null
  lastResult: { regime?: string; signalCount?: number; elapsedMs?: number; error?: string } | null
  nextRun: string | null
}

// ─── Shared UI primitives ─────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-3">
      {children}
    </div>
  )
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-700 bg-slate-800/40 ${className}`}>
      {children}
    </div>
  )
}

// ─── Model badge ──────────────────────────────────────────────────────────────

function modelBadge(model?: string) {
  if (!model) return 'bg-slate-700 text-slate-400'
  const m = model.toLowerCase()
  if (m.includes('high')) return 'bg-purple-900/60 text-purple-300 border border-purple-700'
  if (m.includes('low'))  return 'bg-slate-700/80 text-slate-400 border border-slate-600'
  return 'bg-sky-900/60 text-sky-300 border border-sky-700'
}

function ModelBadge({ model }: { model?: string }) {
  if (!model) return null
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap ${modelBadge(model)}`}>
      {model}
    </span>
  )
}

// ─── Role icon ────────────────────────────────────────────────────────────────

function roleIcon(role?: string) {
  switch (role?.toLowerCase()) {
    case 'overseer':       return '👑'
    case 'data fetcher':   return '🗂️'
    case 'signal scorer':  return '🎯'
    case 'strategy agent': return '🤖'
    default:               return '⚙️'
  }
}

/** Per-strategy avatar from second image: lightning, magnifying glass, rocket */
function strategyAgentIcon(agent: AgentMeta): string {
  const t = (agent.agentType || '').toLowerCase()
  if (t === 'momentum_scout') return '⚡'
  if (t === 'base_hunter') return '🔍'
  if (t === 'breakout_tracker') return '🚀'
  if (t === 'turtle_trader') return '🐢'
  if (t === 'ma_crossover_10_20') return '🔀'
  return '🤖'
}

// ─── Connector lines ──────────────────────────────────────────────────────────

function ConnectorDown() {
  return (
    <div className="flex justify-center py-1">
      <div className="w-px h-8 bg-gradient-to-b from-sky-500/50 to-transparent" />
    </div>
  )
}

function ConnectorFork({ count }: { count: number }) {
  if (count <= 1) return <ConnectorDown />
  const W = Math.max(480, count * 180)
  return (
    <div className="flex justify-center py-1 overflow-visible">
      <svg width={W} height="32" viewBox={`0 0 ${W} 32`} className="overflow-visible">
        <line x1="50%" y1="0" x2="50%" y2="16" stroke="rgb(56 189 248 / 0.45)" strokeWidth="1.5" />
        <line
          x1={`${(0.5 / count) * 100}%`} y1="16"
          x2={`${((count - 0.5) / count) * 100}%`} y2="16"
          stroke="rgb(56 189 248 / 0.25)" strokeWidth="1.5"
        />
        {Array.from({ length: count }).map((_, i) => {
          const x = `${((i + 0.5) / count) * 100}%`
          return <line key={i} x1={x} y1="16" x2={x} y2="32" stroke="rgb(56 189 248 / 0.25)" strokeWidth="1.5" />
        })}
      </svg>
    </div>
  )
}

// ─── Harry Fetch 5yr History (button + progress) ───────────────────────────────

function HarryFetchButton() {
  const [status, setStatus] = useState<'idle' | 'fetching' | 'done' | 'error'>('idle')
  const [progress, setProgress] = useState<{ current: number; total: number; ticker?: string; message?: string } | null>(null)
  const [resultMessage, setResultMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [harryStats, setHarryStats] = useState<{
    count: number
    totalTickers: number
    lastFetchAt: string | null
  } | null>(null)

  const fetchOhlcCount = useCallback(() => {
    fetch(`${API_BASE}/api/agents/harry/ohlc-count`, { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data == null || typeof data.count !== 'number') return
        setHarryStats({
          count: data.count,
          totalTickers: typeof data.totalTickers === 'number' ? data.totalTickers : data.count,
          lastFetchAt: data.lastFetchAt ?? null,
        })
      })
      .catch(() => {})
  }, [])

  // Sync with server on mount (e.g. user left during fetch and came back)
  useEffect(() => {
    fetchOhlcCount()
    fetch(`${API_BASE}/api/agents/harry/fetch/status`, { cache: 'no-store' })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data || data.status === 'idle') return
        if (data.status === 'running') {
          setStatus('fetching')
          setProgress(
            data.total != null
              ? { current: data.current ?? 0, total: data.total, message: data.message ?? undefined, ticker: data.ticker }
              : { current: 0, total: 1, message: data.message ?? 'Starting…' }
          )
        } else if (data.status === 'done' && data.result) {
          setStatus('done')
          setResultMessage(
            data.result.success
              ? `Saved ${data.result.signalCount ?? 0} signals to database.`
              : data.result.error ?? 'Fetch failed.'
          )
          setProgress(null)
          fetchOhlcCount()
        } else if (data.status === 'error') {
          setStatus('error')
          setErrorMessage(data.error ?? 'Unknown error')
          setProgress(null)
        }
      })
      .catch(() => {})
  }, [fetchOhlcCount])

  // Poll progress while fetching (works when user leaves and comes back)
  useEffect(() => {
    if (status !== 'fetching') return
    const poll = () => {
      fetch(`${API_BASE}/api/agents/harry/fetch/status`, { cache: 'no-store' })
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (!data) return
          if (data.status === 'running') {
            setProgress(
              data.total != null
                ? { current: data.current ?? 0, total: data.total, message: data.message ?? undefined, ticker: data.ticker }
                : (p) => (p ? { ...p, message: data.message ?? p.message } : { current: 0, total: 1, message: data.message ?? 'Running…' })
            )
          } else if (data.status === 'done' && data.result) {
            setStatus('done')
            setResultMessage(
              data.result.success
                ? `Saved ${data.result.signalCount ?? 0} signals to database.`
                : data.result.error ?? 'Fetch failed.'
            )
            setProgress(null)
            fetchOhlcCount()
          } else if (data.status === 'error') {
            setStatus('error')
            setErrorMessage(data.error ?? 'Unknown error')
            setProgress(null)
          }
        })
        .catch(() => {})
    }
    poll()
    const id = setInterval(poll, 2000)
    return () => clearInterval(id)
  }, [status, fetchOhlcCount])

  const runFetch = useCallback(() => {
    setStatus('fetching')
    setProgress(null)
    setResultMessage(null)
    setErrorMessage(null)

    fetch(`${API_BASE}/api/agents/harry/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ tickerLimit: 0, forceRefresh: true }),
    })
      .then(async (resp) => {
        if (!resp.ok || !resp.body) throw new Error(resp.status ? `HTTP ${resp.status}` : 'No response body')
        const reader = resp.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''

          for (const line of lines) {
            if (!line.startsWith('data:')) continue
            try {
              const ev = JSON.parse(line.slice(5).trim()) as {
                phase?: string
                message?: string
                current?: number
                total?: number
                ticker?: string
                signalCount?: number
                done?: boolean
                result?: { success?: boolean; signalCount?: number; error?: string }
                error?: string
              }
              if (ev.done) {
                if (ev.error) {
                  setStatus('error')
                  setErrorMessage(ev.error)
                } else if (ev.result) {
                  setStatus('done')
                  setResultMessage(
                    ev.result.success
                      ? `Saved ${ev.result.signalCount ?? 0} signals to database.`
                      : ev.result.error ?? 'Fetch failed.'
                  )
                  if (!ev.result.success && ev.result.error) setErrorMessage(ev.result.error)
                  if (ev.result?.success) fetchOhlcCount()
                }
                setProgress(null)
                return
              }
              if (ev.phase === 'scanning' && ev.total != null) {
                setProgress({
                  current: ev.current ?? 0,
                  total: ev.total,
                  ticker: ev.ticker,
                  message: ev.message ?? undefined,
                })
              } else if (ev.phase === 'saving' || ev.phase === 'starting' || ev.phase === 'checking_db' || ev.phase === 'db_cache') {
                setProgress((p) => ({ ...p ?? { current: 0, total: 1 }, message: ev.message ?? undefined }))
              } else if (ev.phase === 'done' && ev.signalCount != null) {
                setProgress((p) => (p ? { ...p, current: p.total, message: ev.message ?? undefined } : null))
              }
            } catch {
              // ignore malformed SSE
            }
          }
        }
        setStatus('done')
        setProgress(null)
      })
      .catch((e: unknown) => {
        setStatus('error')
        setErrorMessage(e instanceof Error ? e.message : String(e))
        setProgress(null)
      })
  }, [fetchOhlcCount])

  const pct = progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0

  const lastFetchLabel = harryStats?.lastFetchAt
    ? new Date(harryStats.lastFetchAt).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : null

  return (
    <div className="space-y-2">
      {harryStats !== null && (
        <div className="text-[11px] text-slate-500 space-y-0.5">
          <p>
            <span className="text-slate-400 font-medium">{harryStats.count}</span> with 5yr OHLC
            {harryStats.totalTickers > 0 && (
              <> · <span className="text-slate-400 font-medium">{harryStats.totalTickers - harryStats.count}</span> without (of {harryStats.totalTickers} in DB)</>
            )}
          </p>
          <p>
            Last fetch: {lastFetchLabel ?? 'Never'}
          </p>
        </div>
      )}
      <button
        type="button"
        onClick={runFetch}
        disabled={status === 'fetching'}
        className="text-xs px-3 py-1.5 rounded-lg border border-sky-600 bg-sky-900/30 text-sky-300 hover:bg-sky-800/40 hover:border-sky-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {status === 'fetching' ? 'Fetching…' : 'Fetch 5yr history'}
      </button>
      {status === 'fetching' && progress != null && (
        <div className="space-y-1">
          <div className="h-1.5 w-full rounded-full bg-slate-700 overflow-hidden">
            <div
              className="h-full bg-sky-500 rounded-full transition-all duration-300"
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
          <p className="text-[10px] text-slate-500 truncate">
            {progress.message ?? (progress.total > 0 ? `${progress.current} / ${progress.total}` : 'Preparing…')}
          </p>
        </div>
      )}
      {status === 'done' && resultMessage && (
        <p className="text-[11px] text-emerald-400">{resultMessage}</p>
      )}
      {status === 'error' && errorMessage && (
        <p className="text-[11px] text-red-400">{errorMessage}</p>
      )}
    </div>
  )
}

// ─── Agent Card ───────────────────────────────────────────────────────────────

function AgentCard({
  agent,
  highlight = false,
  size = 'md',
  actions,
  strategyMetrics: strategyMetricsProp,
}: {
  agent: AgentMeta
  highlight?: boolean
  size?: 'sm' | 'md' | 'lg'
  /** Optional slot for card-specific actions (e.g. Harry's "Fetch 5yr history" button) */
  actions?: React.ReactNode
  /** For Signal agents: Avg Return, Win Rate, PF, Activity%, runs/promoted (uses defaults when omitted) */
  strategyMetrics?: StrategyAgentMetrics | null
}) {
  const pad   = size === 'lg' ? 'p-6'  : size === 'sm' ? 'p-3' : 'p-4'
  const title = size === 'lg' ? 'text-xl font-bold' : size === 'sm' ? 'text-sm font-semibold' : 'text-base font-semibold'
  const ring  = highlight
    ? 'border-sky-500 bg-sky-950/40 shadow-lg shadow-sky-900/20'
    : 'border-slate-700 bg-slate-800/40'

  const isStrategyAgent = agent.role === 'Signal Agent' || agent.role === 'Strategy Agent'
  const defaultMeta = isStrategyAgent ? DEFAULT_STRATEGY_METRICS[agent.agentType] : null
  const description = agent.description || defaultMeta?.description
  const metrics = isStrategyAgent
    ? (strategyMetricsProp ?? defaultMeta?.metrics)
    : null

  const avatarIcon = isStrategyAgent ? strategyAgentIcon(agent) : roleIcon(agent.role)

  return (
    <div className={`rounded-xl border ${ring} ${pad} flex flex-col gap-2.5`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl leading-none">{avatarIcon}</span>
          <div>
            <div className={`${title} text-slate-100`}>{agent.name}</div>
            {agent.role && <div className="text-[11px] text-slate-500 mt-0.5">{agent.role === 'Strategy Agent' ? 'Signal agent' : agent.role}</div>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {metrics != null && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-700/60">
              {metrics.activityPct}% Active
            </span>
          )}
          <ModelBadge model={agent.model} />
        </div>
      </div>

      {description && (
        <p className="text-xs text-slate-400 leading-relaxed">{description}</p>
      )}

      {metrics != null && (
        <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-700/50">
          <div className="bg-slate-900/60 rounded-lg p-2">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Avg Return</div>
            <div className="text-sm font-medium text-emerald-400">+{metrics.avgReturnPct.toFixed(2)}%</div>
          </div>
          <div className="bg-slate-900/60 rounded-lg p-2">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">Win Rate</div>
            <div className="text-sm font-medium text-slate-200">{metrics.winRatePct.toFixed(1)}%</div>
          </div>
          <div className="bg-slate-900/60 rounded-lg p-2">
            <div className="text-[10px] text-slate-500 uppercase tracking-wider">PF</div>
            <div className="text-sm font-medium text-slate-200">{metrics.profitFactor.toFixed(2)}</div>
          </div>
        </div>
      )}

      {metrics != null && (metrics.weightsLabel != null || metrics.runs != null) && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 pt-0.5">
          {metrics.weightsLabel != null && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" aria-hidden />
              {metrics.weightsLabel}
            </span>
          )}
          <span>{metrics.runs} runs — {metrics.promoted} promoted</span>
        </div>
      )}

      {actions != null && <div className="pt-1 border-t border-slate-700/50">{actions}</div>}

      {agent.mandatoryOverrides && Object.keys(agent.mandatoryOverrides).length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1 border-t border-slate-700/50">
          {Object.entries(agent.mandatoryOverrides).map(([k, v]) => (
            <span key={k} className="text-[10px] bg-slate-700/50 text-slate-400 px-1.5 py-0.5 rounded font-mono">
              {k}: <span className="text-slate-200">{String(v)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Compact Heartbeat strip (toggle + animation + last run only) ───────────────

function HeartbeatStrip({
  cron,
  onCronToggle,
  cronToggleLoading,
}: {
  cron: HeartbeatCronState | null
  onCronToggle: (enable: boolean) => void
  cronToggleLoading: boolean
}) {
  const cronOn = cron?.enabled ?? false
  const displayLastRun = cron?.lastRun ? new Date(cron.lastRun).toLocaleTimeString() : '—'
  const isRunning = cron?.status === 'running'

  return (
    <div className="flex items-center gap-3 shrink-0">
      <span className="text-[11px] text-slate-500">Heartbeat</span>
      <span
        className={`text-xl leading-none ${cronOn || isRunning ? 'inline-block animate-heartbeat' : ''}`}
        aria-hidden="true"
      >
        🫀
      </span>
      <span className="text-[11px] text-slate-400 tabular-nums">Last: {displayLastRun}</span>
      <div
        className={`flex items-center gap-1.5 select-none ${cronToggleLoading ? 'opacity-60 cursor-wait' : 'cursor-pointer'}`}
        role="button"
        tabIndex={0}
        aria-label={cronOn ? 'Turn off Heartbeat cron' : 'Turn on Heartbeat cron'}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (!cronToggleLoading) onCronToggle(!cronOn)
        }}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !cronToggleLoading) {
            e.preventDefault()
            onCronToggle(!cronOn)
          }
        }}
      >
        <span
          className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${cronOn ? 'bg-sky-600' : 'bg-slate-600'}`}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition ${cronOn ? 'translate-x-4' : 'translate-x-0.5'}`}
          />
        </span>
        <span className="text-[11px] text-slate-400 w-5">{cronOn ? 'On' : 'Off'}</span>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Agents() {
  const [manifest, setManifest] = useState<ManifestResponse | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [heartbeatCron, setHeartbeatCron] = useState<HeartbeatCronState | null>(null)
  const [cronToggleLoading, setCronToggleLoading] = useState(false)

  useEffect(() => {
    fetch(`${API_BASE}/api/agents/manifest`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((data) => { setManifest(data); setLoading(false) })
      .catch((e)  => { setError(e.message); setLoading(false) })
  }, [])

  const fetchHeartbeat = useCallback(() => {
    fetch(`${API_BASE}/api/heartbeat`, { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(setHeartbeatCron)
      .catch(() => { /* keep previous state so toggle doesn’t reset on network/500 */ })
  }, [])
  useEffect(() => { fetchHeartbeat() }, [fetchHeartbeat])
  useEffect(() => {
    if (!heartbeatCron?.enabled) return
    const t = setInterval(fetchHeartbeat, 30_000)
    return () => clearInterval(t)
  }, [heartbeatCron?.enabled, fetchHeartbeat])

  const handleCronToggle = useCallback((enable: boolean) => {
    // Optimistic update so toggle flips immediately
    setHeartbeatCron((prev) =>
      prev
        ? { ...prev, enabled: enable }
        : { enabled: enable, status: 'idle', lastRun: null, lastResult: null, nextRun: null }
    )
    setCronToggleLoading(true)
    const endpoint = enable ? `${API_BASE}/api/heartbeat/start` : `${API_BASE}/api/heartbeat/stop`
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(() => fetchHeartbeat())
      .catch(() => fetchHeartbeat())
      .finally(() => setCronToggleLoading(false))
  }, [fetchHeartbeat])


  const allSubagents   = manifest?.subagents ?? []
  const dataAgents     = allSubagents.filter((a) => a.role === 'Data Fetcher')
  const strategyAgents = allSubagents.filter((a) => a.role === 'Signal Agent' || a.role === 'Strategy Agent')

  return (
    <div className="max-w-5xl mx-auto space-y-8">

      {/* ── Header: title + compact Heartbeat (toggle, animation, last run) ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Agent Hierarchy</h1>
        </div>
        <HeartbeatStrip
          cron={heartbeatCron}
          onCronToggle={handleCronToggle}
          cronToggleLoading={cronToggleLoading}
        />
      </div>

      {/* ── Loading / Error ── */}
      {loading && <div className="text-slate-400 text-sm">Loading agent manifest…</div>}
      {error   && (
        <div className="rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-red-300 text-sm">
          Failed to load manifest: {error}
        </div>
      )}

      {/* ── Agent Hierarchy ── */}
      {manifest && (
        <>
          {/* Tier 1 — Marcus CEO + Northstar statement */}
          <section>
            <AgentCard
              agent={{
                ...manifest.ceo,
                role: manifest.ceo.title || manifest.ceo.role || 'Overseer',
              }}
              highlight
              size="lg"
            />
          </section>

          {/* Signal agents (Momentum Scout, Base Hunter, Breakout Tracker) */}
          <section>
            <SectionLabel>Signal agents</SectionLabel>
            {strategyAgents.length > 0 ? (
              <>
                <ConnectorFork count={strategyAgents.length} />
                <div className={`grid gap-3 ${
                  strategyAgents.length >= 4 ? 'grid-cols-4' :
                  strategyAgents.length === 3 ? 'grid-cols-3' : 'grid-cols-2'
                }`}>
                  {strategyAgents.map((a) => <AgentCard key={a.agentType} agent={a} size="sm" />)}
                </div>
              </>
            ) : (
              <div className="text-slate-500 text-sm">No signal agents in manifest.</div>
            )}
          </section>

          {/* Tier 2 — Harry (Data Fetching), compact, at bottom */}
          <section>
            <SectionLabel>Tier 2 — Data Fetching</SectionLabel>
            {dataAgents.length > 0 ? (
              <div className="grid gap-3 grid-cols-1 max-w-md">
                {dataAgents.map((a) => (
                  <AgentCard
                    key={a.agentType}
                    agent={a}
                    size="sm"
                    actions={a.agentType === 'harry_historian' ? <HarryFetchButton /> : undefined}
                  />
                ))}
              </div>
            ) : (
              <div className="text-slate-500 text-sm">No data agents in manifest.</div>
            )}
          </section>
        </>
      )}

      {/* ── How it works ── */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-slate-300 mb-3">How the pipeline runs</h3>
        <ol className="space-y-2.5">
          {[
            { who: 'Heartbeat',    what: 'fires every 5 min via Python APScheduler → calls Marcus.' },
            { who: 'Marcus',       what: 'checks regime gate (IBD master switch). BEAR/CORRECTION = no longs.' },
            { who: 'Marcus → Harry', what: 'confirms all tickers have fresh data (≤30 days). Auto-refreshes if stale.' },
            { who: 'Signal agents', what: 'Momentum Scout / Base Hunter / Breakout Tracker / Turtle Trader each run Walk-Forward + Bayesian A/B learning loops to improve avg return.' },
            { who: 'Marcus',       what: 'asks each signal agent for avg return results, enforces regime max-position limit, produces mission briefing.' },
          ].map(({ who, what }, i) => (
            <li key={i} className="flex items-start gap-3 text-sm">
              <span className="text-sky-500 font-bold shrink-0 w-4">{i + 1}.</span>
              <span>
                <span className="text-slate-200 font-medium">{who}</span>
                <span className="text-slate-500"> — {what}</span>
              </span>
            </li>
          ))}
        </ol>
      </Card>

    </div>
  )
}
