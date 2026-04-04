/**
 * Expert overlap — StockCircle (performance-filtered portfolios).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { API_BASE } from '../utils/api'
import { estimatePositionDollarDeltas } from '../utils/stockcircleActionDollars'

interface ExpertWeight {
  investorSlug: string
  firmName: string
  displayName: string
  performance1yPct: number | null
  pctOfPortfolio: number | null
  positionValueUsd: number | null
  actionType: string
  /** % change in shares from last action line (when parsed). */
  actionPct?: number | null
  companyName: string | null
}

interface PopularRow {
  ticker: string
  buying_firms: number | null
  selling_firms: number | null
}

interface LatestRun {
  id: string
  started_at: string
  finished_at: string | null
  status: string
  investors_matched: number | null
  investors_fetched: number | null
  error_message: string | null
}

interface SummaryPayload {
  ok: boolean
  latestRun: LatestRun | null
  popular: PopularRow[]
  expertWeightsByTicker?: Record<string, ExpertWeight[]>
  error?: string
}

export default function StockcircleExperts() {
  const [data, setData] = useState<SummaryPayload | null>(null)
  const [err, setErr] = useState<string | null>(null)
  /** Bump to reload summary (initial load + after Sync). */
  const [refreshToken, setRefreshToken] = useState(0)
  const [postInFlight, setPostInFlight] = useState(false)
  const [syncBanner, setSyncBanner] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/stockcircle/summary`)
        const text = await res.text()
        let json: SummaryPayload
        try {
          json = text.trim()
            ? (JSON.parse(text) as SummaryPayload)
            : { ok: false, error: 'Empty response', latestRun: null, popular: [] }
        } catch {
          if (!cancelled) setErr('Summary response was not valid JSON')
          return
        }
        if (!cancelled) {
          if (!res.ok) {
            setErr(json.error || `${res.status} ${res.statusText}`)
            setData(null)
          } else if (!json.ok) {
            setErr(json.error || 'Unknown error')
            setData(null)
          } else {
            setErr(null)
            setData(json)
          }
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshToken])

  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [])

  async function postExpertsSync(authHeader?: string) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (authHeader) headers.Authorization = authHeader
    return fetch(`${API_BASE}/api/cron/experts-sync`, { method: 'POST', headers })
  }

  async function handleExpertsSync() {
    if (postInFlight) return
    setPostInFlight(true)
    setSyncBanner(null)
    try {
      let res = await postExpertsSync()
      if (res.status === 401) {
        const secret = window.prompt(
          'This server requires CRON_SECRET. Paste it (only used for this request, not stored):'
        )
        if (!secret?.trim()) {
          setSyncBanner({ kind: 'error', text: 'Sync cancelled — secret required.' })
          return
        }
        res = await postExpertsSync(`Bearer ${secret.trim()}`)
      }
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (res.status === 503 && String(json.error || '').includes('CRON_SECRET')) {
        setSyncBanner({
          kind: 'error',
          text: 'Server is not configured for cron triggers (CRON_SECRET).',
        })
        return
      }
      if (!res.ok && res.status !== 202) {
        throw new Error(json.error || res.statusText)
      }
      setSyncBanner({
        kind: 'ok',
        text: 'Sync started on the server (can take several minutes). Refreshing this page every 12s…',
      })
      setRefreshToken((t) => t + 1)
      if (pollRef.current) clearInterval(pollRef.current)
      let n = 0
      pollRef.current = setInterval(() => {
        n += 1
        setRefreshToken((t) => t + 1)
        if (n >= 25) {
          if (pollRef.current) clearInterval(pollRef.current)
          pollRef.current = null
          setSyncBanner({
            kind: 'ok',
            text: 'Auto-refresh paused. Run Sync again or reload if the job was still running.',
          })
        }
      }, 12000)
    } catch (e) {
      setSyncBanner({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setPostInFlight(false)
    }
  }

  const popular = data?.popular ?? []
  const weights = data?.expertWeightsByTicker ?? {}

  function weightsForTicker(ticker: string): ExpertWeight[] {
    const k = String(ticker || '').trim().toUpperCase()
    return weights[k] ?? weights[ticker] ?? []
  }

  /** Experts that appear on at least one popular ticker, sorted by firm name. */
  const expertRows = useMemo(() => {
    const m = new Map<
      string,
      { firmName: string; displayName: string; performance1yPct: number | null }
    >()
    for (const row of popular) {
      for (const w of weightsForTicker(row.ticker)) {
        if (!m.has(w.investorSlug)) {
          m.set(w.investorSlug, {
            firmName: w.firmName,
            displayName: w.displayName,
            performance1yPct: w.performance1yPct,
          })
        }
      }
    }
    return [...m.entries()]
      .sort((a, b) => a[1].firmName.localeCompare(b[1].firmName, undefined, { sensitivity: 'base' }))
      .map(([investorSlug, meta]) => ({ investorSlug, ...meta }))
  }, [popular, weights])

  function findWeight(slug: string, ticker: string): ExpertWeight | null {
    const list = weightsForTicker(ticker)
    return list.find((w) => w.investorSlug === slug) ?? null
  }

  const usdFmt = useMemo(
    () =>
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
        minimumFractionDigits: 0,
      }),
    []
  )

  return (
    <div className="w-full max-w-none px-1 sm:px-0">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <h1 className="text-2xl font-semibold text-slate-100">Expert overlap</h1>
        <button
          type="button"
          onClick={() => void handleExpertsSync()}
          disabled={postInFlight}
          className="shrink-0 rounded-lg border border-sky-600/80 bg-sky-900/40 px-4 py-2 text-sm font-medium text-sky-200 hover:bg-sky-800/50 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Sync latest expert data (StockCircle; server may also run WhaleWisdom)"
        >
          {postInFlight ? 'Starting…' : 'Sync'}
        </button>
      </div>
      {syncBanner && (
        <p
          className={`mb-3 text-sm ${syncBanner.kind === 'error' ? 'text-amber-400' : 'text-emerald-400/95'}`}
          role="status"
        >
          {syncBanner.text}
        </p>
      )}

      {err && (
        <p className="text-amber-400 text-sm mb-4" role="alert">
          {err}
        </p>
      )}

      {data?.latestRun && (
        <p className="text-slate-500 text-sm mb-4">
          Last run:{' '}
          <span className="text-slate-300">
            {data.latestRun.finished_at ? new Date(data.latestRun.finished_at).toLocaleString() : '—'}
          </span>
          {' · '}
          experts in this dataset: {data.latestRun.investors_fetched ?? data.latestRun.investors_matched ?? '—'} (matched
          filter: {data.latestRun.investors_matched ?? '—'})
        </p>
      )}

      {data?.ok && data.latestRun != null && (data.latestRun.investors_fetched ?? 0) < 25 && (
        <div
          className="mb-4 rounded border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-100/95"
          role="note"
        >
          <p className="font-medium text-amber-200/95">Why “Firms buying” is often 1</p>
          <p className="mt-1 text-amber-100/85">
            That column counts experts in the last sync with a <strong>new</strong> or <strong>increased</strong>{' '}
            position — not total purchases.
          </p>
          <p className="mt-2 text-amber-100/85">
            Your last run loaded <strong>{data.latestRun.investors_fetched ?? '—'}</strong> portfolio(s). For more
            overlap on the same ticker, run a <strong>full</strong> StockCircle sync or raise{' '}
            <code className="text-amber-200">STOCKCIRCLE_MAX_INVESTORS</code>.
          </p>
        </div>
      )}

      {!data && !err && <p className="text-slate-500">Loading StockCircle…</p>}

      {data?.ok && popular.length === 0 && (
        <p className="text-slate-500">
          No StockCircle data yet. Run <code className="text-sky-400">npm run stockcircle:sync</code> or POST{' '}
          <code className="text-sky-400">/api/cron/stockcircle-sync</code>
          <span className="text-slate-600"> · </span>
          <code className="text-sky-400">npm run experts:sync</code> also runs StockCircle on the server.
        </p>
      )}

      {popular.length > 0 && expertRows.length > 0 && (
        <div className="mb-3 text-xs text-slate-500">
          Rows are experts; columns are tickers (overlap from the latest sync). Each cell shows % of that
          expert’s portfolio and an estimated $ change for adds (green) or trims/sells (red) from position size
          and action % — not audited.
        </div>
      )}

      {popular.length > 0 && (
        <div className="overflow-x-auto border border-slate-800 rounded-lg max-h-[min(85vh,1200px)] overflow-y-auto">
          <table className="min-w-max text-xs text-left text-slate-300 border-collapse">
            <thead className="bg-slate-900/95 text-slate-400 uppercase sticky top-0 z-20 shadow-sm">
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-30 bg-slate-900/95 px-2 py-2 text-left font-medium border-b border-r border-slate-800 min-w-[10rem]"
                >
                  Expert
                </th>
                {popular.map((row) => (
                  <th
                    key={row.ticker}
                    scope="col"
                    className="px-1.5 py-2 text-center font-medium border-b border-slate-800 align-bottom min-w-[4.5rem] max-w-[6rem]"
                    title={`Buying firms: ${row.buying_firms ?? 0} · Selling: ${row.selling_firms ?? 0}`}
                  >
                    <Link
                      to={`/stock/${row.ticker}`}
                      className="text-sky-400 hover:text-sky-300 font-semibold normal-case tracking-normal"
                    >
                      {row.ticker}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {expertRows.map((ex) => (
                <tr key={ex.investorSlug} className="border-t border-slate-800/80 hover:bg-slate-800/30">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-slate-950/95 px-2 py-1.5 text-left font-normal border-r border-slate-800 align-top whitespace-nowrap"
                  >
                    <Link
                      to={`/experts/${ex.investorSlug}`}
                      className="text-sky-400 hover:underline font-medium text-[0.8125rem]"
                    >
                      {ex.firmName}
                    </Link>
                    {ex.performance1yPct != null && (
                      <span className="block text-[0.65rem] text-slate-500 mt-0.5">
                        1Y {Number(ex.performance1yPct).toFixed(1)}%
                      </span>
                    )}
                  </th>
                  {popular.map((row) => {
                    const w = findWeight(ex.investorSlug, row.ticker)
                    const { increaseUsd, decreaseUsd } = w
                      ? estimatePositionDollarDeltas(
                          w.actionType,
                          w.actionPct ?? null,
                          w.positionValueUsd ?? null
                        )
                      : { increaseUsd: null, decreaseUsd: null }
                    return (
                      <td
                        key={`${ex.investorSlug}-${row.ticker}`}
                        className="px-1 py-1 border-l border-slate-800/60 align-top text-center"
                      >
                        {!w ? (
                          <span className="text-slate-700">·</span>
                        ) : (
                          <div className="flex flex-col items-center gap-0.5 leading-tight">
                            {w.pctOfPortfolio != null ? (
                              <span className="text-slate-200 tabular-nums">{w.pctOfPortfolio.toFixed(1)}%</span>
                            ) : (
                              <span className="text-slate-600">—</span>
                            )}
                            {increaseUsd != null && (
                              <span className="text-emerald-400/95 tabular-nums" title="Est. add / new $">
                                +{usdFmt.format(increaseUsd)}
                              </span>
                            )}
                            {decreaseUsd != null && (
                              <span className="text-rose-400/95 tabular-nums" title="Est. trim / sell $">
                                −{usdFmt.format(decreaseUsd)}
                              </span>
                            )}
                            {increaseUsd == null &&
                              decreaseUsd == null &&
                              w.actionType !== 'unknown' && (
                                <span className="text-slate-600 text-[0.65rem]" title={w.actionType}>
                                  {w.actionType.replace('_', ' ')}
                                </span>
                              )}
                          </div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {popular.length > 0 && expertRows.length === 0 && (
        <p className="text-slate-500 text-sm">No expert rows to show — overlap matrix is empty for this dataset.</p>
      )}
    </div>
  )
}
