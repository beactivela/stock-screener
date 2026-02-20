import { useEffect, useState, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import TickerChart from '../components/TickerChart'
import SortHeader from '../components/SortHeader'
import { useScan } from '../contexts/ScanContext'
import { buildIndustryMaps } from '../utils/industryMaps'
import { API_BASE } from '../utils/api'

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
  // NEW: Enhanced scoring fields
  enhancedScore?: number
  baseScore?: number
  industryRank?: number | null
  industryName?: string | null
  industryMultiplier?: number
  relativeStrength?: number | null
  rsData?: {
    rs: number
    stockChange: number
    spyChange: number
    outperforming: boolean
  } | null
  // NEW: Pattern detection fields
  pattern?: string
  patternConfidence?: number
  patternDetails?: string
}

// Opus4.5 Signal from API (entryDate/daysSinceBuy/pctChange used for Open Trade column)
interface Opus45Signal {
  ticker: string
  signal: boolean
  signalType: 'STRONG' | 'MODERATE' | 'WEAK' | null
  opus45Confidence: number
  opus45Grade: string
  entryPrice: number
  stopLossPrice: number
  stopLossPercent: number
  targetPrice: number
  riskRewardRatio: number
  entryDate?: string | number
  daysSinceBuy?: number
  pctChange?: number
  metrics?: {
    relativeStrength?: number
    contractions?: number
    pattern?: string
    industryRank?: number
    entryPoint?: { atWhichMA?: string }
  }
  /** Scan enhanced score (VCP + industry); same as table. */
  enhancedScore?: number
  /** @deprecated use enhancedScore */
  originalScore?: number
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
  enhancedScore?: number
  recommendation?: 'buy' | 'hold' | 'avoid'
  scoreBreakdown?: ScoreCriterion[]
  error?: string
}

