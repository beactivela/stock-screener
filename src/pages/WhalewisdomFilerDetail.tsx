/**
 * Single WhaleWisdom filer: positions from last sync (SSR “top holdings” snapshot).
 */
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { API_BASE } from '../utils/api'

interface FilerRow {
  slug: string
  display_name: string | null
  manager_name: string | null
  ww_filer_id: number | null
  whalewisdom_url: string | null
  updated_at?: string | null
}

interface PositionRow {
  ticker: string
  company_name: string | null
  pct_of_portfolio: number | null
  position_value_usd: number | null
  action_type: string
  action_pct: number | null
  quarter_label: string | null
  shares_held: number | null
  security_type: string | null
  raw_snapshot: string | null
}

interface FilerPayload {
  ok: boolean
  filer: FilerRow
  positions: PositionRow[]
  links: { whalewisdom: string }
  note?: string
  error?: string
}

export default function WhalewisdomFilerDetail() {
  const { slug } = useParams<{ slug: string }>()
  const [data, setData] = useState<FilerPayload | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/whalewisdom/filer/${encodeURIComponent(slug)}`)
        const json = (await res.json()) as FilerPayload
        if (cancelled) return
        if (!res.ok || !json.ok) {
          setErr(json.error || res.statusText)
          return
        }
        setData(json)
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [slug])

  const title = data?.filer?.display_name || slug

  return (
    <div className="max-w-6xl">
      <p className="mb-4 text-sm">
        <Link to="/experts" className="text-sky-400 hover:text-sky-300">
          ← Expert overlap
        </Link>
      </p>

      {!data && !err && <p className="text-slate-500">Loading…</p>}
      {err && (
        <p className="text-amber-400" role="alert">
          {err}
        </p>
      )}

      {data?.ok && data.filer && (
        <>
          <header className="mb-6 border-b border-slate-800 pb-6">
            <h1 className="text-2xl font-semibold text-slate-100">{title}</h1>
            {data.filer.manager_name && (
              <p className="mt-1 text-slate-400">{data.filer.manager_name}</p>
            )}
            {data.note && <p className="mt-3 text-sm text-slate-500 max-w-2xl">{data.note}</p>}
            <div className="mt-4 flex flex-wrap gap-3 text-sm">
              <a
                href={data.links.whalewisdom}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded border border-slate-600 px-3 py-1.5 text-sky-400 hover:bg-slate-800/80"
              >
                Open on WhaleWisdom
              </a>
            </div>
          </header>

          <section>
            <h2 className="mb-3 text-lg font-medium text-slate-200">
              Holdings in last sync ({data.positions.length} positions)
            </h2>
            <div className="overflow-x-auto border border-slate-800 rounded-lg">
              <table className="min-w-full text-sm text-left text-slate-300">
                <thead className="bg-slate-800/80 text-slate-400 uppercase text-xs">
                  <tr>
                    <th className="px-3 py-2">Ticker</th>
                    <th className="px-3 py-2">Company</th>
                    <th className="px-3 py-2 text-right">% of portfolio</th>
                    <th className="px-3 py-2">Quarter</th>
                    <th className="px-3 py-2">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {data.positions.map((p) => (
                    <tr key={`${p.ticker}-${p.security_type || 'eq'}`} className="border-t border-slate-800 hover:bg-slate-800/40">
                      <td className="px-3 py-2 font-medium text-sky-400">
                        <Link to={`/stock/${p.ticker}`}>{p.ticker}</Link>
                      </td>
                      <td className="px-3 py-2 text-slate-400 max-w-[14rem] truncate" title={p.company_name || ''}>
                        {p.company_name || '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {p.pct_of_portfolio != null ? `${p.pct_of_portfolio.toFixed(2)}%` : '—'}
                      </td>
                      <td className="px-3 py-2 text-slate-500">{p.quarter_label || '—'}</td>
                      <td className="px-3 py-2 text-slate-500">{p.security_type || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
