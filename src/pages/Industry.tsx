/**
 * Industry Performance — data from TradingView Scanner API (sector, industry, 1M/3M/6M/YTD/1Y).
 * scanner.tradingview.com/america/scan; industries aggregated with average performance. Cache 12h.
 */

import { useEffect, useState } from 'react'
import { API_BASE } from '../utils/api'
import { Link } from 'react-router-dom'

interface IndustryRow {
  name: string
  sector: string
  tickers: string[]
  count: number
  url: string
  perf1M?: number | null
  perf3M?: number | null
  perf6M?: number | null
  perfYTD?: number | null
  perf1Y?: number | null
}

interface IndustryPayload {
  industries: IndustryRow[]
  source: string
  fetchedAt: string
  totalSymbols: number
}

const CACHE_KEY = 'industry-cache'
const CACHE_TTL_MS = 12 * 60 * 60 * 1000 // 12 hours

type SortKey = 'sector' | 'name' | 'perf1M' | 'perf3M' | 'perf6M' | 'perfYTD' | 'perf1Y' | 'count'

/** True when 6M is strong but 3M is less than half of 6M — may indicate topping out or consolidation. */
function isToppingOut(row: IndustryRow): boolean {
  const perf6M = row.perf6M
  const perf3M = row.perf3M
  if (perf6M == null || perf3M == null || perf6M <= 0) return false
  return perf3M < 0.5 * perf6M
}

/** Pullback entry: strong 6M/3M trend with 1M flat or slight dip (-3% to +2%). Good risk/reward zone. */
function isPullbackEntry(row: IndustryRow): boolean {
  const { perf1M, perf3M, perf6M } = row
  if (perf1M == null || perf3M == null || perf6M == null) return false
  if (perf6M < 20 || perf3M < 10) return false // need strong trend
  return perf1M >= -3 && perf1M <= 2
}

const TOOLTIP_1M_PULLBACK =
  'Entry trigger: Strong 6M/3M with 1M pullback (-3% to +2%) suggests mean reversion or handle — often better risk/reward. Breakout: 1M much higher than 3M = acceleration, higher risk of blow-off.'

const TOOLTIP_3M =
  'Warning industry might be topping since lack of growth in 3M.'

/** Inline tooltip that shows on hover (no native title delay). */
function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <span className="relative inline-flex group">
      {children}
      <span
        role="tooltip"
        className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1 px-2 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 border border-slate-600 rounded shadow-lg max-w-[260px] whitespace-normal opacity-0 invisible group-hover:opacity-100 group-hover:visible z-[100] transition-opacity pointer-events-none"
      >
        {text}
      </span>
    </span>
  )
}

function getSortValue(row: IndustryRow, key: SortKey): number | string {
  switch (key) {
    case 'sector':
      return row.sector
    case 'name':
      return row.name
    case 'count':
      return row.count
    case 'perf1M':
    case 'perf3M':
    case 'perf6M':
    case 'perfYTD':
    case 'perf1Y': {
      const v = row[key]
      return v != null ? v : -Infinity
    }
    default:
      return ''
  }
}

function getCached(): IndustryPayload | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const { payload, fetchedAt } = JSON.parse(raw) as { payload: IndustryPayload; fetchedAt: number }
    if (Date.now() - fetchedAt > CACHE_TTL_MS) return null
    return payload
  } catch {
    return null
  }
}

function setCached(payload: IndustryPayload) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ payload, fetchedAt: Date.now() }))
  } catch {
    /* ignore */
  }
}

