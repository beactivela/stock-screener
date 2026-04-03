import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { API_BASE } from '../utils/api'
import { formatCurrencyCompact, formatPercent } from '../utils/atlasSummaryFormat'
import {
  clampTopN,
  computeAgentRange,
  topNSelectOptions,
  topWeightedAgentEntries,
} from '../utils/atlasAgentWeights'

const AtlasSparkline = lazy(() => import('../components/AtlasSparkline'))

type AtlasSummary = {
  period?: string
  trading_days?: number
  starting_value?: number
  ending_value?: number
  total_return_pct?: number
  autoresearch?: {
    total_modifications?: number
    kept?: number
    reverted?: number
    keep_rate_pct?: number
  }
  final_agent_weights?: Record<string, number>
}

type FreshnessEntry =
  | { path: string; mtimeMs: number; mtimeIso: string }
  | { path: string; error?: string }

type AtlasFreshnessMeta = {
  summary: FreshnessEntry
  trajectory: FreshnessEntry
}

type AtlasResponse = {
  ok: boolean
  summary?: AtlasSummary
  sparkline?: {
    points: Array<{ time: string; value: number }>
    field: string
  } | null
  meta?: {
    repoUrl?: string
    summaryPath?: string
    freshness?: AtlasFreshnessMeta
  }
  error?: string
}

function formatFreshnessLine(label: string, entry: FreshnessEntry | undefined): string {
  if (!entry) return `${label}: —`
  if ('error' in entry && entry.error === 'not_found') return `${label}: not found`
  if ('mtimeIso' in entry && entry.mtimeIso) {
    const d = new Date(entry.mtimeIso)
    const formatted = Number.isNaN(d.getTime()) ? entry.mtimeIso : d.toLocaleString()
    return `${label}: ${formatted}`
  }
  return `${label}: —`
}

export default function Atlas() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<AtlasSummary | null>(null)
  const [sparkline, setSparkline] = useState<AtlasResponse['sparkline']>(null)
  const [freshness, setFreshness] = useState<AtlasFreshnessMeta | undefined>(undefined)
  const [repoUrl, setRepoUrl] = useState('https://github.com/chrisworsey55/atlas-gic')
  const [topN, setTopN] = useState(8)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/atlas/summary`, { cache: 'no-store' })
        const json = (await res.json()) as AtlasResponse
        if (cancelled) return
        if (!res.ok || !json.ok || !json.summary) {
          setError(json.error || `Failed loading ATLAS summary (HTTP ${res.status}).`)
          setLoading(false)
          return
        }
        setSummary(json.summary)
        setSparkline(json.sparkline ?? null)
        setFreshness(json.meta?.freshness)
        if (json.meta?.repoUrl) setRepoUrl(json.meta.repoUrl)
        setLoading(false)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Network error loading ATLAS summary.')
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const weightCount = useMemo(
    () => Object.keys(summary?.final_agent_weights || {}).length,
    [summary?.final_agent_weights],
  )

  const agentRange = useMemo(() => computeAgentRange(weightCount), [weightCount])

  useEffect(() => {
    if (weightCount === 0) return
    const { maxAgents, minAgents } = agentRange
    setTopN((prev) => Math.min(Math.max(minAgents, prev), maxAgents))
  }, [weightCount, agentRange])

  const topWeightedAgents = useMemo(
    () => topWeightedAgentEntries(summary?.final_agent_weights, topN, agentRange),
    [summary, topN, agentRange],
  )

  const freshnessTitle = useMemo(() => {
    if (!freshness) return undefined
    return [formatFreshnessLine('summary.json', freshness.summary), formatFreshnessLine('portfolio_trajectory.csv', freshness.trajectory)].join(
      '\n',
    )
  }, [freshness])

  const topNOptions = useMemo(() => topNSelectOptions(agentRange), [agentRange])

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">ATLAS Web UI</h1>
          <p className="text-sm text-slate-500 mt-1">
            Live view of the vendored ATLAS summary data from <code className="text-sky-400/90">vendor/atlas-gic</code>.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-end">
          {freshness && (
            <span
              className="text-xs px-2.5 py-1.5 rounded-md border border-slate-600 bg-slate-800/60 text-slate-400 max-w-[min(100vw-2rem,22rem)] truncate"
              title={freshnessTitle}
            >
              Data: summary + trajectory ·{' '}
              {'mtimeIso' in freshness.summary && freshness.summary.mtimeIso
                ? new Date(freshness.summary.mtimeIso).toLocaleString()
                : '—'}
            </span>
          )}
          <a
            href={repoUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm px-3 py-2 rounded-lg border border-slate-600 text-slate-300 hover:text-slate-100 hover:border-slate-500 shrink-0"
          >
            Open Repo
          </a>
        </div>
      </div>

      {loading && <div className="text-slate-400 text-sm">Loading ATLAS summary…</div>}

      {error && (
        <div className="rounded-lg border border-red-800/70 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {!loading && !error && summary && (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <MetricCard label="Backtest Period" value={summary.period || 'N/A'} />
            <MetricCard label="Trading Days" value={String(summary.trading_days ?? 'N/A')} />
            <MetricCard label="Start Value" value={formatCurrencyCompact(summary.starting_value)} />
            <MetricCard label="End Value" value={formatCurrencyCompact(summary.ending_value)} />
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <MetricCard label="Total Return" value={formatPercent(summary.total_return_pct)} />
            <MetricCard label="Prompt Mods" value={String(summary.autoresearch?.total_modifications ?? 'N/A')} />
            <MetricCard label="Kept" value={String(summary.autoresearch?.kept ?? 'N/A')} />
            <MetricCard label="Keep Rate" value={formatPercent(summary.autoresearch?.keep_rate_pct)} />
          </div>

          <section className="rounded-xl border border-slate-700 bg-slate-800/40 p-5 space-y-3">
            <h2 className="text-sm font-semibold text-slate-200">Portfolio trajectory</h2>
            {sparkline?.points?.length ? (
              <Suspense fallback={<div className="text-slate-500 text-sm h-[112px] flex items-center">Loading chart…</div>}>
                <AtlasSparkline points={sparkline.points} />
              </Suspense>
            ) : (
              <p className="text-sm text-slate-500">No trajectory data (missing or unreadable portfolio_trajectory.csv).</p>
            )}
          </section>

          <section className="rounded-xl border border-slate-700 bg-slate-800/40 p-5 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-sm font-semibold text-slate-200">Top agent weights</h2>
              {weightCount > 0 && (
                <label className="flex items-center gap-2 text-sm text-slate-400">
                  <span>Show top</span>
                  <select
                    className="rounded-lg border border-slate-600 bg-slate-900 px-2 py-1.5 text-slate-200 text-sm"
                    value={clampTopN(topN, agentRange)}
                    onChange={(e) => setTopN(Number(e.target.value))}
                  >
                    {topNOptions.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {topWeightedAgents.map(([agent, weight]) => (
                <div key={agent} className="rounded-lg border border-slate-700/80 bg-slate-900/40 px-3 py-2">
                  <div className="text-xs text-slate-500">{agent}</div>
                  <div className="text-base text-slate-100 font-semibold">{weight.toFixed(2)}</div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-100">{value}</div>
    </div>
  )
}
