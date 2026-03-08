/**
 * Industry Performance — data from TradingView Scanner API (sector, industry, 1M/3M/6M/YTD/1Y).
 * scanner.tradingview.com/america/scan; industries aggregated with average performance. Cache 24h.
 */

import { useEffect, useState } from 'react'
import { API_BASE } from '../utils/api'
import { Link } from 'react-router-dom'
import {
  buildIndustrySparklineAreaPath,
  buildIndustrySparklineMonthlyPoints,
  buildIndustrySparklinePath,
  buildIndustryStackSegments,
  getIndustryChartDomain,
  getIndustryLastMonthSegmentColor,
  getIndustrySparklineRowDomain,
  sparklineXToMonthOffset,
  valueToPct,
} from '../utils/industryChart.js'

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
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

type SortKey = 'sector' | 'name' | 'perf1M' | 'perf3M' | 'perf6M' | 'perfYTD' | 'perf1Y' | 'count'
type ViewMode = 'table' | 'chart'
const SPARKLINE_WIDTH = 150
const SPARKLINE_HEIGHT = 60

function formatSparklineMonth(monthOffset: number, fetchedAt?: string): string {
  const base = fetchedAt ? new Date(fetchedAt) : new Date()
  const d = new Date(base.getFullYear(), base.getMonth(), 1)
  d.setMonth(d.getMonth() + monthOffset)
  return d.toLocaleString(undefined, { month: 'short', year: '2-digit' })
}

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
  const [viewMode, setViewMode] = useState<ViewMode>('table')

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
  const chartDomain = getIndustryChartDomain(industries)

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
        className={`sticky top-0 z-20 bg-slate-900/95 backdrop-blur px-4 py-3 text-slate-500 font-medium text-xs uppercase cursor-pointer select-none hover:text-slate-300 ${alignRight ? 'text-right' : ''}`}
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

  const IndustrySparkline = ({ row }: { row: IndustryRow }) => {
    const points = buildIndustrySparklineMonthlyPoints(row)
    const sparklineDomain = getIndustrySparklineRowDomain(row)
    const path = buildIndustrySparklinePath(points, {
      width: SPARKLINE_WIDTH,
      height: SPARKLINE_HEIGHT,
      maxAbs: sparklineDomain,
      paddingY: 3,
    })
    const areaPath = buildIndustrySparklineAreaPath(points, {
      width: SPARKLINE_WIDTH,
      height: SPARKLINE_HEIGHT,
      maxAbs: sparklineDomain,
      paddingY: 3,
    })
    const endValue = row.perf6M ?? 0
    const lastMonthColorKey = getIndustryLastMonthSegmentColor(row)
    const lineColor = endValue < 0 ? '#f87171' : '#38bdf8'
    const areaColor = endValue < 0 ? 'rgba(248, 113, 113, 0.26)' : 'rgba(56, 189, 248, 0.26)'
    const lastMonthLineColor = lastMonthColorKey === 'red' ? '#f87171' : '#38bdf8'
    const lastMonthAreaColor = lastMonthColorKey === 'red' ? 'rgba(248, 113, 113, 0.26)' : 'rgba(56, 189, 248, 0.26)'
    const centerY = SPARKLINE_HEIGHT / 2
    const toChartY = (value: number) =>
      centerY - (Math.max(-sparklineDomain, Math.min(sparklineDomain, value)) / sparklineDomain) * ((SPARKLINE_HEIGHT - 6) / 2)
    const lastMonthStart = points.find((point) => point.monthOffset === -1) ?? null
    const lastMonthEnd = points.find((point) => point.monthOffset === 0) ?? null
    const lastMonthSegmentPath =
      lastMonthStart && lastMonthEnd
        ? `M ${(lastMonthStart.x * SPARKLINE_WIDTH).toFixed(2)} ${toChartY(lastMonthStart.y).toFixed(2)} L ${(lastMonthEnd.x * SPARKLINE_WIDTH).toFixed(2)} ${toChartY(lastMonthEnd.y).toFixed(2)}`
        : ''
    const lastMonthAreaPath =
      lastMonthStart && lastMonthEnd
        ? `M ${(lastMonthStart.x * SPARKLINE_WIDTH).toFixed(2)} ${toChartY(lastMonthStart.y).toFixed(2)} L ${(lastMonthEnd.x * SPARKLINE_WIDTH).toFixed(2)} ${toChartY(lastMonthEnd.y).toFixed(2)} L ${(lastMonthEnd.x * SPARKLINE_WIDTH).toFixed(2)} ${centerY.toFixed(2)} L ${(lastMonthStart.x * SPARKLINE_WIDTH).toFixed(2)} ${centerY.toFixed(2)} Z`
        : ''
    const [hoverMonthOffset, setHoverMonthOffset] = useState<number | null>(null)
    const hoveredPoint = hoverMonthOffset == null
      ? null
      : points.find((point) => point.monthOffset === hoverMonthOffset) ?? null
    const hoveredX = hoveredPoint ? hoveredPoint.x * SPARKLINE_WIDTH : null
    const hoveredY = hoveredPoint
      ? toChartY(hoveredPoint.y)
      : null
    const endY = toChartY(endValue)
    return (
      <div className="relative inline-flex">
        {hoveredPoint && hoveredX != null && (
          <div
            className="absolute -top-10 -translate-x-1/2 rounded-md border border-slate-700 bg-slate-900/95 px-2 py-1 text-[10px] text-slate-100 shadow-lg whitespace-nowrap pointer-events-none z-20"
            style={{ left: `${hoveredPoint.x * 100}%` }}
          >
            {formatSparklineMonth(hoveredPoint.monthOffset, data?.fetchedAt)}: {hoveredPoint.y >= 0 ? '+' : ''}{hoveredPoint.y.toFixed(2)}%
          </div>
        )}
        <svg
          width={SPARKLINE_WIDTH}
          height={SPARKLINE_HEIGHT}
          viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
          className="overflow-visible"
          role="img"
          aria-label={`${row.name} 6-month performance mountain chart`}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            const xRatio = (event.clientX - rect.left) / rect.width
            setHoverMonthOffset(sparklineXToMonthOffset(xRatio))
          }}
          onMouseLeave={() => setHoverMonthOffset(null)}
        >
          <line
            x1={0}
            x2={SPARKLINE_WIDTH}
            y1={centerY}
            y2={centerY}
            stroke="rgba(148, 163, 184, 0.35)"
            strokeDasharray="2 3"
          />
          {hoveredX != null && (
            <line
              x1={hoveredX}
              x2={hoveredX}
              y1={1}
              y2={SPARKLINE_HEIGHT - 1}
              stroke="rgba(148, 163, 184, 0.45)"
              strokeDasharray="2 2"
            />
          )}
          <path d={areaPath} fill={areaColor} stroke="none" />
          {lastMonthAreaPath && <path d={lastMonthAreaPath} fill={lastMonthAreaColor} stroke="none" />}
          <path d={path} fill="none" stroke={lineColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          {lastMonthSegmentPath && (
            <path d={lastMonthSegmentPath} fill="none" stroke={lastMonthLineColor} strokeWidth="2" strokeLinecap="round" />
          )}
          {hoveredX != null && hoveredY != null && (
            <circle
              cx={hoveredX}
              cy={hoveredY}
              r="2.4"
              fill={hoverMonthOffset != null && hoverMonthOffset >= -1 ? lastMonthLineColor : lineColor}
            />
          )}
          <circle cx={SPARKLINE_WIDTH} cy={endY} r="2.6" fill={lastMonthLineColor} />
        </svg>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-slate-100">Industry Performance</h1>
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-lg border border-slate-700 bg-slate-900/70 p-1">
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`px-3 py-1.5 text-sm rounded-md ${
                viewMode === 'table'
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-300 hover:text-slate-100 hover:bg-slate-800'
              }`}
              aria-current={viewMode === 'table' ? 'page' : undefined}
            >
              Table
            </button>
            <button
              type="button"
              onClick={() => setViewMode('chart')}
              className={`px-3 py-1.5 text-sm rounded-md ${
                viewMode === 'chart'
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-300 hover:text-slate-100 hover:bg-slate-800'
              }`}
              aria-current={viewMode === 'chart' ? 'page' : undefined}
            >
              Chart
            </button>
          </div>
          {data?.fetchedAt && (
            <span className="text-slate-500 text-sm">
              Fetched: {new Date(data.fetchedAt).toLocaleString()} · {data.totalSymbols} symbols (cache 24h)
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
        symbols in each industry. Cached 24h.
      </p>
      {viewMode === 'chart' && (
        <p className="text-slate-400 text-sm">
          Horizontal stacked bars start with <span className="text-emerald-300 font-medium">1M</span>, then stack
          <span className="text-amber-300 font-medium"> 1M→3M</span>, then
          <span className="text-fuchsia-300 font-medium"> 3M→6M</span> to end at total <span className="text-slate-200">6M</span>.
        </p>
      )}

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

      {!loading && industries.length > 0 && viewMode === 'table' && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50">
          <table className="w-full text-left min-w-[960px]">
            <thead>
              <tr className="border-b border-slate-800">
                <SortHeader col="sector" label="Sector" />
                <SortHeader col="name" label="Industry" />
                <th className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur px-4 py-3 text-slate-500 font-medium text-xs uppercase">
                  6M Trend
                </th>
                <th
                className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur px-4 py-3 text-slate-500 font-medium text-xs uppercase text-right cursor-pointer select-none hover:text-slate-300"
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
                className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur px-4 py-3 text-slate-500 font-medium text-xs uppercase text-right cursor-pointer select-none hover:text-slate-300"
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
                <th className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur px-4 py-3 text-slate-500 font-medium text-xs uppercase">Tickers</th>
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
                  <td className="px-4 py-3">
                    <IndustrySparkline row={ind} />
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
      {!loading && industries.length > 0 && viewMode === 'chart' && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <div className="mb-4 flex flex-wrap items-center gap-4 text-xs">
            <span className="text-slate-400">Legend:</span>
            <span className="inline-flex items-center gap-1 text-slate-300">
              <span className="h-2.5 w-6 rounded bg-emerald-500/95" />
              1M segment
            </span>
            <span className="inline-flex items-center gap-1 text-slate-300">
              <span className="h-2.5 w-6 rounded bg-amber-500/95" />
              1M→3M delta
            </span>
            <span className="inline-flex items-center gap-1 text-slate-300">
              <span className="h-2.5 w-6 rounded bg-fuchsia-500/95" />
              3M→6M delta
            </span>
          </div>
          <div className="space-y-2">
            {industries.map((ind) => {
              const segments = buildIndustryStackSegments(ind)
              return (
                <div
                  key={`${ind.sector}-${ind.name}`}
                  className="grid grid-cols-[minmax(140px,220px)_1fr_auto] items-center gap-3"
                >
                  <Link
                    to={`/industry-tickers/${encodeURIComponent(ind.name)}`}
                    className="truncate text-sm text-sky-400 hover:text-sky-300 hover:underline"
                    title={ind.name}
                  >
                    {ind.name}
                  </Link>
                  <div className="relative h-7 rounded-md bg-slate-900/80 border border-slate-800">
                    <div
                      className="absolute top-0 bottom-0 w-px bg-slate-600/80"
                      style={{ left: `${valueToPct(0, chartDomain)}%` }}
                      aria-hidden="true"
                    />
                    {segments.map((segment) => {
                      const start = valueToPct(segment.start, chartDomain)
                      const end = valueToPct(segment.end, chartDomain)
                      const left = Math.min(start, end)
                      const width = Math.abs(end - start)
                      if (width < 0.15) return null
                      const segmentColor =
                        segment.id === 'perf1M'
                          ? segment.end >= segment.start
                            ? 'bg-emerald-500/95'
                            : 'bg-red-500/90'
                          : segment.id === 'perf1MTo3M'
                            ? segment.end >= segment.start
                              ? 'bg-amber-500/95'
                              : 'bg-amber-500/90'
                            : segment.end >= segment.start
                              ? 'bg-fuchsia-500/95'
                            : 'bg-red-500/90'
                      return (
                        <div
                          key={segment.id}
                          className={`absolute top-1 bottom-1 rounded-sm ${segmentColor}`}
                          style={{ left: `${left}%`, width: `${width}%` }}
                          title={
                            segment.id === 'perf1M'
                              ? `1M: ${ind.perf1M?.toFixed(2) ?? '0.00'}%`
                              : segment.id === 'perf1MTo3M'
                                ? `1M→3M delta: ${((ind.perf3M ?? 0) - (ind.perf1M ?? 0)).toFixed(2)}%`
                              : `3M→6M delta: ${((ind.perf6M ?? 0) - (ind.perf3M ?? 0)).toFixed(2)}%`
                          }
                        />
                      )
                    })}
                  </div>
                  <span className="font-mono text-xs text-slate-300 whitespace-nowrap">
                    6M: {ind.perf6M != null ? `${ind.perf6M >= 0 ? '+' : ''}${ind.perf6M.toFixed(2)}%` : '—'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
