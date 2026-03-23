import { lazy, Suspense, useEffect, useState, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import SortHeader from '../components/SortHeader'
import { useScan } from '../contexts/ScanContext'
import { buildIndustryMaps } from '../utils/industryMaps'
import { API_BASE } from '../utils/api'
import { resolveSignalAgentLabel, formatSignalPL, SIGNAL_AGENT_CRITERIA, getEffectiveSignalSetups } from '../utils/signalAgentDisplay'
import { evaluateCompiledCriteria, type CompiledCriterion } from '../utils/agentCriteriaRuntime'
import { readWatchlist, getWatchlistTickersSet } from '../utils/watchlistStorage.js'
import { buildTopRs50 } from '../utils/topRsScreen.js'
import { getNextSortState, getDefaultSortForFilter } from '../utils/dashboardSort.js'

/** Descending table sort: A+ highest */
function lanceGradeSortValue(score: string | null | undefined): number {
  const order: Record<string, number> = { 'A+': 6, A: 5, B: 4, C: 3, D: 2 }
  return score != null && order[score] != null ? order[score]! : 0
}
import { getOpusDisplayState } from '../utils/opusScoreDisplay.js'
import { readLocalDataCache, writeLocalDataCache } from '../utils/localDataCache.js'
import { getInitialChartCount, getNextChartCount } from '../utils/chartRenderWindow.js'

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
    rsRaw?: number
    rsRating?: number
    change3m?: number
    change6m?: number
    change9m?: number
    change12m?: number
  } | null
  // NEW: Pattern detection fields
  pattern?: string
  patternConfidence?: number
  patternDetails?: string
  signalSetups?: string[]
  signalSetupsRecent?: string[]
  signalSetupsRecent5?: string[]
  lancePreTrade?: {
    score: 'A+' | 'A' | 'B' | 'C' | 'D' | null
    insufficientData?: boolean
    timeBehavior?: string
    rateOfChange?: string
    relativeStrength?: string
    location?: string
    actionable?: boolean
    sizeHint?: string
    watchConfirm?: string
    watchInvalidate?: string
    summaryLine?: string
  } | null
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
  isNewBuyToday?: boolean
  rankScore?: number
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

type Opus45Stats = {
  total: number
  strong: number
  moderate: number
  weak: number
  avgConfidence: number
  avgRiskReward: number
} | null

const CRITERIA_OVERRIDES_KEY = 'stock-screener:signalAgentCriteriaOverrides'
const COMPILED_CRITERIA_OVERRIDES_KEY = 'stock-screener:signalAgentCompiledCriteriaOverrides'
const DASHBOARD_SCAN_CACHE_KEY = 'stock-screener:dashboard:scan-results'
const DASHBOARD_FUNDAMENTALS_CACHE_KEY = 'stock-screener:dashboard:fundamentals'
const DASHBOARD_INDUSTRY_TREND_CACHE_KEY = 'stock-screener:dashboard:industry-trend'
const DASHBOARD_SCAN_CACHE_TTL_MS = 15 * 1000
const DASHBOARD_FUNDAMENTALS_CACHE_TTL_MS = 5 * 60 * 1000
const DASHBOARD_INDUSTRY_TREND_CACHE_TTL_MS = 5 * 60 * 1000
const CHART_BATCH_SIZE = 12
const DASHBOARD_FUNDAMENTALS_FIELDS = [
  'pctHeldByInst',
  'qtrEarningsYoY',
  'profitMargin',
  'operatingMargin',
  'industry',
  'sector',
  'companyName',
] as const
const LazyTickerChart = lazy(() => import('../components/TickerChart'))
const LazyMarketIndexRegimeCards = lazy(() => import('../features/market-regime/MarketIndexRegimeCards'))

function isCompiledCriterion(value: unknown): value is CompiledCriterion {
  if (!value || typeof value !== 'object') return false
  const v = value as { metric?: unknown; op?: unknown; value?: unknown }
  return (
    typeof v.metric === 'string' &&
    ['eq', 'gt', 'gte', 'lt', 'lte'].includes(String(v.op)) &&
    (typeof v.value === 'number' || typeof v.value === 'boolean' || typeof v.value === 'string')
  )
}

/** Get criteria for agent: defaults merged with localStorage overrides */
function getCriteriaForAgent(agentId: string): string[] {
  const defaults = SIGNAL_AGENT_CRITERIA[agentId as keyof typeof SIGNAL_AGENT_CRITERIA]?.criteria ?? []
  try {
    const raw = localStorage.getItem(CRITERIA_OVERRIDES_KEY)
    if (!raw) return defaults
    const overrides = JSON.parse(raw) as Record<string, string[]>
    return overrides[agentId] ?? defaults
  } catch {
    return defaults
  }
}

/** Save criteria overrides to localStorage */
function saveCriteriaOverrides(agentId: string, criteria: string[]) {
  try {
    const raw = localStorage.getItem(CRITERIA_OVERRIDES_KEY)
    const overrides: Record<string, string[]> = raw ? JSON.parse(raw) : {}
    overrides[agentId] = criteria
    localStorage.setItem(CRITERIA_OVERRIDES_KEY, JSON.stringify(overrides))
  } catch {
    /* ignore */
  }
}

