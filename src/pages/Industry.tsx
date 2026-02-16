import { useEffect, useRef, useState } from 'react'
import { API_BASE } from '../utils/api'
import { Link } from 'react-router-dom'

/** All industries across all sectors (name, sector, ytdReturn, url, optional 6M/1Y, tickers, industryRank) */
interface AllIndustry {
  name: string
  sector: string
  ytdReturn: number
  url: string
  return6Mo?: number | null
  return1Y?: number | null
  tickers?: string[]
  industryRank?: number | null
}

interface AllIndustriesPayload {
  industries: AllIndustry[]
  fetchedAt: string | null
  source: string | null
}

export default function Industry() {
  const [allIndustriesData, setAllIndustriesData] = useState<AllIndustriesPayload | null>(null)
  const [fetching, setFetching] = useState(false)
  const [fetchProgress, setFetchProgress] = useState<string | null>(null)
  const [fetchSummary, setFetchSummary] = useState<string | null>(null)
  const autoRefreshedAllIndustries = useRef(false)

  const loadAllIndustries = () => {
    fetch(`${API_BASE}/api/all-industries`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setAllIndustriesData(d))
      .catch(() => setAllIndustriesData({ industries: [], fetchedAt: null, source: null }))
  }

  useEffect(() => {
    loadAllIndustries()
  }, [])

  useEffect(() => {
    if (autoRefreshedAllIndustries.current) return
    if (!allIndustriesData || fetching) return

    const hasAnyNullReturns = (allIndustriesData.industries ?? []).some(
      (i) => i.return6Mo == null || i.return1Y == null
    )
    const fetchedAtMs = allIndustriesData.fetchedAt ? new Date(allIndustriesData.fetchedAt).getTime() : 0
    const ageMs = fetchedAtMs > 0 ? Date.now() - fetchedAtMs : Number.POSITIVE_INFINITY
    const staleMs = 12 * 60 * 60 * 1000 // 12h
    const shouldRefresh =
      (allIndustriesData.industries?.length ?? 0) < 145 || hasAnyNullReturns || ageMs > staleMs

    if (shouldRefresh) {
      autoRefreshedAllIndustries.current = true
      runFetchAllIndustries()
    }
  }, [allIndustriesData, fetching])

  const runFetchAllIndustries = async () => {
    setFetching(true)
    setFetchProgress('Fetching all sectors from Yahoo Finance…')
    setFetchSummary(null)
    try {
      const res = await fetch(`${API_BASE}/api/all-industries/fetch`, { method: 'POST' })
      if (!res.ok) {
        const ct = res.headers.get('content-type') ?? ''
        let errMsg = res.statusText
        if (ct.includes('application/json')) {
          const body = await res.json().catch(() => ({}))
          errMsg = body?.error ?? errMsg
        } else if (ct.includes('text/html')) {
          errMsg = `Server error ${res.status}. Restart the server (npm run server) and try again.`
        }
        throw new Error(errMsg)
      }
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let payload: AllIndustriesPayload | null = null
      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n\n')
          buf = lines.pop() ?? ''
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const msg = JSON.parse(line.slice(6).trim())
                if (msg.done) {
                  if (msg.payload) {
                    payload = msg.payload
                    setAllIndustriesData(payload)
                    setFetchSummary(`Fetched ${msg.payload.industries?.length ?? 0} industries from 11 sectors`)
                  }
                  if (msg.error) throw new Error(msg.error)
                  break
                }
                if (msg.phase === 'fetching') setFetchProgress(msg.message ?? 'Fetching…')
                else if (msg.phase === 'returns')
                  setFetchProgress(`6M/1Y: ${msg.index ?? '?'}/${msg.total ?? '?'}`)
              } catch {
                /* ignore parse errors */
              }
            }
          }
        }
      }
      if (!payload && !buf.includes('"done"')) {
        setFetchSummary('No data received. Restart the server (npm run server) and try again.')
      }
    } catch (e) {
      setFetchSummary(e instanceof Error ? e.message : 'Fetch failed')
    } finally {
      setFetching(false)
      setFetchProgress(null)
    }
  }

  // Sort industries by industryRank (ascending), then by name
  const allList = (allIndustriesData?.industries ?? []).sort((a, b) => {
    // Sort by industryRank first (ascending - lower is better)
    if (a.industryRank != null && b.industryRank != null) {
      if (a.industryRank !== b.industryRank) {
        return a.industryRank - b.industryRank
      }
    }
    // If one has rank and other doesn't, prioritize the one with rank
    if (a.industryRank != null && b.industryRank == null) return -1
    if (a.industryRank == null && b.industryRank != null) return 1
    
    // If ranks are equal or both null, sort by name
    return a.name.localeCompare(b.name)
  })

  const fmt = (v: number | null) =>
    v != null ? (
      <span className={v >= 0 ? 'text-emerald-400' : 'text-red-400'}>
        {v >= 0 ? '+' : ''}{v.toFixed(1)}%
      </span>
    ) : (
      <span className="text-slate-500">–</span>
    )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-slate-100">Industry Performance</h1>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={runFetchAllIndustries}
            disabled={fetching}
            title="Fetches industries from all 11 Yahoo Finance sectors."
            className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {fetching ? (fetchProgress || 'Fetching…') : 'Fetch All Industries'}
          </button>
          {fetchSummary && !fetching && (
            <span className="text-emerald-400 text-sm font-medium">{fetchSummary}</span>
          )}
          {allIndustriesData?.fetchedAt && (
            <span className="text-slate-500 text-sm">
              Last fetch: {new Date(allIndustriesData.fetchedAt).toLocaleString()}
              {allIndustriesData.source && ` (${allIndustriesData.source})`}
            </span>
          )}
        </div>

        {allList.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-8 text-center text-slate-500">
            <p>No industries yet. Press "Fetch All Industries" to load industries from all 11 Yahoo Finance sectors.</p>
            <p className="mt-2 text-sm">
              Technology, Industrials, Healthcare, Financial Services, and more.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-x-auto">
            <table className="w-full text-left min-w-[600px]">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="px-4 py-3 text-slate-500 font-medium text-xs uppercase">Ind.Rank</th>
                  <th className="px-4 py-3 text-slate-500 font-medium text-xs uppercase">Industry</th>
                  <th className="px-4 py-3 text-slate-500 font-medium text-xs uppercase">Sector</th>
                  <th className="px-4 py-3 text-slate-500 font-medium text-xs uppercase">YTD</th>
                  <th className="px-4 py-3 text-slate-500 font-medium text-xs uppercase">6M</th>
                  <th className="px-4 py-3 text-slate-500 font-medium text-xs uppercase">1Y</th>
                  <th className="px-4 py-3 text-slate-500 font-medium text-xs uppercase">Tickers</th>
                </tr>
              </thead>
              <tbody>
                {allList.map((ind) => (
                  <tr key={`${ind.sector}-${ind.name}`} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                    <td className="px-4 py-3 text-slate-300 font-medium">
                      {ind.industryRank != null ? ind.industryRank : <span className="text-slate-500">—</span>}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-200">
                      <a
                        href={ind.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sky-400 hover:text-sky-300 hover:underline"
                      >
                        {ind.name}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-slate-400">{ind.sector}</td>
                    <td className="px-4 py-3">{fmt(ind.ytdReturn)}</td>
                    <td className="px-4 py-3">{fmt(ind.return6Mo ?? null)}</td>
                    <td className="px-4 py-3">{fmt(ind.return1Y ?? null)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {ind.tickers && ind.tickers.length > 0 ? (
                          ind.tickers.map((ticker) => (
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
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
