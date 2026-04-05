/**
 * Single expert: full synced portfolio, firm info, links to StockCircle performance + about text from meta.
 */
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { API_BASE } from '../utils/api'

interface Investor {
  slug: string
  display_name: string | null
  firm_name: string | null
  performance_1y_pct: number | null
  performance_3y_pct?: number | null
  performance_5y_pct?: number | null
  performance_10y_pct?: number | null
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
  shares_raw: string | null
  raw_last_transaction: string | null
}

interface InvestorPayload {
  ok: boolean
  investor: Investor
  positions: PositionRow[]
  links: { portfolio: string; performance: string; bestInvestors: string }
  aboutBlurb: string | null
  performanceBlurb: string | null
  error?: string
}

function formatUsd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`
  return `$${n.toFixed(0)}`
}

function formatShares(n: number | null | undefined, raw: string | null | undefined): string {
  if (raw) return raw
  if (n == null) return '—'
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return String(n)
}

export default function StockcircleExpertDetail() {
  const { slug } = useParams<{ slug: string }>()
  const [data, setData] = useState<InvestorPayload | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/stockcircle/investor/${encodeURIComponent(slug)}`)
        const json = (await res.json()) as InvestorPayload
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

  const title = data?.investor?.firm_name || data?.investor?.display_name || slug

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

      {data?.ok && data.investor && (
        <>
          <header className="mb-6 border-b border-slate-800 pb-6">
            <h1 className="text-2xl font-semibold text-slate-100">{title}</h1>
            {data.investor.display_name && data.investor.firm_name !== data.investor.display_name && (
              <p className="mt-1 text-slate-400">{data.investor.display_name}</p>
            )}
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm">
              {(
                [
                  ['1Y', data.investor.performance_1y_pct],
                  ['3Y', data.investor.performance_3y_pct ?? null],
                  ['5Y', data.investor.performance_5y_pct ?? null],
                  ['10Y', data.investor.performance_10y_pct ?? null],
                ] as const
              ).map(([label, pct]) => (
                <div
                  key={label}
                  className="rounded-lg border border-slate-800/90 bg-slate-900/40 px-3 py-2"
                >
                  <div className="text-xs text-slate-500">{label} (StockCircle)</div>
                  <div className="mt-0.5 font-medium tabular-nums text-slate-100">
                    {pct != null && Number.isFinite(Number(pct)) ? `${Number(pct).toFixed(2)}%` : '—'}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-3 text-sm">
              <a
                href={data.links.portfolio}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded border border-slate-600 px-3 py-1.5 text-sky-400 hover:bg-slate-800/80"
              >
                Open portfolio on StockCircle
              </a>
              <a
                href={data.links.performance}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded border border-slate-600 px-3 py-1.5 text-sky-400 hover:bg-slate-800/80"
              >
                Performance &amp; track record (StockCircle)
              </a>
              <a
                href={data.links.bestInvestors}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded border border-slate-600 px-3 py-1.5 text-slate-400 hover:bg-slate-800/80"
              >
                Best investors list
              </a>
            </div>
          </header>

          <div className="mb-8 grid gap-6 md:grid-cols-2">
            <section>
              <h2 className="mb-2 text-lg font-medium text-slate-200">About (StockCircle)</h2>
              <p className="text-sm leading-relaxed text-slate-400">
                {data.aboutBlurb ||
                  'No description returned — open the portfolio link above for the live StockCircle page.'}
              </p>
            </section>
            <section>
              <h2 className="mb-2 text-lg font-medium text-slate-200">Performance page summary</h2>
              <p className="text-sm leading-relaxed text-slate-400">
                {data.performanceBlurb ||
                  'No meta description for the performance tab — use “Performance & track record” to view charts on StockCircle.'}
              </p>
            </section>
          </div>

          <section>
            <h2 className="mb-3 text-lg font-medium text-slate-200">
              Full portfolio in last sync ({data.positions.length} positions)
            </h2>
            <div className="overflow-x-auto border border-slate-800 rounded-lg">
              <table className="min-w-full text-sm text-left text-slate-300">
                <thead className="bg-slate-800/80 text-slate-400 uppercase text-xs">
                  <tr>
                    <th className="px-3 py-2">Ticker</th>
                    <th className="px-3 py-2">Company</th>
                    <th className="px-3 py-2 text-right">% of portfolio</th>
                    <th className="px-3 py-2 text-right">Value</th>
                    <th className="px-3 py-2 text-right">Shares</th>
                    <th className="px-3 py-2">Last action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.positions.map((p) => (
                    <tr key={p.ticker} className="border-t border-slate-800 hover:bg-slate-800/40">
                      <td className="px-3 py-2 font-medium text-sky-400">
                        <Link to={`/stock/${p.ticker}`}>{p.ticker}</Link>
                      </td>
                      <td className="px-3 py-2 text-slate-400 max-w-[14rem] truncate" title={p.company_name || ''}>
                        {p.company_name || '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {p.pct_of_portfolio != null ? `${p.pct_of_portfolio.toFixed(1)}%` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatUsd(p.position_value_usd)}</td>
                      <td className="px-3 py-2 text-right text-slate-500">
                        {formatShares(p.shares_held, p.shares_raw)}
                      </td>
                      <td className="px-3 py-2 text-slate-500 max-w-xs truncate" title={p.raw_last_transaction || ''}>
                        {p.raw_last_transaction || p.action_type}
                      </td>
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
