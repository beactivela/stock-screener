/**
 * "Tickers by industry" page: lists all tickers in a given industry,
 * ranked by 6-month return (descending), with a small 300×200 chart
 * showing price and 10/20/50/150 MA next to each ticker.
 */
import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { API_BASE } from '../utils/api'
import MiniChart from '../components/MiniChart'

interface TickerTrend {
  ticker: string
  lastClose?: number | null
  change3mo?: number | null
  change6mo?: number | null
  change1y?: number | null
  ytd?: number | null
  score?: number | null
}

interface IndustryGroup {
  industry: string
  tickers: TickerTrend[]
  industryAvg3Mo?: number | null
  industryAvg6Mo?: number | null
  industryAvg1Y?: number | null
  industryYtd?: number | null
}

interface IndustryTrendPayload {
  industries: IndustryGroup[]
  scannedAt: string | null
}

export default function IndustryTickers() {
  const { industryName } = useParams<{ industryName: string }>()
  const decodedName = industryName ? decodeURIComponent(industryName) : ''
  const [payload, setPayload] = useState<IndustryTrendPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`${API_BASE}/api/industry-trend`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        setPayload(data)
        if (data?.error) setError(data.error)
      })
      .catch((e) => setError(e?.message ?? 'Failed to load'))
      .finally(() => setLoading(false))
  }, [])

  const industry = payload?.industries?.find(
    (i) => i.industry === decodedName
  )
  const tickersSorted: TickerTrend[] = industry?.tickers
    ? [...industry.tickers].sort((a, b) => {
        const a6 = a.change6mo ?? -Infinity
        const b6 = b.change6mo ?? -Infinity
        return b6 - a6
      })
    : []

  const fmtPct = (v: number | null | undefined) => {
    if (v == null) return '–'
    const n = Number(v)
    return (
      <span className={`font-mono ${n >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
        {n >= 0 ? '+' : ''}{n.toFixed(1)}%
      </span>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        Loading industry data…
      </div>
    )
  }
  if (error) {
    return (
      <div className="rounded-xl border border-red-900/50 bg-slate-900/50 p-6 text-red-400">
        {error}
        <div className="mt-4">
          <Link to="/industry" className="text-sky-400 hover:underline">
            ← Back to Industry
          </Link>
        </div>
      </div>
    )
  }
  if (!industry && decodedName) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Link to="/industry" className="text-sky-400 hover:text-sky-300 hover:underline text-sm">
            ← Industry
          </Link>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-8 text-center text-slate-500">
          <p>No ticker data for industry &quot;{decodedName}&quot;.</p>
          <p className="mt-2 text-sm">Run a scan from the Dashboard so this industry is populated from fundamentals.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link to="/industry" className="text-sky-400 hover:text-sky-300 hover:underline text-sm">
            ← Industry
          </Link>
          <h1 className="text-2xl font-bold text-slate-100">
            Tickers by industry: {decodedName}
          </h1>
        </div>
      </div>

      <p className="text-slate-400 text-sm">
        Ranked by 6-month return (descending). Chart: price + 10/20/50/150 MA (orange/blue/purple/pink) + volume.
      </p>

      {tickersSorted.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-8 text-center text-slate-500">
          No tickers in this industry.
        </div>
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
          <table className="w-full text-left min-w-[1200px]">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="px-4 py-3 text-slate-500 font-medium text-xs uppercase w-14">#</th>
                <th className="px-4 py-3 text-slate-500 font-medium text-xs uppercase">Ticker</th>
                <th className="px-4 py-3 text-slate-500 font-medium text-xs uppercase text-right">6M Return</th>
                <th className="px-4 py-3 text-slate-500 font-medium text-xs uppercase pl-4" style={{ width: 1000 }}>
                  Chart
                </th>
              </tr>
            </thead>
            <tbody>
              {tickersSorted.map((t, idx) => (
                <tr
                  key={t.ticker}
                  className="border-b border-slate-800/60 hover:bg-slate-800/30"
                >
                  <td className="px-4 py-3 text-slate-400 font-medium font-mono">{idx + 1}</td>
                  <td className="px-4 py-3 font-medium">
                    <Link
                      to={`/stock/${t.ticker}`}
                      className="text-sky-400 hover:text-sky-300 hover:underline"
                    >
                      {t.ticker}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right">{fmtPct(t.change6mo)}</td>
                  <td className="px-4 py-2 pl-4">
                    <MiniChart ticker={t.ticker} />
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