/** Get compiled criteria for agent: translated, executable rules */
function getCompiledCriteriaForAgent(agentId: string): CompiledCriterion[] {
  try {
    const raw = localStorage.getItem(COMPILED_CRITERIA_OVERRIDES_KEY)
    if (!raw) return []
    const overrides = JSON.parse(raw) as Record<string, unknown>
    const list = overrides[agentId]
    if (!Array.isArray(list)) return []
    return list.filter(isCompiledCriterion)
  } catch {
    return []
  }
}

/** Save compiled criteria overrides to localStorage */
function saveCompiledCriteriaOverrides(agentId: string, criteria: CompiledCriterion[]) {
  try {
    const raw = localStorage.getItem(COMPILED_CRITERIA_OVERRIDES_KEY)
    const overrides: Record<string, CompiledCriterion[]> = raw ? JSON.parse(raw) : {}
    overrides[agentId] = criteria
    localStorage.setItem(COMPILED_CRITERIA_OVERRIDES_KEY, JSON.stringify(overrides))
  } catch {
    /* ignore */
  }
}

function hasMetricForCompiledCriterion(
  row: Record<string, unknown>,
  criterion: CompiledCriterion,
): boolean {
  if (criterion.metric === 'turtleBreakout20or55') {
    return (
      typeof row.turtleBreakout20 === 'boolean' ||
      typeof row.turtleBreakout55 === 'boolean'
    )
  }
  return row[criterion.metric] != null
}

