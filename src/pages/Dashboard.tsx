import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

interface ScanResult {
  ticker: string
  vcpBullish: boolean
  contractions: number
  atMa10: boolean
  atMa20: boolean
  atMa50: boolean
  lastClose?: number
  sma10?: number
  sma20?: number
  sma50?: number
  pullbackPcts?: string[]
  score?: number
  recommendation?: 'buy' | 'hold' | 'avoid'
  error?: string
  pctHeldByInst?: number | null
  qtrEarningsYoY?: number | null
  profitMargin?: number | null
  operatingMargin?: number | null
}

interface ScanPayload {
  scannedAt: string | null
  results: ScanResult[]
  totalTickers: number
  vcpBullishCount: number
  from?: string
  to?: string
}

interface ScoreCriterion {
  criterion: string
  matched: boolean
  points: number
  detail?: string
}

/** Derive score breakdown when API doesn't return it */
function getScoreBreakdown(r: EvaluateResult): ScoreCriterion[] {
  if (!r || r.error) return []
  if (r.reason === 'not_enough_bars') return [{ criterion: 'Not enough bars (need 60+)', matched: false, points: 0 }]
  if (r.reason === 'below_50_ma') return [{ criterion: 'Price above 50 SMA (Stage 2)', matched: false, points: 0 }]
  const b: ScoreCriterion[] = []
  b.push({ criterion: 'VCP Bullish (contractions + at MA)', matched: r.vcpBullish, points: r.vcpBullish ? 50 : 0 })
  if (!r.vcpBullish) b.push({ criterion: 'Partial setup (above 50 MA, no full VCP)', matched: true, points: 20 })
  const c = r.contractions || 0
  b.push({ criterion: 'Contractions', matched: c > 0, points: Math.min(c * 8, 25), detail: `${c} contractions` })
  b.push({ criterion: 'Price at 10 MA', matched: r.atMa10, points: r.atMa10 ? 5 : 0 })
  b.push({ criterion: 'Price at 20 MA', matched: r.atMa20, points: r.atMa20 ? 5 : 0 })
  b.push({ criterion: 'Price at 50 MA', matched: r.atMa50, points: r.atMa50 ? 5 : 0 })
  const above50 = r.lastClose != null && r.sma50 != null && r.lastClose >= r.sma50
  b.push({ criterion: 'Price above 50 SMA', matched: above50, points: above50 ? 10 : 0 })
  const volDry = !!(r as { volumeDryUp?: boolean }).volumeDryUp
  b.push({ criterion: 'Volume drying up', matched: volDry, points: volDry ? 10 : 0 })
  return b
}

/** Result from evaluating a single ticker via /api/vcp/:ticker */
interface EvaluateResult {
  ticker: string
  vcpBullish: boolean
  reason?: string
  contractions: number
  atMa10: boolean
  atMa20: boolean
  atMa50: boolean
  lastClose?: number
  sma10?: number
  sma20?: number
  sma50?: number
  score?: number
  recommendation?: 'buy' | 'hold' | 'avoid'
  scoreBreakdown?: ScoreCriterion[]
  error?: string
}