export default function Industry() {
  const [data, setData] = useState<IndustryPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('perf6M')
  const [sortAsc, setSortAsc] = useState(false) // false = descending (best 6M first)

  const load = async (forceRefresh = false) => {
    if (!forceRefresh) {
      const cached = getCached()
      if (cached) {
        setData(cached)
        setLoading(false)
        return
      }
    }
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(`${API_BASE}/api/industry-tradingview`, { cache: 'no-store' })
      const contentType = r.headers.get('content-type') ?? ''
      if (!contentType.includes('application/json')) {
        const text = await r.text()
        const msg = text.trimStart().startsWith('<!')
          ? 'API not running. Use "npm run dev" (single process), or run "npm run dev:server" then "vite" in two terminals.'
          : r.ok
            ? 'Unexpected response format.'
            : r.statusText || `HTTP ${r.status}`
        throw new Error(msg)
      }
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        throw new Error(err?.error ?? r.statusText)
      }
      const payload = await r.json()
      setData(payload)
      setCached(payload)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const industries = [...(data?.industries ?? [])].sort((a, b) => {
    const va = getSortValue(a, sortKey)
    const vb = getSortValue(b, sortKey)
    const mult = sortAsc ? 1 : -1
    if (typeof va === 'number' && typeof vb === 'number') {
      return mult * (va - vb)
    }
    const sa = String(va)
    const sb = String(vb)
    const cmp = sa.localeCompare(sb)
    if (cmp !== 0) return mult * cmp
    return a.name.localeCompare(b.name)
  })

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc((prev) => !prev)
    } else {
      setSortKey(key)
      setSortAsc(key === 'sector' || key === 'name' || key === 'count')
    }
  }

  const SortHeader = ({ col, label, alignRight = false }: { col: SortKey; label: string; alignRight?: boolean }) => {
    const active = sortKey === col
    return (
      <th
        className={`px-4 py-3 text-slate-500 font-medium text-xs uppercase cursor-pointer select-none hover:text-slate-300 ${alignRight ? 'text-right' : ''}`}
        onClick={() => handleSort(col)}
        role="columnheader"
        {...(active && { 'aria-sort': sortAsc ? 'ascending' : 'descending' })}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {active ? (sortAsc ? ' ↑' : ' ↓') : ' ·'}
        </span>
      </th>
    )
  }

  const fmtPct = (v: number | null | undefined) =>
    v != null ? (
      <span className={`font-mono ${v >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
        {v >= 0 ? '+' : ''}{v.toFixed(2)}%
      </span>
    ) : (
      <span className="text-slate-500">—</span>
    )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-slate-100">Industry Performance</h1>
        <div className="flex flex-wrap items-center gap-3">
          {data?.fetchedAt && (
            <span className="text-slate-500 text-sm">
              Fetched: {new Date(data.fetchedAt).toLocaleString()} · {data.totalSymbols} symbols (cache 12h)
            </span>
          )}
          <button
            type="button"
            onClick={() => load(true)}
            disabled={loading}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-sky-600 text-white hover:bg-sky-500 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Refresh from TradingView'}
          </button>
        </div>
      </div>

      <p className="text-slate-400 text-sm">
        Sectors and industries from TradingView Scanner API (FactSet classification). Performance is average of
        symbols in each industry. Cached 12h.
      </p>

      {error && (
        <div className="rounded-xl border border-red-800/50 bg-red-900/20 p-4 text-red-300 text-sm">
          {error}
        </div>
      )}

      {!loading && !error && industries.length === 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-8 text-center text-slate-500">
          No industries. Click &quot;Refresh from TradingView&quot; to fetch.
        </div>
      )}

      {!loading && industries.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-x-auto">
          <table className="w-full text-left min-w-[800px]">
            <thead>
              <tr className="border-b border-slate-800">
                <SortHeader col="sector" label="Sector" />
                <SortHeader col="name" label="Industry" />
                <th
                className="px-4 py-3 text-slate-500 font-medium text-xs uppercase text-right cursor-pointer select-none hover:text-slate-300"
                onClick={() => handleSort('perf1M')}
                role="columnheader"
                {...(sortKey === 'perf1M' && { 'aria-sort': sortAsc ? 'ascending' : 'descending' })}
              >
                <span className="inline-flex items-center gap-1 justify-end">
                  <span>1M{sortKey === 'perf1M' ? (sortAsc ? ' ↑' : ' ↓') : ' ·'}</span>
                  <Tooltip text={TOOLTIP_1M_PULLBACK}>
                    <span
                      className="text-slate-400 shrink-0 cursor-help"
                      aria-label="1M entry trigger (pullback vs breakout)"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                        <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm8.706-1.442c1.146-.573 2.437.463 2.126 1.706l-.709 2.836.042-.02a.75.75 0 01.67 1.34l-.04.022c-1.147.573-2.438-.463-2.126-1.706l.71-2.836-.042.02a.75.75 0 11-.671-1.34l.041-.022zM12 9a.75.75 0 100-1.5.75.75 0 000 1.5z" clipRule="evenodd" />
                      </svg>
                    </span>
                  </Tooltip>
                </span>
              </th>
                <th
                className="px-4 py-3 text-slate-500 font-medium text-xs uppercase text-right cursor-pointer select-none hover:text-slate-300"
                onClick={() => handleSort('perf3M')}
                role="columnheader"
                {...(sortKey === 'perf3M' && { 'aria-sort': sortAsc ? 'ascending' : 'descending' })}
              >
                <span className="inline-flex items-center gap-1 justify-end">
                  <span>3M{sortKey === 'perf3M' ? (sortAsc ? ' ↑' : ' ↓') : ' ·'}</span>
                  <Tooltip text={TOOLTIP_3M}>
                    <span
                      className="text-amber-400 shrink-0 cursor-help"
                      aria-label="3M vs 6M ratio warning"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                        <path fillRule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z" clipRule="evenodd" />
                      </svg>
                    </span>
                  </Tooltip>
                </span>
              </th>
                <SortHeader col="perf6M" label="6M" alignRight />
                <SortHeader col="perfYTD" label="YTD" alignRight />
                <SortHeader col="perf1Y" label="1Y" alignRight />
                <SortHeader col="count" label="Count" alignRight />
                <th className="px-4 py-3 text-slate-500 font-medium text-xs uppercase">Tickers</th>
              </tr>
            </thead>
            <tbody>
              {industries.map((ind) => (
                <tr
                  key={`${ind.sector}-${ind.name}`}
                  className="border-b border-slate-800/60 hover:bg-slate-800/30"
                >
                  <td className="px-4 py-3 text-slate-400">{ind.sector}</td>
                  <td className="px-4 py-3 font-medium text-slate-200">
                    <Link
                      to={`/industry-tickers/${encodeURIComponent(ind.name)}`}
                      className="text-sky-400 hover:text-sky-300 hover:underline"
                    >
                      {ind.name}
                    </Link>
                  </td>
                  <td
                    className={`px-4 py-3 text-right ${isPullbackEntry(ind) ? 'bg-emerald-500/10 border-l-2 border-emerald-500' : ''}`}
                  >
                    {isPullbackEntry(ind) ? (
                      <Tooltip text={TOOLTIP_1M_PULLBACK}>
                        <span className="inline-block">{fmtPct(ind.perf1M)}</span>
                      </Tooltip>
                    ) : (
                      fmtPct(ind.perf1M)
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="inline-flex items-center gap-1 justify-end">
                      {fmtPct(ind.perf3M)}
                      {isToppingOut(ind) && (
                        <Tooltip text={TOOLTIP_3M}>
                          <span
                            className="text-amber-400 shrink-0 cursor-help"
                            aria-label="Topping out warning"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                              <path fillRule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z" clipRule="evenodd" />
                            </svg>
                          </span>
                        </Tooltip>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">{fmtPct(ind.perf6M)}</td>
                  <td className="px-4 py-3 text-right">{fmtPct(ind.perfYTD)}</td>
                  <td className="px-4 py-3 text-right">{fmtPct(ind.perf1Y)}</td>
                  <td className="px-4 py-3 text-slate-300 font-mono text-right">{ind.count}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {ind.tickers.length > 0 ? (
                        ind.tickers.slice(0, 12).map((ticker) => (
                          <Link
                            key={ticker}
                            to={`/stock/${ticker}`}
                            className="text-xs px-2 py-0.5 bg-slate-800 text-sky-400 hover:bg-slate-700 hover:text-sky-300 rounded"
                          >
                            {ticker}
                          </Link>
                        ))
                      ) : (
                        <span className="text-slate-500 text-xs">—</span>
                      )}
                      {ind.tickers.length > 12 && (
                        <span className="text-slate-500 text-xs">+{ind.tickers.length - 12} more</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