export default function Dashboard() {
  const { scanState, startScan: triggerScan } = useScan();
  const [data, setData] = useState<ScanPayload | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<
    | 'all'
    | 'unusual_vol'
    | 'momentum_scout'
    | 'base_hunter'
    | 'breakout_tracker'
    | 'turtle_trader'
    | 'lance'
  >('all')
  const [fundamentals, setFundamentals] = useState<
    Record<string, { pctHeldByInst?: number | null; qtrEarningsYoY?: number | null; profitMargin?: number | null; operatingMargin?: number | null; industry?: string | null; sector?: string | null; companyName?: string | null }>
  >({})
  const [industryTrendMap, setIndustryTrendMap] = useState<Record<string, number>>({})
  const [industryTrendMap6M, setIndustryTrendMap6M] = useState<Record<string, number>>({})
  const [industryTrendMap1Y, setIndustryTrendMap1Y] = useState<Record<string, number>>({})
  const [industryTrendMapYtd, setIndustryTrendMapYtd] = useState<Record<string, number>>({})
  const initialSort = getDefaultSortForFilter('all')
  const [sortColumn, setSortColumn] = useState<string>(initialSort.sortColumn)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(initialSort.sortDir)
  const [viewMode, setViewMode] = useState<'table' | 'charts'>('table')
  const [visibleChartCount, setVisibleChartCount] = useState(CHART_BATCH_SIZE)
  /** Agent id for Edit criteria modal (null = closed) */
  const [editCriteriaAgent, setEditCriteriaAgent] = useState<string | null>(null)
  /** Editable criteria in modal (synced when modal opens) */
  const [editCriteriaDraft, setEditCriteriaDraft] = useState<string[]>([])
  // Opus4.5 signals state
  const [opus45Signals, setOpus45Signals] = useState<Opus45Signal[]>([])
  /** Per-ticker Opus score for every analyzed ticker (800+); used for table column. */
  const [opus45AllScores, setOpus45AllScores] = useState<Array<{ ticker: string; opus45Confidence: number; opus45Grade: string }>>([])
  const [, setOpus45Loading] = useState(false)
  const [, setOpus45Stats] = useState<Opus45Stats>(null)
  const [watchlistOnly, setWatchlistOnly] = useState(false)
  const [watchlistMap, setWatchlistMap] = useState<Record<string, { note: string }>>({})
  const [watchlistTickers, setWatchlistTickers] = useState<Set<string>>(() => getWatchlistTickersSet())
  const [topRsOnly, setTopRsOnly] = useState(false)

  const syncWatchlist = useCallback(() => {
    const items = readWatchlist()
    const map = items.reduce<Record<string, { note: string }>>((acc, item) => {
      acc[item.ticker] = { note: item.note }
      return acc
    }, {})
    setWatchlistMap(map)
    setWatchlistTickers(new Set(Object.keys(map)))
  }, [])

  const applyIndustryTrendPayload = useCallback((payload: { industries?: Parameters<typeof buildIndustryMaps>[0] } | null | undefined) => {
    const { map3m, map6m, map1y, mapYtd } = buildIndustryMaps(payload?.industries)
    setIndustryTrendMap(map3m)
    setIndustryTrendMap6M(map6m)
    setIndustryTrendMap1Y(map1y)
    setIndustryTrendMapYtd(mapYtd)
  }, [])

  const applyScanPayload = useCallback((d: ScanPayload & { opus45Signals?: Opus45Signal[]; opus45Stats?: Opus45Stats }) => {
    setData(d)
    setApiError(null)

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
          const res = r as { opus45Confidence?: number; opus45Grade?: string; entryDate?: string | number; daysSinceBuy?: number; isNewBuyToday?: boolean; rankScore?: number; pctChange?: number; entryPrice?: number; stopLossPrice?: number; riskRewardRatio?: number }
          const base = {
            ticker: r.ticker,
            opus45Confidence: res.opus45Confidence ?? sig?.opus45Confidence ?? 0,
            opus45Grade: res.opus45Grade ?? sig?.opus45Grade ?? 'F',
          }
          const openTrade = res.entryDate != null || res.daysSinceBuy != null || res.pctChange != null
            ? { entryDate: res.entryDate, daysSinceBuy: res.daysSinceBuy, isNewBuyToday: res.isNewBuyToday, rankScore: res.rankScore, pctChange: res.pctChange, entryPrice: res.entryPrice, stopLossPrice: res.stopLossPrice, riskRewardRatio: res.riskRewardRatio }
            : (sig?.entryDate != null || sig?.daysSinceBuy != null || sig?.pctChange != null)
              ? { entryDate: sig.entryDate, daysSinceBuy: sig.daysSinceBuy, isNewBuyToday: sig.isNewBuyToday, rankScore: sig.rankScore, pctChange: sig.pctChange, entryPrice: sig.entryPrice, stopLossPrice: sig.stopLossPrice, riskRewardRatio: sig.riskRewardRatio }
              : null
          return openTrade ? { ...base, ...openTrade } : base
        })
      )
      return
    }

    setOpus45Signals([])
    setOpus45AllScores([])
    setOpus45Stats(null)
  }, [])

  const loadDashboardFundamentals = useCallback(async (sourceResults: ScanResult[] = data?.results ?? []) => {
    const tickers = [...new Set(sourceResults.map((row) => row.ticker).filter(Boolean))]
    if (tickers.length === 0) {
      setFundamentals({})
      return
    }
    const params = new URLSearchParams()
    params.set('tickers', tickers.join(','))
    params.set('fields', DASHBOARD_FUNDAMENTALS_FIELDS.join(','))
    params.set('includeRaw', 'false')
    const response = await fetch(`${API_BASE}/api/fundamentals?${params.toString()}`)
    if (!response.ok) throw new Error(`API ${response.status}`)
    const payload = await response.json()
    setFundamentals(payload)
    writeLocalDataCache(DASHBOARD_FUNDAMENTALS_CACHE_KEY, payload)
  }, [data?.results])

  // Load scan-results (includes Opus4.5 when ?includeOpus=true) — single fetch for unified payload
  useEffect(() => {
    let cancelled = false
    const cached = readLocalDataCache<ScanPayload & { opus45Signals?: Opus45Signal[]; opus45Stats?: Opus45Stats }>(
      DASHBOARD_SCAN_CACHE_KEY,
      { ttlMs: DASHBOARD_SCAN_CACHE_TTL_MS, allowStale: true },
    )
    if (cached?.payload) {
      applyScanPayload(cached.payload)
      setLoading(false)
    }
    setOpus45Loading(true)
    fetch(`${API_BASE}/api/scan-results?cb=${Date.now()}`, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`API ${r.status}`)
        return r.json()
      })
      .then((d: ScanPayload & { opus45Signals?: Opus45Signal[]; opus45Stats?: Opus45Stats }) => {
        if (!cancelled) {
          writeLocalDataCache(DASHBOARD_SCAN_CACHE_KEY, d)
          applyScanPayload(d)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          if (!cached?.payload) {
            setData({ scannedAt: null, results: [], totalTickers: 0, vcpBullishCount: 0 })
            setOpus45Signals([])
            setOpus45AllScores([])
            setOpus45Stats(null)
          }
          setApiError(err instanceof Error ? err.message : 'Cannot reach app')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
          setOpus45Loading(false)
        }
      })
    return () => { cancelled = true }
  }, [applyScanPayload])

  // Reload data when scan completes (scan-results includes Opus from updated cache)
  useEffect(() => {
    if (!scanState.running && scanState.progress.completedAt) {
      setOpus45Loading(true)
      fetch(`${API_BASE}/api/scan-results?cb=${Date.now()}`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((d: ScanPayload & { opus45Signals?: Opus45Signal[]; opus45Stats?: Opus45Stats }) => {
          writeLocalDataCache(DASHBOARD_SCAN_CACHE_KEY, d)
          applyScanPayload(d)
        })
        .catch(() => {})
        .finally(() => setOpus45Loading(false))
    }
  }, [applyScanPayload, scanState.running, scanState.progress.completedAt])

  useEffect(() => {
    const cached = readLocalDataCache<Record<string, { pctHeldByInst?: number | null; qtrEarningsYoY?: number | null; profitMargin?: number | null; operatingMargin?: number | null; industry?: string | null; sector?: string | null; companyName?: string | null }>>(
      DASHBOARD_FUNDAMENTALS_CACHE_KEY,
      { ttlMs: DASHBOARD_FUNDAMENTALS_CACHE_TTL_MS, allowStale: true },
    )
    if (cached?.payload) setFundamentals(cached.payload)
  }, [])

  useEffect(() => {
    if (!data?.results?.length) return
    loadDashboardFundamentals(data.results).catch(() => {})
  }, [data?.scannedAt, data?.results, loadDashboardFundamentals])

  useEffect(() => {
    const cached = readLocalDataCache<{ industries?: Parameters<typeof buildIndustryMaps>[0] }>(
      DASHBOARD_INDUSTRY_TREND_CACHE_KEY,
      { ttlMs: DASHBOARD_INDUSTRY_TREND_CACHE_TTL_MS, allowStale: true },
    )
    if (cached?.payload) applyIndustryTrendPayload(cached.payload)

    fetch(`${API_BASE}/api/industry-trend?summary=true`)
      .then((r) => r.json())
      .then((d) => {
        applyIndustryTrendPayload(d)
        writeLocalDataCache(DASHBOARD_INDUSTRY_TREND_CACHE_KEY, d)
      })
      .catch(() => {})
  }, [applyIndustryTrendPayload])

  useEffect(() => {
    syncWatchlist()
    const onWatchlistChanged = () => syncWatchlist()
    window.addEventListener('watchlist:changed', onWatchlistChanged)
    window.addEventListener('storage', onWatchlistChanged)
    return () => {
      window.removeEventListener('watchlist:changed', onWatchlistChanged)
      window.removeEventListener('storage', onWatchlistChanged)
    }
  }, [syncWatchlist])

  const runScan = async () => {
    try {
      await triggerScan()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to start scan')
    }
  }

  const results = data?.results ?? []
  const topRs50 = useMemo(() => buildTopRs50(results, fundamentals), [results, fundamentals])
  const topRsTickerSet = useMemo(() => new Set(topRs50.map((row) => row.ticker)), [topRs50])
  // Map ticker -> Opus score for table column (all 800+ when API returns allScores, else only active signals)
  const opus45ByTicker = useMemo(() => {
    type Score = { opus45Confidence: number; opus45Grade: string; entryDate?: string | number; daysSinceBuy?: number; isNewBuyToday?: boolean; rankScore?: number; pctChange?: number; entryPrice?: number; stopLossPrice?: number; riskRewardRatio?: number }
    const m: Record<string, Score> = {}
    if (opus45AllScores.length > 0) {
      opus45AllScores.forEach((s: Score & { ticker: string }) => {
        m[s.ticker] = {
          opus45Confidence: s.opus45Confidence,
          opus45Grade: s.opus45Grade,
          entryDate: s.entryDate,
          daysSinceBuy: s.daysSinceBuy,
          isNewBuyToday: s.isNewBuyToday,
          rankScore: s.rankScore,
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

  const { filtered, filterMeta } = useMemo(() => {
    const matchesAgentFilter = (row: ScanResult, filterId: typeof filter): boolean => {
      return getEffectiveSignalSetups(row.signalSetupsRecent, row.signalSetups).includes(filterId)
    }

    if (filter === 'all') {
      return {
        filtered: results,
        filterMeta: {
          usingCompiled: false,
          fallbackUsed: false,
          compiledCount: 0,
          isEmpty: results.length === 0,
        },
      }
    }

    const compiled = getCompiledCriteriaForAgent(filter)
    if (compiled.length === 0) {
      const fallbackOnly = results.filter((r) => matchesAgentFilter(r, filter))
      return {
        filtered: fallbackOnly,
        filterMeta: {
          usingCompiled: false,
          fallbackUsed: false,
          compiledCount: 0,
          isEmpty: fallbackOnly.length === 0,
        },
      }
    }

    let fallbackUsed = false
    const translated = results.filter((r) => {
      const row = r as unknown as Record<string, unknown>
      const hasAllMetrics = compiled.every((criterion) => hasMetricForCompiledCriterion(row, criterion))
      if (hasAllMetrics) {
        return evaluateCompiledCriteria(row, compiled)
      }
      fallbackUsed = true
      return matchesAgentFilter(r, filter)
    })

    return {
      filtered: translated,
      filterMeta: {
        usingCompiled: true,
        fallbackUsed,
        compiledCount: compiled.length,
        isEmpty: translated.length === 0,
      },
    }
  }, [filter, results])

  const activeSignalLabelFilter = useMemo(() => (filter === 'all' ? null : filter), [filter])

  const getSortValue = (r: ScanResult, col: string): number | string => {
    const ot = opus45ByTicker[r.ticker]
    switch (col) {
      case 'ticker':
        return r.ticker
      case 'score':
        return r.enhancedScore ?? r.score ?? -1
      case 'opus45':
        return opus45ByTicker[r.ticker]?.opus45Confidence ?? -1
      case 'pattern':
        return r.pattern ?? 'None'
      case 'openTrade':
        return ot?.daysSinceBuy ?? -Infinity
      case 'signalAgent':
        return resolveSignalAgentLabel(
          getEffectiveSignalSetups(r.signalSetupsRecent, r.signalSetups),
          activeSignalLabelFilter,
        )
      case 'pl':
        return ot?.pctChange ?? -Infinity
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
      case 'lance':
        return lanceGradeSortValue(r.lancePreTrade?.score ?? null)
      default:
        return ''
    }
  }

  const watchlistFiltered = watchlistOnly
    ? filtered.filter((row) => watchlistTickers.has(row.ticker))
    : filtered

  const topRsFiltered = topRsOnly
    ? watchlistFiltered.filter((row) => topRsTickerSet.has(row.ticker))
    : watchlistFiltered

  const sorted = useMemo(() => {
    return [...topRsFiltered].sort((a, b) => {
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
  }, [
    activeSignalLabelFilter,
    fundamentals,
    industryTrendMap,
    industryTrendMap6M,
    industryTrendMap1Y,
    industryTrendMapYtd,
    opus45ByTicker,
    sortColumn,
    sortDir,
    topRsFiltered,
  ])

  useEffect(() => {
    setVisibleChartCount(getInitialChartCount(sorted.length, CHART_BATCH_SIZE))
  }, [sorted.length, viewMode])

  const handleSort = useCallback((col: string) => {
    const next = getNextSortState({ sortColumn, sortDir }, col)
    setSortColumn(next.sortColumn)
    setSortDir(next.sortDir)
  }, [sortColumn, sortDir])

  const sortHeaderProps = { sortColumn, sortDir, onSort: handleSort }

  const handleSaveCriteria = async () => {
    if (!editCriteriaAgent) return
    const cleaned = editCriteriaDraft.map((c) => c.trim()).filter(Boolean)
    saveCriteriaOverrides(editCriteriaAgent, cleaned)

    try {
      const res = await fetch(`${API_BASE}/api/agents/criteria/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: editCriteriaAgent, criteria: cleaned }),
      })

      if (!res.ok) throw new Error(`API ${res.status}`)
      const data = await res.json() as { compiledCriteria?: unknown[]; unsupported?: string[] }
      const compiledCriteria = Array.isArray(data.compiledCriteria)
        ? data.compiledCriteria.filter(isCompiledCriterion)
        : []
      saveCompiledCriteriaOverrides(editCriteriaAgent, compiledCriteria)

      if (Array.isArray(data.unsupported) && data.unsupported.length > 0) {
        alert(`Some criteria could not be translated and were ignored:\n\n- ${data.unsupported.join('\n- ')}`)
      }
    } catch {
      // Keep natural-language text even when translation fails.
      saveCompiledCriteriaOverrides(editCriteriaAgent, [])
    }

    setEditCriteriaAgent(null)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-slate-400">Loading scan results…</div>
      </div>
    )
  }

  return (
    <div className="w-full">
      <div className="space-y-8">
      <Suspense fallback={<div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-sm text-slate-500">Loading market regime cards…</div>}>
        <LazyMarketIndexRegimeCards />
      </Suspense>

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
                Progress:{' '}
                {scanState.progress.total > 0
                  ? `${scanState.progress.index}/${scanState.progress.total} tickers`
                  : `${scanState.progress.index} tickers saved (universe size updates after the first batch)`}
                {' · '}
                {scanState.progress.vcpBullishCount} VCP bullish
                {' · '}
                You can navigate away, the scan will continue
              </p>
              {scanState.progressSource === 'database' && (
                <p className="text-sky-300/90 text-xs mt-2">
                  Progress is read from Supabase (works across Vercel instances). To double-check: Vercel → your project → Logs (filter <code className="bg-slate-800 px-1 rounded">/api/scan</code>), or Supabase → Table Editor → <code className="bg-slate-800 px-1 rounded">scan_results</code> row count for the latest run.
                </p>
              )}
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-sky-400">
                {scanState.progress.total > 0
                  ? `${Math.round((scanState.progress.index / scanState.progress.total) * 100)}%`
                  : '…'}
              </div>
            </div>
          </div>
          <div className="mt-3 h-2 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-sky-500 transition-all duration-300"
              style={{
                width:
                  scanState.progress.total > 0
                    ? `${(scanState.progress.index / scanState.progress.total) * 100}%`
                    : '0%',
              }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-start gap-4 text-[12px] leading-snug">
        <div className="flex flex-wrap gap-2">
          <span className="text-slate-400 mr-2">Signal Agents:</span>
          {([
            { id: 'all', label: 'All' },
            { id: 'unusual_vol', label: 'Unusual Vol.' },
            { id: 'momentum_scout', label: 'Momentum' },
            { id: 'base_hunter', label: 'Base' },
            { id: 'breakout_tracker', label: 'Breakout' },
            { id: 'turtle_trader', label: 'Turtle' },
            { id: 'lance', label: 'Lance' },
          ] as const).map((f) => {
            const meta = f.id !== 'all' ? SIGNAL_AGENT_CRITERIA[f.id] : null
            return (
              <div key={f.id} className="group/agent flex flex-col items-center">
                <button
                  onClick={() => {
                    setFilter(f.id)
                    const next = getDefaultSortForFilter(f.id)
                    setSortColumn(next.sortColumn)
                    setSortDir(next.sortDir)
                  }}
                  className={`px-3 py-1.5 rounded-lg font-medium ${
                    filter === f.id
                      ? 'bg-sky-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {f.label}
                </button>
                {/* Edit link: under button, visible on hover, only for real agents (not All) */}
                {meta && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      setEditCriteriaAgent(f.id)
                      setEditCriteriaDraft(getCriteriaForAgent(f.id))
                    }}
                    className="opacity-0 group-hover/agent:opacity-100 transition-opacity text-sky-400 hover:text-sky-300 text-[10px] font-medium mt-0.5"
                    title={`Edit criteria: ${meta.label}`}
                  >
                    Edit
                  </button>
                )}
              </div>
            )
          })}
        </div>
        <div className="flex items-center gap-2 border-l border-slate-700 pl-4">
          <span className="text-slate-400">Watchlist:</span>
          <button
            type="button"
            onClick={() => setWatchlistOnly((prev) => !prev)}
            className={`px-3 py-1.5 rounded-lg font-medium ${
              watchlistOnly
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
            title="Show only watchlist names within the current Signal Agent filter"
          >
            {watchlistOnly ? '★ Watchlist' : '☆ Watchlist'}
          </button>
        </div>
        <div className="flex items-center gap-2 border-l border-slate-700 pl-4">
          <span className="text-slate-400">IBD-style:</span>
          <button
            type="button"
            onClick={() => setTopRsOnly((prev) => !prev)}
            className={`px-3 py-1.5 rounded-lg font-medium ${
              topRsOnly
                ? 'bg-fuchsia-500/20 text-fuchsia-200 border border-fuchsia-500/40'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
            title="Show only the Top 50 ranked by RS + Industry Rank"
          >
            {topRsOnly ? 'Top 50 RS+Ind On' : 'Top 50 RS+Ind'}
          </button>
        </div>
        <div className="flex items-center gap-2 border-l border-slate-700 pl-4">
          <span className="text-slate-400">View:</span>
          <button
            onClick={() => setViewMode('table')}
            className={`px-3 py-1.5 rounded-lg font-medium ${
              viewMode === 'table'
                ? 'bg-sky-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Table
          </button>
          <button
            onClick={() => setViewMode('charts')}
            className={`px-3 py-1.5 rounded-lg font-medium ${
              viewMode === 'charts'
                ? 'bg-sky-600 text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Charts
          </button>
        </div>
        <button
          onClick={runScan}
          disabled={scanState.running}
          className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-medium ml-auto"
        >
          {scanState.running
            ? scanState.progress.total > 0
              ? `Scanning ${scanState.progress.index}/${scanState.progress.total}…`
              : `Scanning (${scanState.progress.index} saved)…`
            : 'Run Scan'}
        </button>
      </div>

      {filter !== 'all' && filterMeta.usingCompiled && (
        <div
          className={`rounded-lg border px-3 py-2 text-xs ${
            filterMeta.fallbackUsed
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
              : 'border-sky-500/40 bg-sky-500/10 text-sky-200'
          }`}
        >
          {filterMeta.fallbackUsed
            ? `Custom criteria active (${filterMeta.compiledCount} rules). Some rows are missing required fields, so fallback label matching is used for those rows.`
            : `Custom criteria active (${filterMeta.compiledCount} rules). Results are filtered using translated search criteria.`}
          {filterMeta.isEmpty ? ' No rows match the current criteria.' : ''}
        </div>
      )}

      {viewMode === 'charts' ? (
        sorted.length === 0 ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-8 text-center text-slate-500">
            No results. Run <code className="bg-slate-800 px-1 rounded">npm run populate-tickers 500</code> then click Run scan.
          </div>
        ) : (
        <>
        <Suspense fallback={<div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 text-sm text-slate-500">Loading chart components…</div>}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {sorted.slice(0, visibleChartCount).map((r) => (
              <LazyTickerChart
                key={r.ticker}
                ticker={r.ticker}
                score={r.score}
                recommendation={r.recommendation}
              />
            ))}
          </div>
        </Suspense>
        {visibleChartCount < sorted.length && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setVisibleChartCount((prev) => getNextChartCount(prev, sorted.length, CHART_BATCH_SIZE))}
              className="px-4 py-2 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 text-sm font-medium"
            >
              Load {Math.min(CHART_BATCH_SIZE, sorted.length - visibleChartCount)} more charts
            </button>
          </div>
        )}
        </>
        )
      ) : (
      <>
      <div className="rounded-xl border border-slate-800 overflow-x-auto">
        <table className="w-full min-w-[2000px] table-fixed">
            <colgroup>
              <col className="w-40" />
              <col className="w-28" />
              <col className="w-16" />
              <col className="w-20" />
              <col className="w-36" />
              <col className="w-24" />
              <col className="w-20" />
              <col className="w-20" />
              <col className="w-40" />
              <col className="w-28" />
              <col className="w-28" />
              <col className="w-16" />
              <col className="w-16" />
              <col className="w-16" />
              <col className="w-32" />
              <col className="w-28" />
              <col className="w-28" />
              <col className="w-28" />
              <col className="w-28" />
              <col className="w-40" />
              <col className="w-32" />
              <col className="w-32" />
            </colgroup>
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900">
                <SortHeader col="ticker" label="Ticker" {...sortHeaderProps} sticky stickyLeft="0" />
                <SortHeader col="opus45" label="Opus" {...sortHeaderProps} alignRight sticky stickyLeft="10rem" />
                <SortHeader col="relativeStrength" label="RS" {...sortHeaderProps} alignRight />
                <SortHeader col="industryRank" label="Ind.Rank" {...sortHeaderProps} alignRight />
                <SortHeader col="signalAgent" label="Signal Agent" {...sortHeaderProps} />
                <SortHeader col="lance" label="Lance" {...sortHeaderProps} alignRight />
                <SortHeader col="pl" label="P/L" {...sortHeaderProps} alignRight />
                <SortHeader col="close" label="Price" {...sortHeaderProps} alignRight />
                <SortHeader col="openTrade" label="Open Trade" {...sortHeaderProps} alignRight />
                <SortHeader col="pattern" label="Setup" {...sortHeaderProps} />
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
              {sorted.length === 0 ? (
                <tr>
                    <td colSpan={22} className="px-4 py-8 text-center text-slate-500">
                    {watchlistOnly
                      ? topRsOnly
                        ? 'No watchlist stocks currently qualify for Top 50 RS+Ind in this Signal Agent filter.'
                        : 'No watchlist matches for this Signal Agent filter.'
                      : topRsOnly
                        ? 'No stocks qualify for Top 50 RS+Ind in the current filter. Try All + Run Scan.'
                      : <>No results. Run <code className="bg-slate-800 px-1 rounded">npm run populate-tickers 500</code> then click Run scan.</>}
                  </td>
                </tr>
              ) : (
                sorted.map((r) => (
                  <tr key={r.ticker} className="group border-b border-slate-800/80 hover:bg-slate-800/40">
                    <td className="sticky left-0 z-10 min-w-[10rem] bg-slate-900/95 backdrop-blur-sm shadow-[2px_0_4px_-1px_rgba(0,0,0,0.3)] group-hover:bg-slate-800/40 px-4 py-3">
                      <div className="flex w-full items-center gap-2">
                        <div className="flex items-center gap-1">
                          <Link to={`/stock/${r.ticker}`} state={{ scanResult: r }} className="text-sky-400 hover:text-sky-300 font-medium text-sm" target="_blank" rel="noopener noreferrer">
                            {r.ticker}
                          </Link>
                          {watchlistTickers.has(r.ticker) && (
                            <span
                              className="text-amber-300 text-xs"
                              title={watchlistMap[r.ticker]?.note || 'In watchlist'}
                              aria-label="In watchlist"
                            >
                              ★
                            </span>
                          )}
                        </div>
                      </div>
                      {(fundamentals[r.ticker]?.companyName ?? fundamentals[r.ticker]?.industry) && (
                        <div className="text-slate-400 mt-1 truncate text-sm">
                          {fundamentals[r.ticker].companyName ?? fundamentals[r.ticker].industry}
                        </div>
                      )}
                      {watchlistMap[r.ticker]?.note && (
                        <div className="text-amber-300/90 mt-0.5 truncate text-sm" title={watchlistMap[r.ticker].note}>
                          Note: {watchlistMap[r.ticker].note}
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
                          <div className="text-slate-500 mt-0.5 truncate text-sm">
                            {parts.join(' · ')}
                          </div>
                        )
                      })()}
                    </td>
                    {/* Opus: primary strength with card-style green/yellow color coding */}
                    <td className="sticky left-[10rem] z-10 min-w-[7rem] align-top bg-slate-900/95 backdrop-blur-sm shadow-[2px_0_4px_-1px_rgba(0,0,0,0.3)] group-hover:bg-slate-800/40 px-4 py-3 font-mono tabular-nums text-right">
                      {opus45ByTicker[r.ticker] ? (
                        (() => {
                          const o = opus45ByTicker[r.ticker]
                          const display = getOpusDisplayState(o)
                          if (!display.hasActiveSetup) {
                            return <span className="text-slate-500">–</span>
                          }
                          const conf = display.confidence
                          const grade = display.grade
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
                              className={`inline-block whitespace-nowrap px-2 py-0.5 rounded text-sm font-medium ${badgeClass}`}
                              title="Opus4.5 setup strength (shows ranked setup score even when no active open trade)"
                            >
                              {display.label}
                            </span>
                          )
                        })()
                      ) : (
                        <span className="text-slate-500">–</span>
                      )}
                    </td>
                    {/* RS Rating (IBD-style 1–99) */}
                    <td className="px-4 py-3 font-mono tabular-nums text-right text-sm">
                      {r.relativeStrength != null ? (
                        <span className={`font-medium ${
                          r.relativeStrength >= 90 ? 'text-emerald-400' :
                          r.relativeStrength >= 80 ? 'text-green-400' :
                          r.relativeStrength >= 70 ? 'text-slate-300' :
                          'text-red-400'
                        }`}>
                          {Math.round(r.relativeStrength)}
                        </span>
                      ) : '–'}
                    </td>
                    {/* Industry Rank */}
                    <td className="px-4 py-3 font-mono tabular-nums text-right text-sm">
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
                    {/* Signal Agent */}
                    <td className="px-4 py-3 text-sm">
                      <span className={getEffectiveSignalSetups(r.signalSetupsRecent, r.signalSetups).length ? 'text-slate-200' : 'text-slate-500'}>
                        {resolveSignalAgentLabel(
                          getEffectiveSignalSetups(r.signalSetupsRecent, r.signalSetups),
                          activeSignalLabelFilter,
                        )}
                      </span>
                    </td>
                    {/* Lance pre-trade grade (A+–D from scan) */}
                    <td className="px-4 py-3 text-right text-sm font-mono tabular-nums">
                      {(() => {
                        const lp = r.lancePreTrade
                        if (!lp || lp.insufficientData) {
                          return <span className="text-slate-500">–</span>
                        }
                        const g = lp.score
                        if (!g) return <span className="text-slate-500">–</span>
                        const cls =
                          g === 'A+'
                            ? 'text-emerald-400 font-semibold'
                            : g === 'A'
                              ? 'text-green-400 font-medium'
                              : g === 'B'
                                ? 'text-amber-200'
                                : g === 'C'
                                  ? 'text-orange-400'
                                  : 'text-red-400'
                        const title = [
                          `Time: ${lp.timeBehavior}`,
                          `ROC: ${lp.rateOfChange}`,
                          `RS: ${lp.relativeStrength}`,
                          `Loc: ${lp.location}`,
                          lp.sizeHint ? `Size: ${lp.sizeHint}` : '',
                        ]
                          .filter(Boolean)
                          .join('\n')
                        return (
                          <span className={cls} title={title}>
                            {g}
                          </span>
                        )
                      })()}
                    </td>
                    {/* Current P/L */}
                    <td className="px-4 py-3 font-mono text-right text-sm">
                      {(() => {
                        const ot = opus45ByTicker[r.ticker];
                        const pl = formatSignalPL(ot?.pctChange);
                        const toneClass =
                          pl.tone === 'positive'
                            ? 'text-emerald-400'
                            : pl.tone === 'negative'
                              ? 'text-red-400'
                              : 'text-slate-500';
                        return <span className={toneClass}>{pl.text}</span>;
                      })()}
                    </td>
                    <td className="px-4 py-3 text-slate-300 font-mono tabular-nums text-right">{r.lastClose != null ? `$${r.lastClose.toFixed(2)}` : '–'}</td>
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
                          {ot.isNewBuyToday && (
                            <span className="ml-2 inline-flex items-center rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                              NEW
                            </span>
                          )}
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

      {/* Signal Agent criteria modal (editable) */}
      {editCriteriaAgent && SIGNAL_AGENT_CRITERIA[editCriteriaAgent as keyof typeof SIGNAL_AGENT_CRITERIA] && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setEditCriteriaAgent(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="criteria-modal-title"
        >
          <div
            className="bg-slate-900 rounded-xl border border-slate-700 max-w-lg w-full shadow-xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center px-6 py-4 border-b border-slate-700 shrink-0">
              <h2 id="criteria-modal-title" className="text-lg font-semibold text-slate-100">
                {SIGNAL_AGENT_CRITERIA[editCriteriaAgent as keyof typeof SIGNAL_AGENT_CRITERIA].label} — Signal Criteria
              </h2>
              <button
                type="button"
                onClick={() => setEditCriteriaAgent(null)}
                className="text-slate-400 hover:text-slate-200 text-xl leading-none p-1"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="px-6 py-4 overflow-y-auto flex-1">
              <div className="space-y-2 text-sm">
                {editCriteriaDraft.map((c, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input
                      type="text"
                      value={c}
                      onChange={(e) => {
                        const next = [...editCriteriaDraft]
                        next[i] = e.target.value
                        setEditCriteriaDraft(next)
                      }}
                      className="flex-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
                      placeholder="Criterion"
                    />
                    <button
                      type="button"
                      onClick={() => setEditCriteriaDraft(editCriteriaDraft.filter((_, j) => j !== i))}
                      className="text-slate-400 hover:text-red-400 shrink-0 p-1"
                      aria-label="Remove criterion"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setEditCriteriaDraft([...editCriteriaDraft, ''])}
                className="mt-3 text-sky-400 hover:text-sky-300 text-sm font-medium"
              >
                + Add criterion
              </button>
            </div>
            <div className="px-6 py-4 border-t border-slate-700 flex gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  const defaults = SIGNAL_AGENT_CRITERIA[editCriteriaAgent as keyof typeof SIGNAL_AGENT_CRITERIA].criteria
                  setEditCriteriaDraft([...defaults])
                }}
                className="px-3 py-2 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 text-sm font-medium"
              >
                Reset to default
              </button>
              <button
                type="button"
                onClick={handleSaveCriteria}
                className="px-4 py-2 rounded-lg bg-sky-600 text-white hover:bg-sky-500 text-sm font-medium"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