export default function Dashboard() {
  const [data, setData] = useState<ScanPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState<{ index: number; total: number } | null>(null)
  const [filter, setFilter] = useState<'all' | '10' | '20' | '50' | 'all3'>('all')
  const [tickerInput, setTickerInput] = useState('')
  const [evaluateResult, setEvaluateResult] = useState<EvaluateResult | null>(null)
  const [evaluateLoading, setEvaluateLoading] = useState(false)
  const [fundamentals, setFundamentals] = useState<
    Record<string, { pctHeldByInst?: number | null; qtrEarningsYoY?: number | null; profitMargin?: number | null; operatingMargin?: number | null }>
  >({})
  const [fetchingFundamentals, setFetchingFundamentals] = useState(false)
  const [fundamentalsProgress, setFundamentalsProgress] = useState<{ index: number; total: number } | null>(null)
  const [sortColumn, setSortColumn] = useState<string>('score')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  useEffect(() => {
    fetch('/api/scan-results')
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetch('/api/fundamentals')
      .then((r) => r.json())
      .then(setFundamentals)
      .catch(() => {})
  }, [])

  const runScan = async () => {
    setScanning(true)
    setScanProgress(null)
    setData((prev) => ({ ...prev, results: [], scannedAt: null, totalTickers: 0, vcpBullishCount: 0 } as ScanPayload))
    try {
      const res = await fetch('/api/scan', { method: 'POST' })
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}))
        if (body?.error) alert(body.error)
        else alert(res.statusText || 'Scan failed')
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      const results: ScanResult[] = []
      let total = 0
      let vcpBullishCount = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const idx = line.indexOf('data: ')
          if (idx === -1) continue
          try {
            const msg = JSON.parse(line.slice(idx + 6).trim()) as {
              result?: ScanResult
              index?: number
              total?: number
              vcpBullishCount?: number
              done?: boolean
              error?: string
            }
            if (msg.error) {
              alert(msg.error)
              return
            }
            if (msg.done) {
              total = msg.total ?? results.length
              vcpBullishCount = msg.vcpBullishCount ?? 0
              break
            }
            if (msg.result) {
              results.push(msg.result)
              vcpBullishCount = msg.vcpBullishCount ?? 0
              total = msg.total ?? 0
              setScanProgress(msg.index != null && total ? { index: msg.index, total } : null)
              setData({
                scannedAt: new Date().toISOString(),
                results: [...results].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
                totalTickers: total,
                vcpBullishCount,
              })
            }
          } catch {
            // skip malformed
          }
        }
      }
      // Final fetch in case we missed any
      const final = await fetch('/api/scan-results').then((r) => r.json())
      setData(final)
    } finally {
      setScanning(false)
      setScanProgress(null)
    }
  }

  const fetchFundamentals = async () => {
    const tickers = (data?.results ?? []).map((r) => r.ticker).filter(Boolean)
    if (tickers.length === 0) {
      alert('Run a scan first to get tickers.')
      return
    }
    setFetchingFundamentals(true)
    setFundamentalsProgress(null)
    try {
      const res = await fetch('/api/fundamentals/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers }),
      })
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}))
        alert(body?.error || res.statusText || 'Fetch failed')
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      const merged: Record<
        string,
        { pctHeldByInst?: number | null; qtrEarningsYoY?: number | null; profitMargin?: number | null; operatingMargin?: number | null }
      > = {}

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const idx = line.indexOf('data: ')
          if (idx === -1) continue
          try {
            const msg = JSON.parse(line.slice(idx + 6).trim()) as {
              ticker?: string
              pctHeldByInst?: number | null
              qtrEarningsYoY?: number | null
              profitMargin?: number | null
              operatingMargin?: number | null
              index?: number
              total?: number
              done?: boolean
              error?: string
            }
            if (msg.done) break
            if (msg.ticker) {
              merged[msg.ticker] = {
                pctHeldByInst: msg.pctHeldByInst ?? null,
                qtrEarningsYoY: msg.qtrEarningsYoY ?? null,
                profitMargin: msg.profitMargin ?? null,
                operatingMargin: msg.operatingMargin ?? null,
              }
              setFundamentalsProgress(msg.index != null && msg.total ? { index: msg.index, total: msg.total } : null)
              setFundamentals((prev) => ({ ...prev, ...merged }))
            }
          } catch {
            /* skip */
          }
        }
      }
      const final = await fetch('/api/fundamentals').then((r) => r.json())
      setFundamentals(final)
    } finally {
      setFetchingFundamentals(false)
      setFundamentalsProgress(null)
    }
  }

  const evaluateTicker = () => {
    const sym = tickerInput.trim().toUpperCase()
    if (!sym) return
    setEvaluateLoading(true)
    setEvaluateResult(null)
    fetch(`/api/vcp/${encodeURIComponent(sym)}`)
      .then(async (r) => {
        const text = await r.text()
        let body: unknown = null
        if (text.trim()) {
          try {
            body = JSON.parse(text)
          } catch {
            // non-JSON (e.g. proxy error page or empty)
          }
        }
        if (!r.ok) {
          const msg = (body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string')
            ? (body as { error: string }).error
            : text.trim() || r.statusText
          return Promise.reject(new Error(msg))
        }
        if (body == null || typeof body !== 'object') {
          return Promise.reject(new Error('API returned empty or invalid response. Is the API server running? Run: npm run server'))
        }
        return body as Record<string, unknown>
      })
      .then((body) => setEvaluateResult({ ...body, ticker: sym } as EvaluateResult))
      .catch((err) => setEvaluateResult({ ticker: sym, vcpBullish: false, contractions: 0, atMa10: false, atMa20: false, atMa50: false, error: err instanceof Error ? err.message : String(err) }))
      .finally(() => setEvaluateLoading(false))
  }

  const results = data?.results ?? []
  const filtered =
    filter === 'all'
      ? results
      : filter === 'all3'
        ? results.filter((r) => r.atMa10 && r.atMa20 && r.atMa50)
        : filter === '10'
          ? results.filter((r) => r.atMa10)
          : filter === '20'
            ? results.filter((r) => r.atMa20)
            : results.filter((r) => r.atMa50)

  const getSortValue = (r: ScanResult, col: string): number | string => {
    switch (col) {
      case 'ticker':
        return r.ticker
      case 'score':
        return r.score ?? -1
      case 'close':
        return r.lastClose ?? -Infinity
      case 'contractions':
        return r.contractions ?? -1
      case 'ma10':
        return r.atMa10 ? 1 : 0
      case 'ma20':
        return r.atMa20 ? 1 : 0
      case 'ma50':
        return r.atMa50 ? 1 : 0
      case 'pctHeldByInst':
        return fundamentals[r.ticker]?.pctHeldByInst ?? -Infinity
      case 'qtrEarningsYoY':
        return fundamentals[r.ticker]?.qtrEarningsYoY ?? -Infinity
      case 'profitMargin':
        return fundamentals[r.ticker]?.profitMargin ?? -Infinity
      case 'operatingMargin':
        return fundamentals[r.ticker]?.operatingMargin ?? -Infinity
      default:
        return ''
    }
  }

  const sorted = [...filtered].sort((a, b) => {
    const va = getSortValue(a, sortColumn)
    const vb = getSortValue(b, sortColumn)
    const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
    return sortDir === 'asc' ? cmp : -cmp
  })

  const handleSort = (col: string) => {
    if (sortColumn === col) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortColumn(col)
      setSortDir(col === 'ticker' ? 'asc' : 'desc')
    }
  }

  const SortHeader = ({ col, label }: { col: string; label: string }) => (
    <th
      className="px-4 py-3 text-slate-300 font-medium cursor-pointer hover:text-slate-100 select-none"
      onClick={() => handleSort(col)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortColumn === col && <span className="text-sky-400">{sortDir === 'asc' ? '↑' : '↓'}</span>}
      </span>
    </th>
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-slate-400">Loading scan results…</div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">VCP Bullish Setups</h1>
          <p className="text-slate-400 mt-1">
            S&P 500 tickers from flat file, scored by VCP setup. Sorted by score descending. Run populate-tickers 500 for full list.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={fetchFundamentals}
            disabled={fetchingFundamentals || !(data?.results?.length)}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium"
          >
            {fetchingFundamentals
              ? fundamentalsProgress
                ? `Fetching ${fundamentalsProgress.index}/${fundamentalsProgress.total}…`
                : 'Fetching…'
              : 'Fetch fundamentals'}
          </button>
          <button
            onClick={runScan}
            disabled={scanning}
            className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-medium"
          >
            {scanning
              ? scanProgress
                ? `Scanning ${scanProgress.index}/${scanProgress.total}…`
                : 'Scanning…'
              : 'Run scan now'}
          </button>
        </div>
      </div>

      {/* Add ticker: evaluate and show buy score */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <h2 className="text-lg font-medium text-slate-200 mb-3">Evaluate a ticker</h2>
        <p className="text-slate-400 text-sm mb-3">
          Enter a symbol to get a 0–100 buy score and recommendation (buy / hold / avoid) based on VCP setup.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="e.g. AAPL"
            value={tickerInput}
            onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && evaluateTicker()}
            className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 placeholder-slate-500 w-32 focus:outline-none focus:ring-2 focus:ring-sky-500"
            aria-label="Ticker symbol"
          />
          <button
            type="button"
            onClick={evaluateTicker}
            disabled={evaluateLoading || !tickerInput.trim()}
            className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-medium"
          >
            {evaluateLoading ? 'Evaluating…' : 'Evaluate'}
          </button>
        </div>
        {evaluateResult && (
          <div className="mt-4 p-4 rounded-lg bg-slate-800/80 border border-slate-700">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-semibold text-slate-100">{evaluateResult.ticker}</span>
              {evaluateResult.error ? (
                <span className="text-amber-400 text-sm">{evaluateResult.error}</span>
              ) : (
                <>
                  <span className="text-slate-400">Score:</span>
                  <span className="text-xl font-bold text-slate-100">{evaluateResult.score ?? 0}/100</span>
                  <span
                    className={`px-2 py-1 rounded text-sm font-medium ${
                      evaluateResult.recommendation === 'buy'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : evaluateResult.recommendation === 'hold'
                          ? 'bg-amber-500/20 text-amber-400'
                          : 'bg-slate-600 text-slate-400'
                    }`}
                  >
                    {evaluateResult.recommendation === 'buy' ? 'Buy' : evaluateResult.recommendation === 'hold' ? 'Hold' : 'Avoid'}
                  </span>
                  <Link
                    to={`/stock/${evaluateResult.ticker}`}
                    className="text-sky-400 hover:text-sky-300 text-sm"
                  >
                    View chart →
                  </Link>
                </>
              )}
            </div>
            {!evaluateResult.error && evaluateResult.lastClose != null && (
              <div className="mt-2 text-slate-500 text-sm">
                Last close: {evaluateResult.lastClose.toFixed(2)}
                {evaluateResult.contractions > 0 && ` · ${evaluateResult.contractions} contraction(s)`}
              </div>
            )}
            {!evaluateResult.error && (() => {
              const breakdown = evaluateResult.scoreBreakdown?.length ? evaluateResult.scoreBreakdown : getScoreBreakdown(evaluateResult)
              return breakdown.length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-700">
                <div className="text-slate-400 text-sm font-medium mb-2">Why this score?</div>
                <ul className="space-y-1 text-sm">
                  {breakdown.map((c, i) => (
                    <li key={i} className={c.matched ? 'text-slate-300' : ''}>
                      {c.matched ? '✓' : '–'} {c.criterion}
                      {c.detail && <span className="text-slate-500"> ({c.detail})</span>}
                      {c.points > 0 && <span className="text-sky-400 ml-1">+{c.points}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )
            })()}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-slate-400">
            Last scan:{' '}
            {data?.scannedAt
              ? new Date(data.scannedAt).toLocaleString()
              : 'Never (run scan or run `npm run scan`)'}
          </span>
          {data?.totalTickers != null && (
            <span className="text-slate-400">
              Tickers scanned: {data.totalTickers} · VCP bullish: {data.vcpBullishCount}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <span className="text-slate-400 text-sm mr-2">Filter by MA:</span>
        {(['all', '10', '20', '50', 'all3'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              filter === f
                ? 'bg-sky-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {f === 'all' ? 'All' : f === 'all3' ? '10+20+50' : `${f} MA`}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/80">
                <SortHeader col="ticker" label="Ticker" />
                <SortHeader col="score" label="Score" />
                <SortHeader col="close" label="Close" />
                <SortHeader col="contractions" label="Contractions" />
                <SortHeader col="ma10" label="10 MA" />
                <SortHeader col="ma20" label="20 MA" />
                <SortHeader col="ma50" label="50 MA" />
                <SortHeader col="pctHeldByInst" label="% Held by Inst" />
                <SortHeader col="qtrEarningsYoY" label="Qtr Earnings YoY" />
                <SortHeader col="profitMargin" label="Profit Margin" />
                <SortHeader col="operatingMargin" label="Operating Margin" />
                <th className="px-4 py-3 text-slate-300 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-slate-500">
                    No results. Run <code className="bg-slate-800 px-1 rounded">npm run populate-tickers 500</code> then click Run scan.
                  </td>
                </tr>
              ) : (
                sorted.map((r) => (
                  <tr key={r.ticker} className="border-b border-slate-800/80 hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <Link to={`/stock/${r.ticker}`} state={{ scanResult: r }} className="text-sky-400 hover:text-sky-300 font-medium">
                        {r.ticker}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-medium tabular-nums">
                      <span className={r.recommendation === 'buy' ? 'text-emerald-400' : r.recommendation === 'hold' ? 'text-amber-400' : 'text-slate-300'}>
                        {r.error ? '–' : typeof r.score === 'number' ? `${r.score}/100` : '–'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{r.lastClose != null ? r.lastClose.toFixed(2) : '–'}</td>
                    <td className="px-4 py-3 text-slate-300">{r.contractions ?? '–'}</td>
                    <td className="px-4 py-3">{r.atMa10 ? '✓' : '–'}</td>
                    <td className="px-4 py-3">{r.atMa20 ? '✓' : '–'}</td>
                    <td className="px-4 py-3">{r.atMa50 ? '✓' : '–'}</td>
                    <td className="px-4 py-3 text-slate-300 tabular-nums">
                      {fundamentals[r.ticker]?.pctHeldByInst != null ? `${fundamentals[r.ticker].pctHeldByInst}%` : '–'}
                    </td>
                    <td className="px-4 py-3 text-slate-300 tabular-nums">
                      {fundamentals[r.ticker]?.qtrEarningsYoY != null ? `${fundamentals[r.ticker].qtrEarningsYoY}%` : '–'}
                    </td>
                    <td className="px-4 py-3 text-slate-300 tabular-nums">
                      {fundamentals[r.ticker]?.profitMargin != null ? `${fundamentals[r.ticker].profitMargin}%` : '–'}
                    </td>
                    <td className="px-4 py-3 text-slate-300 tabular-nums">
                      {fundamentals[r.ticker]?.operatingMargin != null ? `${fundamentals[r.ticker].operatingMargin}%` : '–'}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/stock/${r.ticker}`}
                        state={{ scanResult: r }}
                        className="text-sky-400 hover:text-sky-300 text-sm"
                      >
                        Chart →
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