export default function Dashboard() {
  const { scanState, startScan: triggerScan } = useScan();
  const [data, setData] = useState<ScanPayload | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | '10' | '20' | '50' | 'all3'>('all')
  const [tickerInput, setTickerInput] = useState('')
  const [evaluateResult, setEvaluateResult] = useState<EvaluateResult | null>(null)
  const [evaluateLoading, setEvaluateLoading] = useState(false)
  const [fundamentals, setFundamentals] = useState<
    Record<string, { pctHeldByInst?: number | null; qtrEarningsYoY?: number | null; profitMargin?: number | null; operatingMargin?: number | null; industry?: string | null; sector?: string | null; companyName?: string | null }>
  >({})
  const [industryTrendMap, setIndustryTrendMap] = useState<Record<string, number>>({})
  const [industryTrendMap6M, setIndustryTrendMap6M] = useState<Record<string, number>>({})
  const [industryTrendMap1Y, setIndustryTrendMap1Y] = useState<Record<string, number>>({})
  const [industryTrendMapYtd, setIndustryTrendMapYtd] = useState<Record<string, number>>({})
  const [fetchingFundamentals, setFetchingFundamentals] = useState(false)
  const [fundamentalsProgress, setFundamentalsProgress] = useState<{ index: number; total: number } | null>(null)
  const [sortColumn, setSortColumn] = useState<string>('opus45')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [viewMode, setViewMode] = useState<'table' | 'charts'>('table')
  // Opus4.5 signals state
  const [opus45Signals, setOpus45Signals] = useState<Opus45Signal[]>([])
  /** Per-ticker Opus score for every analyzed ticker (800+); used for table column. */
  const [opus45AllScores, setOpus45AllScores] = useState<Array<{ ticker: string; opus45Confidence: number; opus45Grade: string }>>([])
  const [, setOpus45Loading] = useState(false)
  const [opus45Stats, setOpus45Stats] = useState<{ total: number; strong: number; moderate: number; weak: number; avgConfidence: number; avgRiskReward: number } | null>(null)

  // Load scan-results (includes Opus4.5 when ?includeOpus=true) — single fetch for unified payload
  useEffect(() => {
    let cancelled = false
    setOpus45Loading(true)
    fetch(`${API_BASE}/api/scan-results`, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`API ${r.status}`)
        return r.json()
      })
      .then((d: ScanPayload & { opus45Signals?: Opus45Signal[]; opus45Stats?: typeof opus45Stats }) => {
        if (!cancelled) {
          setData(d)
          setApiError(null)
          // Opus merged into scan-results: use embedded signals/stats, derive allScores from results
          if (d.opus45Signals != null) {
            setOpus45Signals(d.opus45Signals)
            setOpus45Stats(d.opus45Stats ?? null)
            const byTicker = (d.opus45Signals as Opus45Signal[]).reduce<Record<string, Opus45Signal>>((acc, s) => {
              acc[s.ticker] = s
              return acc
            }, {})
            setOpus45AllScores(
              (d.results || []).map((r) => {
                const sig = byTicker[r.ticker]
                const res = r as { opus45Confidence?: number; opus45Grade?: string; entryDate?: string | number; daysSinceBuy?: number; pctChange?: number; entryPrice?: number; stopLossPrice?: number; riskRewardRatio?: number }
                const base = {
                  ticker: r.ticker,
                  opus45Confidence: res.opus45Confidence ?? sig?.opus45Confidence ?? 0,
                  opus45Grade: res.opus45Grade ?? sig?.opus45Grade ?? 'F',
                }
                const openTrade = res.entryDate != null || res.daysSinceBuy != null || res.pctChange != null
                  ? { entryDate: res.entryDate, daysSinceBuy: res.daysSinceBuy, pctChange: res.pctChange, entryPrice: res.entryPrice, stopLossPrice: res.stopLossPrice, riskRewardRatio: res.riskRewardRatio }
                  : (sig?.entryDate != null || sig?.daysSinceBuy != null || sig?.pctChange != null)
                    ? { entryDate: sig.entryDate, daysSinceBuy: sig.daysSinceBuy, pctChange: sig.pctChange, entryPrice: sig.entryPrice, stopLossPrice: sig.stopLossPrice, riskRewardRatio: sig.riskRewardRatio }
                    : null
                return openTrade ? { ...base, ...openTrade } : base
              })
            )
          } else {
            // Fallback: fetch Opus separately (older API)
            fetch(`${API_BASE}/api/opus45/signals`, { cache: 'no-store' })
              .then((r) => r.json())
              .then((od) => {
                if (!cancelled) {
                  setOpus45Signals(od.signals || [])
                  setOpus45AllScores(od.allScores || [])
                  setOpus45Stats(od.stats ?? null)
                }
              })
              .catch(() => {
                if (!cancelled) {
                  setOpus45Signals([])
                  setOpus45AllScores([])
                  setOpus45Stats(null)
                }
              })
          }
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setData({ scannedAt: null, results: [], totalTickers: 0, vcpBullishCount: 0 })
          setApiError(err instanceof Error ? err.message : 'Cannot reach app')
          setOpus45Signals([])
          setOpus45AllScores([])
          setOpus45Stats(null)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
          setOpus45Loading(false)
        }
      })
    return () => { cancelled = true }
  }, [])

  // Reload data when scan completes (scan-results includes Opus from updated cache)
  useEffect(() => {
    if (!scanState.running && scanState.progress.completedAt) {
      setOpus45Loading(true)
      fetch(`${API_BASE}/api/scan-results`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((d: ScanPayload & { opus45Signals?: Opus45Signal[]; opus45Stats?: typeof opus45Stats }) => {
          setData(d)
          if (d.opus45Signals != null) {
            setOpus45Signals(d.opus45Signals)
            setOpus45Stats(d.opus45Stats ?? null)
            const byTicker = (d.opus45Signals as Opus45Signal[]).reduce<Record<string, Opus45Signal>>((acc, s) => {
              acc[s.ticker] = s
              return acc
            }, {})
            setOpus45AllScores(
              (d.results || []).map((r) => {
                const sig = byTicker[r.ticker]
                const res = r as { opus45Confidence?: number; opus45Grade?: string; entryDate?: string | number; daysSinceBuy?: number; pctChange?: number; entryPrice?: number; stopLossPrice?: number; riskRewardRatio?: number }
                const base = {
                  ticker: r.ticker,
                  opus45Confidence: res.opus45Confidence ?? sig?.opus45Confidence ?? 0,
                  opus45Grade: res.opus45Grade ?? sig?.opus45Grade ?? 'F',
                }
                const openTrade = res.entryDate != null || res.daysSinceBuy != null || res.pctChange != null
                  ? { entryDate: res.entryDate, daysSinceBuy: res.daysSinceBuy, pctChange: res.pctChange, entryPrice: res.entryPrice, stopLossPrice: res.stopLossPrice, riskRewardRatio: res.riskRewardRatio }
                  : (sig?.entryDate != null || sig?.daysSinceBuy != null || sig?.pctChange != null)
                    ? { entryDate: sig.entryDate, daysSinceBuy: sig.daysSinceBuy, pctChange: sig.pctChange, entryPrice: sig.entryPrice, stopLossPrice: sig.stopLossPrice, riskRewardRatio: sig.riskRewardRatio }
                    : null
                return openTrade ? { ...base, ...openTrade } : base
              })
            )
          }
        })
        .catch(() => {})
        .finally(() => setOpus45Loading(false))
    }
  }, [scanState.running, scanState.progress.completedAt])

  useEffect(() => {
    fetch(`${API_BASE}/api/fundamentals`, { cache: 'no-store' })
      .then((r) => r.json())
      .then(setFundamentals)
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch(`${API_BASE}/api/industry-trend`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        const { map3m, map6m, map1y, mapYtd } = buildIndustryMaps(d?.industries)
        setIndustryTrendMap(map3m)
        setIndustryTrendMap6M(map6m)
        setIndustryTrendMap1Y(map1y)
        setIndustryTrendMapYtd(mapYtd)
      })
      .catch(() => {})
  }, [])

  const runScan = async () => {
    try {
      // Start the scan
      await triggerScan();
      
      // Wait for scan to complete, then fetch fundamentals automatically
      const checkAndFetch = setInterval(async () => {
        if (!scanState.running && scanState.progress.completedAt) {
          clearInterval(checkAndFetch);
          
          // Refresh results
          const resultsResponse = await fetch(`${API_BASE}/api/scan-results`);
          const resultsData = await resultsResponse.json();
          setData(resultsData);
          
          // Auto-fetch fundamentals for all tickers
          const tickers = resultsData.results?.map((r: ScanResult) => r.ticker).filter(Boolean) || [];
          if (tickers.length > 0) {
            await fetchFundamentals();
          }
        }
      }, 1000);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to start scan');
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
      const res = await fetch(`${API_BASE}/api/fundamentals/fetch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers, force: true }), // true = always refetch to get company names (Yahoo cache can be stale)
        cache: 'no-store',
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
        { pctHeldByInst?: number | null; qtrEarningsYoY?: number | null; profitMargin?: number | null; operatingMargin?: number | null; industry?: string | null; sector?: string | null; companyName?: string | null }
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
              industry?: string | null
              sector?: string | null
              companyName?: string | null
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
                industry: msg.industry ?? null,
                sector: msg.sector ?? null,
                companyName: msg.companyName ?? null,
              }
              setFundamentalsProgress(msg.index != null && msg.total ? { index: msg.index, total: msg.total } : null)
              setFundamentals((prev) => ({ ...prev, ...merged }))
            }
          } catch {
            /* skip */
          }
        }
      }
      const finalRes = await fetch(`${API_BASE}/api/fundamentals?t=${Date.now()}`, { cache: 'no-store' })
      const final = await finalRes.json()
      setFundamentals({ ...final, ...merged })
      // Refetch industry trend so Industry 3M/6M/1Y/YTD columns update with new industry groupings
      fetch(`${API_BASE}/api/industry-trend`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => {
          const { map3m, map6m, map1y, mapYtd } = buildIndustryMaps(d?.industries)
          setIndustryTrendMap(map3m)
          setIndustryTrendMap6M(map6m)
          setIndustryTrendMap1Y(map1y)
          setIndustryTrendMapYtd(mapYtd)
        })
        .catch(() => {})
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
    fetch(`${API_BASE}/api/vcp/${encodeURIComponent(sym)}`)
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
          return Promise.reject(new Error('Empty or invalid response from app. Run: npm run dev'))
        }
        return body as Record<string, unknown>
      })
      .then((body) => setEvaluateResult({ ...body, ticker: sym } as EvaluateResult))
      .catch((err) => setEvaluateResult({ ticker: sym, vcpBullish: false, contractions: 0, atMa10: false, atMa20: false, atMa50: false, error: err instanceof Error ? err.message : String(err) }))
      .finally(() => setEvaluateLoading(false))
  }

  const results = data?.results ?? []
  // Map ticker -> Opus score for table column (all 800+ when API returns allScores, else only active signals)
  const opus45ByTicker = useMemo(() => {
    type Score = { opus45Confidence: number; opus45Grade: string; entryDate?: string | number; daysSinceBuy?: number; pctChange?: number; entryPrice?: number; stopLossPrice?: number; riskRewardRatio?: number }
    const m: Record<string, Score> = {}
    if (opus45AllScores.length > 0) {
      opus45AllScores.forEach((s: Score & { ticker: string }) => {
        m[s.ticker] = {
          opus45Confidence: s.opus45Confidence,
          opus45Grade: s.opus45Grade,
          entryDate: s.entryDate,
          daysSinceBuy: s.daysSinceBuy,
          pctChange: s.pctChange,
          entryPrice: s.entryPrice,
          stopLossPrice: s.stopLossPrice,
          riskRewardRatio: s.riskRewardRatio
        }
      })
    } else {
      opus45Signals.forEach((s) => {
        m[s.ticker] = { opus45Confidence: s.opus45Confidence, opus45Grade: s.opus45Grade }
      })
    }
    return m
  }, [opus45AllScores, opus45Signals])

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
        return r.enhancedScore ?? r.score ?? -1
      case 'opus45':
        return opus45ByTicker[r.ticker]?.opus45Confidence ?? -1
      case 'pattern':
        return r.pattern ?? 'None'
      case 'patternConfidence':
        return r.patternConfidence ?? -1
      case 'relativeStrength':
        return r.relativeStrength ?? -Infinity
      case 'industryRank':
        return r.industryRank ?? Infinity
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
      case 'industry':
        return fundamentals[r.ticker]?.industry ?? ''
      case 'industry3M':
        return industryTrendMap[fundamentals[r.ticker]?.industry ?? ''] ?? -Infinity
      case 'industry6M':
        return industryTrendMap6M[fundamentals[r.ticker]?.industry ?? ''] ?? -Infinity
      case 'industry1Y':
        return industryTrendMap1Y[fundamentals[r.ticker]?.industry ?? ''] ?? -Infinity
      case 'industryYtd':
        return industryTrendMapYtd[fundamentals[r.ticker]?.industry ?? ''] ?? -Infinity
      default:
        return ''
    }
  }

  const sorted = [...filtered].sort((a, b) => {
    const va = getSortValue(a, sortColumn)
    const vb = getSortValue(b, sortColumn)
    const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
    const primary = sortDir === 'asc' ? cmp : -cmp
    // Secondary sort: when primary equal and sorting by opus45, break tie by Industry 1Y (desc)
    if (primary !== 0) return primary
    if (sortColumn === 'opus45') {
      const i1yA = industryTrendMap1Y[fundamentals[a.ticker]?.industry ?? ''] ?? -Infinity
      const i1yB = industryTrendMap1Y[fundamentals[b.ticker]?.industry ?? ''] ?? -Infinity
      return i1yB - i1yA
    }
    return 0
  })

  const handleSort = useCallback((col: string) => {
    setSortColumn((prev) => {
      if (prev === col) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
        return prev
      }
      setSortDir(col === 'ticker' ? 'asc' : 'desc')
      return col
    })
  }, [])

  const sortHeaderProps = { sortColumn, sortDir, onSort: handleSort }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-slate-400">Loading scan results…</div>
      </div>
    )
  }

  return (
    <div className="w-[90%] max-w-full mx-auto">
      <div className="space-y-8">
      {/* Action row: ticker search + Evaluate left; Fetch Industry + Run Scan right */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
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
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium"
          >
            {evaluateLoading ? 'Evaluating…' : 'Evaluate'}
          </button>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={runScan}
            disabled={scanState.running || fetchingFundamentals}
            className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-medium"
          >
            {scanState.running
              ? `Scanning ${scanState.progress.index}/${scanState.progress.total}…`
              : fetchingFundamentals
                ? fundamentalsProgress
                  ? `Fetching fundamentals ${fundamentalsProgress.index}/${fundamentalsProgress.total}…`
                  : 'Fetching fundamentals…'
                : 'Run Scan'}
          </button>
        </div>
      </div>

      {/* Banner when the app can't load data (single server – no separate API) */}
      {apiError && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
          <p className="text-amber-200 font-medium">Cannot load data</p>
          <p className="text-amber-200/80 text-sm mt-1">
            {typeof window !== 'undefined' && !window.location.hostname.includes('localhost')
              ? <>Deployed app: add a <code className="bg-amber-900/50 px-1 rounded">data/</code> snapshot to the repo for read-only data, or set <code className="bg-amber-900/50 px-1 rounded">VITE_API_URL</code> to an external server for scans.</>
              : <>Run the app: <code className="bg-amber-900/50 px-1 rounded">npm run dev</code> at <code className="bg-amber-900/50 px-1 rounded">http://localhost:5173</code>, then refresh.</>
            }
          </p>
        </div>
      )}
      
      {/* Background scan indicator */}
      {scanState.running && (
        <div className="rounded-xl border border-sky-500/40 bg-sky-500/10 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sky-200 font-medium">🔄 Scan running in background</p>
              <p className="text-sky-200/80 text-sm mt-1">
                Progress: {scanState.progress.index}/{scanState.progress.total} tickers 
                · {scanState.progress.vcpBullishCount} VCP bullish
                · You can navigate away, the scan will continue
              </p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-sky-400">
                {Math.round((scanState.progress.index / Math.max(scanState.progress.total, 1)) * 100)}%
              </div>
            </div>
          </div>
          <div className="mt-3 h-2 bg-slate-800 rounded-full overflow-hidden">
            <div 
              className="h-full bg-sky-500 transition-all duration-300"
              style={{ width: `${(scanState.progress.index / Math.max(scanState.progress.total, 1)) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Evaluation result (if any) */}
      {evaluateResult && (
        <div className="rounded-lg bg-slate-800/80 border border-slate-700 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-semibold text-slate-100">{evaluateResult.ticker}</span>
            {evaluateResult.error ? (
              <span className="text-amber-400 text-sm">{evaluateResult.error}</span>
            ) : (
              <>
                <span className="text-slate-400">Score:</span>
                <span className="text-xl font-bold text-slate-100">{evaluateResult.enhancedScore ?? evaluateResult.score ?? 0}/100</span>
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
      
      {/* Last scan info - no border, 10pt font */}
      <div className="flex flex-wrap items-center gap-4" style={{ fontSize: '10pt' }}>
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

      <div className="flex flex-wrap items-center gap-4">
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
        <div className="flex items-center gap-2 border-l border-slate-700 pl-4">
          <span className="text-slate-400 text-sm">View:</span>
          <button
            onClick={() => setViewMode('table')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              viewMode === 'table'
                ? 'bg-sky-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Table
          </button>
          <button
            onClick={() => setViewMode('charts')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              viewMode === 'charts'
                ? 'bg-sky-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Charts
          </button>
        </div>
      </div>

      {viewMode === 'charts' ? (
        sorted.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-8 text-center text-slate-500">
            No results. Run <code className="bg-slate-800 px-1 rounded">npm run populate-tickers 500</code> then click Run scan.
          </div>
        ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {sorted.map((r) => (
            <TickerChart
              key={r.ticker}
              ticker={r.ticker}
              score={r.score}
              recommendation={r.recommendation}
            />
          ))}
        </div>
        )
      ) : (
      <>
      {/* Table lives in its own scroll container so sticky thead sticks to the top of this box (and thus viewport when scrolled into view). Parent overflow-x would otherwise trap sticky. */}
      <div className="rounded-xl border border-slate-800 max-h-[calc(100vh-6rem)] overflow-auto min-w-0">
        <table className="w-full min-w-[2000px]">
            <thead className="sticky top-0 z-30 bg-slate-900 shadow-[0_1px_0_0_rgba(148,163,184,0.1)]">
              <tr className="border-b border-slate-800 bg-slate-900">
                <SortHeader col="ticker" label="Ticker" {...sortHeaderProps} sticky stickyLeft="0" />
                <SortHeader col="opus45" label="Opus" {...sortHeaderProps} alignRight sticky stickyLeft="10rem" />
                <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 whitespace-nowrap">Open Trade</th>
                <SortHeader col="pattern" label="Setup" {...sortHeaderProps} />
                <SortHeader col="relativeStrength" label="RS" {...sortHeaderProps} alignRight />
                <SortHeader col="industryRank" label="Ind.Rank" {...sortHeaderProps} alignRight />
                <SortHeader col="close" label="Price" {...sortHeaderProps} alignRight />
                <SortHeader col="contractions" label="Contractions" {...sortHeaderProps} alignRight />
                <SortHeader col="ma10" label="10 MA" {...sortHeaderProps} alignRight />
                <SortHeader col="ma20" label="20 MA" {...sortHeaderProps} alignRight />
                <SortHeader col="ma50" label="50 MA" {...sortHeaderProps} alignRight />
                <SortHeader col="pctHeldByInst" label="% Held by Inst" {...sortHeaderProps} alignRight />
                <SortHeader col="industry1Y" label="Industry 1Y" {...sortHeaderProps} alignRight />
                <SortHeader col="industry6M" label="Industry 6M" {...sortHeaderProps} alignRight />
                <SortHeader col="industry3M" label="Industry 3M" {...sortHeaderProps} alignRight />
                <SortHeader col="industryYtd" label="Industry YTD" {...sortHeaderProps} alignRight />
                <SortHeader col="qtrEarningsYoY" label="Qtr Earnings YoY" {...sortHeaderProps} alignRight />
                <SortHeader col="profitMargin" label="Profit Margin" {...sortHeaderProps} alignRight />
                <SortHeader col="operatingMargin" label="Operating Margin" {...sortHeaderProps} alignRight />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                    <td colSpan={19} className="px-4 py-8 text-center text-slate-500">
                    No results. Run <code className="bg-slate-800 px-1 rounded">npm run populate-tickers 500</code> then click Run scan.
                  </td>
                </tr>
              ) : (
                sorted.map((r) => (
                  <tr key={r.ticker} className="group border-b border-slate-800/80 hover:bg-slate-800/40">
                    <td className="sticky left-0 z-10 min-w-[10rem] bg-slate-900/95 backdrop-blur-sm shadow-[2px_0_4px_-1px_rgba(0,0,0,0.3)] group-hover:bg-slate-800/40 px-4 py-3">
                      <Link to={`/stock/${r.ticker}`} state={{ scanResult: r }} className="text-sky-400 hover:text-sky-300 font-medium">
                        {r.ticker}
                      </Link>
                      {(fundamentals[r.ticker]?.companyName ?? fundamentals[r.ticker]?.industry) && (
                        <div className="text-slate-400 mt-1 truncate" style={{ fontSize: '10pt' }}>
                          {fundamentals[r.ticker].companyName ?? fundamentals[r.ticker].industry}
                        </div>
                      )}
                      {(() => {
                        const ot = opus45ByTicker[r.ticker]
                        const hasTrade = ot && (ot.entryDate != null || ot.entryPrice != null || ot.stopLossPrice != null || ot.riskRewardRatio != null)
                        if (!hasTrade) return null
                        const raw = ot!.entryDate
                        const longDate =
                          raw == null
                            ? ''
                            : typeof raw === 'number'
                              ? new Date(raw < 1e12 ? raw * 1000 : raw).toISOString().slice(0, 10)
                              : String(raw)
                        const entry = ot!.entryPrice != null ? `$${ot!.entryPrice.toFixed(2)}` : ''
                        const stop = ot!.stopLossPrice != null ? `$${ot!.stopLossPrice.toFixed(2)}` : ''
                        const rr = ot!.riskRewardRatio != null ? `${ot!.riskRewardRatio.toFixed(1)}:1` : ''
                        const parts = [longDate, entry, stop, rr].filter(Boolean)
                        if (parts.length === 0) return null
                        return (
                          <div className="text-slate-500 mt-0.5 truncate text-[10pt]">
                            {parts.join(' · ')}
                          </div>
                        )
                      })()}
                    </td>
                    {/* Opus: primary strength with card-style green/yellow color coding */}
                    <td className="sticky left-[10rem] z-10 min-w-[5rem] bg-slate-900/95 backdrop-blur-sm shadow-[2px_0_4px_-1px_rgba(0,0,0,0.3)] group-hover:bg-slate-800/40 px-4 py-3 font-mono tabular-nums text-right">
                      {opus45ByTicker[r.ticker] ? (
                        (() => {
                          const o = opus45ByTicker[r.ticker]
                          const conf = o.opus45Confidence ?? 0
                          const grade = o.opus45Grade ?? 'F'
                          const isStrong = grade === 'A+' || grade === 'A' || conf >= 80
                          const isModerate = grade === 'B+' || grade === 'B' || (conf >= 60 && conf < 80)
                          const badgeClass = isStrong
                            ? 'bg-emerald-500/30 text-emerald-300'
                            : isModerate
                              ? 'bg-yellow-500/30 text-yellow-300'
                              : conf > 0
                                ? 'bg-slate-600 text-slate-300'
                                : 'text-slate-500'
                          return (
                            <span
                              className={`inline-block whitespace-nowrap px-2 py-0.5 rounded text-xs font-medium ${badgeClass}`}
                              title="Opus4.5 signal strength (entry quality, pattern, volume)"
                            >
                              {o.opus45Confidence}% {o.opus45Grade}
                            </span>
                          )
                        })()
                      ) : (
                        <span className="text-slate-500">–</span>
                      )}
                    </td>
                    {/* Open Trade: line1 = date + days (nowrap), line2 = P/L % + $ (nowrap) */}
                    <td className="px-4 py-3 font-mono text-right text-sm min-w-[10rem]">
                      {(() => {
                        const ot = opus45ByTicker[r.ticker];
                        if (ot?.daysSinceBuy == null) return <span className="text-slate-500">–</span>;
                        // entryDate may come from cache as number (ms); normalize to YYYY-MM-DD for display
                        const raw = ot.entryDate;
                        const entryDateStr =
                          raw == null
                            ? null
                            : typeof raw === 'number'
                              ? new Date(raw < 1e12 ? raw * 1000 : raw).toISOString().slice(0, 10)
                              : String(raw);
                        if (entryDateStr == null) return <span className="text-slate-500">–</span>;
                        // P/L on $1000 assumed position: 1000 * (pctChange/100)
                        const pnlDollar = ot.pctChange != null ? (1000 * ot.pctChange) / 100 : null;
                        return (
                          <div className="flex flex-col items-end gap-0">
                            <span className="text-slate-300 whitespace-nowrap">
                              {entryDateStr} {ot.daysSinceBuy}d
                            </span>
                            {ot.pctChange != null && (
                              <span className={`whitespace-nowrap ${ot.pctChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {ot.pctChange >= 0 ? '+' : ''}{ot.pctChange}%
                                {pnlDollar != null && (
                                  <> ({(ot.pctChange >= 0 ? '+' : '−')}${(pnlDollar >= 0 ? pnlDollar : -pnlDollar).toFixed(2)})</>
                                )}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    {/* Pattern/Setup */}
                    <td className="px-4 py-3">
                      {r.pattern && r.pattern !== 'None' ? (
                        <div className="flex items-center gap-2" title={r.patternDetails || ''}>
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            r.pattern === 'VCP' ? 'bg-sky-500/20 text-sky-400' :
                            r.pattern === 'Flat Base' ? 'bg-purple-500/20 text-purple-400' :
                            r.pattern === 'Cup-with-Handle' ? 'bg-emerald-500/20 text-emerald-400' :
                            'bg-slate-700 text-slate-400'
                          }`}>
                            {r.pattern === 'Cup-with-Handle' ? 'C&H' : r.pattern === 'Flat Base' ? 'Flat' : r.pattern}
                          </span>
                          {r.patternConfidence != null && (
                            <span className="text-xs text-slate-500 font-mono">{r.patternConfidence}%</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-500">–</span>
                      )}
                    </td>
                    {/* RS vs SPY */}
                    <td className="px-4 py-3 font-mono tabular-nums text-right">
                      {r.relativeStrength != null ? (
                        <span className={`font-medium ${
                          r.relativeStrength > 110 ? 'text-emerald-400' :
                          r.relativeStrength > 100 ? 'text-green-400' :
                          r.relativeStrength > 90 ? 'text-slate-300' :
                          'text-red-400'
                        }`}>
                          {r.relativeStrength.toFixed(1)}
                        </span>
                      ) : '–'}
                    </td>
                    {/* Industry Rank */}
                    <td className="px-4 py-3 font-mono tabular-nums text-right">
                      {r.industryRank != null ? (
                        <span className={`font-medium ${
                          r.industryRank <= 20 ? 'text-emerald-400' :
                          r.industryRank <= 40 ? 'text-green-400' :
                          r.industryRank <= 80 ? 'text-slate-300' :
                          'text-red-400'
                        }`}>
                          #{r.industryRank}
                        </span>
                      ) : '–'}
                    </td>
                    <td className="px-4 py-3 text-slate-300 font-mono tabular-nums text-right">{r.lastClose != null ? `$${r.lastClose.toFixed(2)}` : '–'}</td>
                    <td className="px-4 py-3 text-slate-300 font-mono text-right">{r.contractions ?? '–'}</td>
                    <td className="px-4 py-3 text-right">{r.atMa10 ? '✅' : '–'}</td>
                    <td className="px-4 py-3 text-right">{r.atMa20 ? '✅' : '–'}</td>
                    <td className="px-4 py-3 text-right">{r.atMa50 ? '✅' : '–'}</td>
                    <td className="px-4 py-3 text-slate-300 font-mono tabular-nums text-right">
                      {fundamentals[r.ticker]?.pctHeldByInst != null ? `${fundamentals[r.ticker].pctHeldByInst}%` : '–'}
                    </td>
                    {/* Industry 1Y */}
                    <td className="px-4 py-3 font-mono text-right">
                      {(() => {
                        const ind = fundamentals[r.ticker]?.industry
                        const trend = ind != null ? industryTrendMap1Y[ind] : undefined
                        return trend != null ? (
                          <span className={trend >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                            {trend >= 0 ? '+' : ''}{trend.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-slate-500">–</span>
                        )
                      })()}
                    </td>
                    {/* Industry 6M */}
                    <td className="px-4 py-3 font-mono text-right">
                      {(() => {
                        const ind = fundamentals[r.ticker]?.industry
                        const trend = ind != null ? industryTrendMap6M[ind] : undefined
                        return trend != null ? (
                          <span className={trend >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                            {trend >= 0 ? '+' : ''}{trend.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-slate-500">–</span>
                        )
                      })()}
                    </td>
                    {/* Industry 3M */}
                    <td className="px-4 py-3 font-mono text-right">
                      {(() => {
                        const ind = fundamentals[r.ticker]?.industry
                        const trend = ind != null ? industryTrendMap[ind] : undefined
                        return trend != null ? (
                          <span className={trend >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                            {trend >= 0 ? '+' : ''}{trend.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-slate-500">–</span>
                        )
                      })()}
                    </td>
                    {/* Industry YTD */}
                    <td className="px-4 py-3 font-mono text-right">
                      {(() => {
                        const ind = fundamentals[r.ticker]?.industry
                        const trend = ind != null ? industryTrendMapYtd[ind] : undefined
                        return trend != null ? (
                          <span className={trend >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                            {trend >= 0 ? '+' : ''}{trend.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-slate-500">–</span>
                        )
                      })()}
                    </td>
                    <td className="px-4 py-3 text-slate-300 font-mono tabular-nums text-right">
                      {fundamentals[r.ticker]?.qtrEarningsYoY != null ? `${fundamentals[r.ticker].qtrEarningsYoY}%` : '–'}
                    </td>
                    <td className="px-4 py-3 text-slate-300 font-mono tabular-nums text-right">
                      {fundamentals[r.ticker]?.profitMargin != null ? `${fundamentals[r.ticker].profitMargin}%` : '–'}
                    </td>
                    <td className="px-4 py-3 text-slate-300 font-mono tabular-nums text-right">
                      {fundamentals[r.ticker]?.operatingMargin != null ? `${fundamentals[r.ticker].operatingMargin}%` : '–'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
      </div>
      </>
      )}
      </div>
    </div>
  )
}
