import { useEffect, useState, useRef, useMemo } from 'react'
import { useParams, useLocation, Link, useNavigate } from 'react-router-dom'
import { createChart, ColorType } from 'lightweight-charts'
import { sma, rsi, findPullbacks, vcpContraction, findIdealPullbackBarTimes, findVolumePriceBreakouts, calculateRelativeStrength } from '../utils/chartIndicators'
import { Opus45Marker } from '../utils/opus45Indicators'
import { AGENT_CHART_LIST, AGENT_CHART_ORDER, AgentSignalHistoryResponse, AgentType, toAgentChartMarkers } from '../utils/agentSignalMarkers'
import { API_BASE } from '../utils/api'
import TradingViewWidget from '../components/TradingViewWidget'
// Trade Journal panel for logging entries and exits
import TradePanel from '../components/TradePanel'

interface Bar {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

interface ScoreCriterion {
  criterion: string
  matched: boolean
  points: number
  detail?: string
}

interface VCPInfo {
  ticker: string
  vcpBullish: boolean
  reason?: string
  error?: string
  contractions: number
  atMa10: boolean
  atMa20: boolean
  atMa50: boolean
  lastClose?: number
  sma10?: number
  sma20?: number
  sma50?: number
  pullbackPcts?: string[]
  volumeDryUp?: boolean
  volumeRatio?: number | null
  idealPullbackSetup?: boolean
  idealPullbackBarTimes?: number[]
  barCount?: number
  score?: number
  enhancedScore?: number
  recommendation?: 'buy' | 'hold' | 'avoid'
  scoreBreakdown?: ScoreCriterion[]
}

/** API response for historical Opus4.5 signals */
interface Opus45HistoryResponse {
  ticker: string
  buySignals: Opus45Marker[]
  sellSignals: Opus45Marker[]
  currentStatus: 'no_position' | 'in_position'
  lastBuySignal: Opus45Marker | null
  lastSellSignal: Opus45Marker | null
  completedTrades: {
    entryDate: string
    entryPrice: number
    exitDate: string
    exitPrice: number
    returnPct: number
    daysInTrade: number
    profitDollars: number
  }[]
  holdingPeriod: number | null
  isActionableBuy?: boolean  // true only if buy signal triggered in last 2 days
  weightsVersion?: string
  reason?: string
}

const TIMEFRAMES = [
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '12M', days: 365 },
] as const

const INTERVALS = [
  { label: 'Daily', value: '1d' },
  { label: 'Weekly', value: '1wk' },
  { label: 'Monthly', value: '1mo' },
] as const

/** Derive score breakdown from vcp when API doesn't return it (e.g. cached response) */
function getScoreBreakdown(vcp: VCPInfo | null): ScoreCriterion[] {
  if (!vcp) return []
  const b: ScoreCriterion[] = []
  if (vcp.reason === 'not_enough_bars') {
    b.push({ criterion: 'Not enough bars (need 60+)', matched: false, points: 0 })
    return b
  }
  if (vcp.reason === 'below_50_ma') {
    b.push({ criterion: 'Price above 50 SMA (Stage 2)', matched: false, points: 0 })
    return b
  }
  b.push({ criterion: 'VCP Bullish (contractions + at MA)', matched: vcp.vcpBullish, points: vcp.vcpBullish ? 50 : 0 })
  if (!vcp.vcpBullish) b.push({ criterion: 'Partial setup (above 50 MA, no full VCP)', matched: true, points: 20 })
  const c = vcp.contractions || 0
  const cPts = Math.min(c * 8, 25)
  b.push({ criterion: 'Contractions (each pullback smaller than previous)', matched: c > 0, points: cPts, detail: `${c} contractions` })
  b.push({ criterion: 'Price at 10 MA (within 2%)', matched: vcp.atMa10, points: vcp.atMa10 ? 5 : 0 })
  b.push({ criterion: 'Price at 20 MA (within 2%)', matched: vcp.atMa20, points: vcp.atMa20 ? 5 : 0 })
  b.push({ criterion: 'Price at 50 MA (within 2%)', matched: vcp.atMa50, points: vcp.atMa50 ? 5 : 0 })
  const above50 = vcp.lastClose != null && vcp.sma50 != null && vcp.lastClose >= vcp.sma50
  b.push({ criterion: 'Price above 50 SMA', matched: above50, points: above50 ? 10 : 0 })
  b.push({ criterion: 'Volume drying up on pullbacks (<85% of 20d avg)', matched: !!vcp.volumeDryUp, points: vcp.volumeDryUp ? 10 : 0 })
  b.push({ criterion: 'Ideal setup: 5-10d pullback, vol high at last high, vol push from higher low', matched: !!vcp.idealPullbackSetup, points: vcp.idealPullbackSetup ? 15 : 0 })
  return b
}

const CHART_OPTIONS = {
  layout: { background: { type: ColorType.Solid, color: '#0f172a' }, textColor: '#94a3b8' },
  grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
  timeScale: { timeVisible: true, secondsVisible: false },
  rightPriceScale: { borderColor: '#334155' },
}

export default function StockDetail() {
  const { ticker } = useParams<{ ticker: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const scanResult = (location.state as { scanResult?: VCPInfo } | null)?.scanResult
  const [bars, setBars] = useState<Bar[]>([])
  const [spxBars, setSpxBars] = useState<Bar[]>([]) // S&P 500 bars for RS calculation
  const [industryBars, setIndustryBars] = useState<Bar[]>([]) // Industry index bars for RS vs industry (12 months)
  const [vcp, setVcp] = useState<VCPInfo | null>(null)
  /** When VCP API returns 0/not enough bars, we fetch latest scan and use this ticker's result so profile shows enhanced score (e.g. FCX, LHX). */
  const [scanFallback, setScanFallback] = useState<VCPInfo | null>(null)
  const [companyName, setCompanyName] = useState<string | null>(null)
  const [, setExchange] = useState<string | null>(null)
  const [fundamentals, setFundamentals] = useState<{ profitMargin?: number | null; operatingMargin?: number | null; industry?: string | null } | null>(null)
  const [industry3M, setIndustry3M] = useState<number | null>(null)
  const [industry1Y, setIndustry1Y] = useState<number | null>(null)
  const [industryYtd, setIndustryYtd] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [timeframe, setTimeframe] = useState<(typeof TIMEFRAMES)[number]>(TIMEFRAMES[1])
  const [interval, setInterval] = useState<(typeof INTERVALS)[number]['value']>('1d')
  // Toggle Signal Agent buy markers on chart - persists to localStorage
  const [agentVisibility, setAgentVisibility] = useState<Record<AgentType, boolean>>(() => {
    return AGENT_CHART_ORDER.reduce((acc, agentType) => {
      const saved = localStorage.getItem(`showAgentSignal_${agentType}`)
      acc[agentType] = saved !== null ? saved === 'true' : true
      return acc
    }, {} as Record<AgentType, boolean>)
  })
  // Toggle Relative Strength to Industry line - persists to localStorage, default hidden until checked
  // Opus4.5 Buy Signal Rules accordion: closed by default so "Why this score?" stays prominent
  const [opus45RulesOpen, setOpus45RulesOpen] = useState(false)
  const [showRsIndustry, setShowRsIndustry] = useState(() => {
    const saved = localStorage.getItem('showRsIndustry')
    return saved === 'true'
  })
  const chartWrapperRef = useRef<HTMLDivElement>(null)
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const rsiChartRef = useRef<HTMLDivElement>(null)
  const vcpChartRef = useRef<HTMLDivElement>(null)
  const rsChartRef = useRef<HTMLDivElement>(null) // RS chart reference
  const chartInstance = useRef<ReturnType<typeof createChart> | null>(null)
  const rsiChartInstance = useRef<ReturnType<typeof createChart> | null>(null)
  const vcpChartInstance = useRef<ReturnType<typeof createChart> | null>(null)
  const rsChartInstance = useRef<ReturnType<typeof createChart> | null>(null) // RS chart instance
  
  // Opus4.5 signals from server API (single source of truth)
  const [opus45History, setOpus45History] = useState<Opus45HistoryResponse | null>(null)

  // Signal Agent overlays from server API (per-agent buy signals)
  const [agentSignalHistory, setAgentSignalHistory] = useState<AgentSignalHistoryResponse | null>(null)
  
  // Scan results for horizontal ticker navigation bar
  const [scanTickers, setScanTickers] = useState<Array<{ ticker: string; score?: number; hasActionableBuy?: boolean }>>([])
  const tickerBarRef = useRef<HTMLDivElement>(null)
  // Increment to re-run bars fetch (e.g. after "Retry" when chart data failed to load)
  const [barsRetryKey, setBarsRetryKey] = useState(0)

  // Fetch scan results for ticker navigation bar (once on mount)
  // Syncs with Dashboard: sorted by score desc, green highlight for actionable buy signals
  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/api/scan-results`).then(r => r.json()),
      fetch(`${API_BASE}/api/opus45/signals`).then(r => r.json())
    ])
      .then(([scanData, opusData]) => {
        const results = scanData.results || []
        // signals array contains only actionable buys (triggered within 2 days)
        const actionableBuys = new Set(
          (opusData.signals || []).map((s: { ticker: string }) => s.ticker)
        )
        // Combine scan results with actionable buy status, sort by score desc (matching Dashboard)
        const tickers = results
          .map((r: { ticker: string; enhancedScore?: number; score?: number }) => ({
            ticker: r.ticker,
            score: r.enhancedScore ?? r.score ?? 0,
            hasActionableBuy: actionableBuys.has(r.ticker)
          }))
          .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
        setScanTickers(tickers)
      })
      .catch(() => setScanTickers([]))
  }, [])

  // Scroll current ticker into view in the ticker bar
  useEffect(() => {
    if (ticker && tickerBarRef.current) {
      const currentEl = tickerBarRef.current.querySelector(`[data-ticker="${ticker}"]`)
      if (currentEl) {
        currentEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
      }
    }
  }, [ticker, scanTickers])

  // Keyboard navigation: Left/Right arrow keys to navigate between tickers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input field
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }
      
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (!ticker || scanTickers.length === 0) return
        
        const currentIndex = scanTickers.findIndex(t => t.ticker === ticker)
        if (currentIndex === -1) return
        
        let newIndex: number
        if (e.key === 'ArrowLeft') {
          // Go to previous ticker (wrap to end if at start)
          newIndex = currentIndex > 0 ? currentIndex - 1 : scanTickers.length - 1
        } else {
          // Go to next ticker (wrap to start if at end)
          newIndex = currentIndex < scanTickers.length - 1 ? currentIndex + 1 : 0
        }
        
        const newTicker = scanTickers[newIndex].ticker
        navigate(`/stock/${newTicker}`)
        e.preventDefault()
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [ticker, scanTickers, navigate])

  // Persist Signal Agent visibility preferences to localStorage
  useEffect(() => {
    AGENT_CHART_ORDER.forEach((agentType) => {
      localStorage.setItem(`showAgentSignal_${agentType}`, String(agentVisibility[agentType]))
    })
  }, [agentVisibility])
  // Persist Relative Strength to Industry visibility to localStorage
  useEffect(() => {
    localStorage.setItem('showRsIndustry', String(showRsIndustry))
  }, [showRsIndustry])

  // Fetch bars and VCP separately so a VCP failure doesn't block chart update (fixes daily/weekly showing same)
  // ALWAYS fetch 12 months of data so all timeframes have full bar history
  useEffect(() => {
    if (!ticker) return
    setLoading(true)
    // Always fetch 365 days regardless of timeframe selection (timeframe only controls chart zoom)
    const barsUrl = `${API_BASE}/api/bars/${ticker}?days=365&interval=${interval}`
    const spxUrl = `${API_BASE}/api/spx/bars?days=365&interval=${interval}` // Fetch SPX bars too
    // cache: 'no-store' prevents browser from returning cached daily when switching to weekly
    Promise.all([
      fetch(barsUrl, { cache: 'no-store' }).then((r) => r.json()),
      fetch(spxUrl, { cache: 'no-store' }).then((r) => r.json()),
    ])
      .then(([barsRes, spxRes]) => {
        if (barsRes.error) throw new Error(barsRes.error)
        const raw = barsRes.results || []
        setBars([...raw].sort((a: Bar, b: Bar) => a.t - b.t))
        
        // Set SPX bars (ignore errors - RS chart is optional)
        if (!spxRes.error && spxRes.results) {
          setSpxBars([...spxRes.results].sort((a: Bar, b: Bar) => a.t - b.t))
        } else {
          setSpxBars([])
        }
      })
      .catch((e) => {
        console.error('Bars fetch failed:', e)
        setBars([])
        setSpxBars([])
      })
      .finally(() => setLoading(false))
    // VCP in parallel; failures are non-fatal (we keep scanResult or previous vcp)
    fetch(`${API_BASE}/api/vcp/${ticker}`)
      .then((r) => r.json())
      .then((vcpRes) => {
        const hasValidVcp = vcpRes && !vcpRes.error && (vcpRes.score != null || vcpRes.vcpBullish != null)
        setVcp(hasValidVcp ? vcpRes : (scanResult && !scanResult.error ? scanResult : vcpRes))
      })
      .catch(() => {})
    setScanFallback(null)
  }, [ticker, interval, barsRetryKey])

  // Fetch Opus4.5 historical signals from server API (single source of truth)
  useEffect(() => {
    if (!ticker) return
    setOpus45History(null)
    fetch(`${API_BASE}/api/opus45/signals/${ticker}/history`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((res) => {
        if (!res.error) {
          // Debug log to verify data
          if (ticker === 'STRL') {
            console.log('[STRL DEBUG] Frontend received:', {
              currentStatus: res.currentStatus,
              lastBuyDate: res.lastBuySignal ? new Date(res.lastBuySignal.time * 1000).toISOString() : null,
              lastBuyPrice: res.lastBuySignal?.price,
              holdingPeriod: res.holdingPeriod
            })
          }
          setOpus45History(res)
        }
      })
      .catch((e) => {
        console.error('Opus45 history fetch failed:', e)
      })
  }, [ticker])

  // Fetch Signal Agent overlays from server API (single source of truth)
  useEffect(() => {
    if (!ticker) return
    setAgentSignalHistory(null)
    fetch(`${API_BASE}/api/agents/signals/${ticker}/history`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((res) => {
        if (!res?.error) {
          setAgentSignalHistory(res)
        }
      })
      .catch((e) => {
        console.error('Agent signal history fetch failed:', e)
      })
  }, [ticker])

  // When VCP API returns 0 or "not enough bars" and we have no scanResult (e.g. direct URL), fetch latest scan and use this ticker's enhanced score
  useEffect(() => {
    if (!ticker) return
    const failed = vcp && (vcp.reason === 'not_enough_bars' || vcp.score === 0)
    if (!failed || scanResult) {
      if (!failed) setScanFallback(null)
      return
    }
    fetch(`${API_BASE}/api/scan-results`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { results?: VCPInfo[] }) => {
        const found = (data?.results ?? []).find((r) => (r.ticker || '').toUpperCase() === ticker.toUpperCase())
        setScanFallback(found && !found.error ? found : null)
      })
      .catch(() => setScanFallback(null))
  }, [ticker, vcp, scanResult])

  // Fetch company name and exchange (for TradingView symbol); failures are non-fatal
  useEffect(() => {
    if (!ticker) return
    fetch(`${API_BASE}/api/quote/${encodeURIComponent(ticker)}`)
      .then((r) => (r.ok ? r.json() : { name: null, exchange: null }))
      .then((data) => {
        setCompanyName(data?.name ?? null)
        setExchange(data?.exchange ?? null)
      })
      .catch(() => {
        setCompanyName(null)
        setExchange(null)
      })
  }, [ticker])

  // Fetch fundamentals (Profit Margin, Operating Margin, Industry) from cache
  useEffect(() => {
    if (!ticker) return
    fetch(`${API_BASE}/api/fundamentals/${encodeURIComponent(ticker)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.ticker) setFundamentals({ profitMargin: data.profitMargin ?? null, operatingMargin: data.operatingMargin ?? null, industry: data.industry ?? null })
        else setFundamentals(null)
      })
      .catch(() => setFundamentals(null))
  }, [ticker])

  // Fetch industry 3M and 1Y trend (lookup by industry from fundamentals)
  useEffect(() => {
    if (!fundamentals?.industry) {
      setIndustry3M(null)
      setIndustry1Y(null)
      setIndustryYtd(null)
      return
    }
    fetch(`${API_BASE}/api/industry-trend`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        const g = (d?.industries ?? []).find((x: { industry: string }) => x.industry === fundamentals?.industry)
        let trend3m = g?.industryAvg3Mo
        let trend1y = g?.industryAvg1Y
        let trendYtd = g?.industryYtd
        if (trend3m == null && g?.tickers?.length) {
          const withChange = (g.tickers as { change3mo?: number | null }[]).filter((t) => t.change3mo != null)
          if (withChange.length) trend3m = withChange.reduce((s, t) => s + (t.change3mo ?? 0), 0) / withChange.length
        }
        if (trend1y == null && g?.tickers?.length) {
          const withChange = (g.tickers as { change1y?: number | null }[]).filter((t) => t.change1y != null)
          if (withChange.length) trend1y = withChange.reduce((s, t) => s + (t.change1y ?? 0), 0) / withChange.length
        }
        if (trendYtd == null && g?.tickers?.length) {
          const withChange = (g.tickers as { ytd?: number | null }[]).filter((t) => t.ytd != null)
          if (withChange.length) trendYtd = withChange.reduce((s, t) => s + (t.ytd ?? 0), 0) / withChange.length
        }
        setIndustry3M(trend3m != null ? trend3m : null)
        setIndustry1Y(trend1y != null ? trend1y : null)
        setIndustryYtd(trendYtd != null ? trendYtd : null)
      })
      .catch(() => {
        setIndustry3M(null)
        setIndustry1Y(null)
        setIndustryYtd(null)
      })
  }, [fundamentals?.industry])

  // Fetch 12 months of industry index bars when we have an industry (for RS vs industry line)
  useEffect(() => {
    if (!fundamentals?.industry?.trim()) {
      setIndustryBars([])
      return
    }
    const params = new URLSearchParams({
      industry: fundamentals.industry.trim(),
      days: '365',
      interval,
    })
    fetch(`${API_BASE}/api/industry-bars?${params}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (data?.results && Array.isArray(data.results)) {
          setIndustryBars([...data.results].sort((a: Bar, b: Bar) => a.t - b.t))
        } else {
          setIndustryBars([])
        }
      })
      .catch(() => setIndustryBars([]))
  }, [fundamentals?.industry, interval])

  const { candleData, ma10Data, ma20Data, ma50Data, ma150Data, volumeData, ma20VolumeData, rsiData, vcpContractionData, rsData, rsIndustryData, pullbacks, idealPullbackBarTimes, volumePriceBreakoutTimes } = useMemo(() => {
    const empty = { candleData: [], ma10Data: [], ma20Data: [], ma50Data: [], ma150Data: [], volumeData: [], ma20VolumeData: [], rsiData: [], vcpContractionData: [], rsData: [], rsIndustryData: [], pullbacks: [], idealPullbackBarTimes: [], volumePriceBreakoutTimes: [] }
    if (bars.length === 0) return empty
    try {
      // lightweight-charts requires data asc by time; Yahoo can return unsorted bars
      const sorted = [...bars].sort((a, b) => a.t - b.t)
      const closes = sorted.map((b) => Number(b.c) || 0)
      const volumes = sorted.map((b) => Number(b.v) || 0)
      const sma10 = sma(closes, 10)
      const sma20 = sma(closes, 20)
      const sma50 = sma(closes, 50)
      const sma150 = sma(closes, 150)
      const sma20Vol = sma(volumes, 20)
      const rsi14 = rsi(closes, 14)
      const vcpContr = vcpContraction(sorted, 6)
      
      // Calculate RS line (stock vs S&P 500)
      const rsValues = spxBars.length > 0 ? calculateRelativeStrength(sorted, spxBars) : []
      // RS vs industry: same formula (stock/benchmark normalized to 1000); only when we have industry bars
      const rsIndustryValues = industryBars.length > 0 ? calculateRelativeStrength(sorted, industryBars) : []
      
      const toTime = (t: number) => Math.floor(t / 1000) as any
      const vcpPullbacks = findPullbacks(sorted, 80)
      return {
        candleData: sorted.map((b) => ({ time: toTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c })),
        ma10Data: sorted.map((b, i) => ({ time: toTime(b.t), value: sma10[i] })).filter((d) => d.value != null) as { time: string; value: number }[],
        volumeData: sorted.map((b) => ({
          time: toTime(b.t),
          value: b.v,
          color: b.c >= b.o ? '#22c55e' : '#ef4444',
        })),
        ma20VolumeData: sorted
          .map((b, i) => ({ time: toTime(b.t), value: sma20Vol[i] }))
          .filter((d) => d.value != null) as { time: string; value: number }[],
        ma20Data: sorted.map((b, i) => ({ time: toTime(b.t), value: sma20[i] })).filter((d) => d.value != null) as { time: string; value: number }[],
        ma50Data: sorted.map((b, i) => ({ time: toTime(b.t), value: sma50[i] })).filter((d) => d.value != null) as { time: string; value: number }[],
        ma150Data: sorted.map((b, i) => ({ time: toTime(b.t), value: sma150[i] })).filter((d) => d.value != null) as { time: string; value: number }[],
        rsiData: (() => {
          const filtered = sorted.map((b, i) => ({ time: toTime(b.t), value: rsi14[i] })).filter((d) => d.value != null) as { time: string; value: number }[]
          if (filtered.length === 0) return []
          const firstVal = filtered[0].value
          const padCount = sorted.length - filtered.length
          const pad = sorted.slice(0, padCount).map((b) => ({ time: toTime(b.t), value: firstVal }))
          return [...pad, ...filtered]
        })(),
        vcpContractionData: (() => {
          const filtered = sorted.map((b, i) => ({ time: toTime(b.t), value: vcpContr[i] })).filter((d) => d.value != null) as { time: string; value: number }[]
          if (filtered.length === 0) return []
          const firstVal = filtered[0].value
          const padCount = sorted.length - filtered.length
          const pad = sorted.slice(0, padCount).map((b) => ({ time: toTime(b.t), value: firstVal }))
          return [...pad, ...filtered]
        })(),
        rsData: (() => {
          const filtered = sorted.map((b, i) => ({ time: toTime(b.t), value: rsValues[i] })).filter((d) => d.value != null) as { time: string; value: number }[]
          if (filtered.length === 0) return []
          const firstVal = filtered[0].value
          const padCount = sorted.length - filtered.length
          const pad = sorted.slice(0, padCount).map((b) => ({ time: toTime(b.t), value: firstVal }))
          return [...pad, ...filtered]
        })(),
        rsIndustryData: (() => {
          const filtered = sorted.map((b, i) => ({ time: toTime(b.t), value: rsIndustryValues[i] })).filter((d) => d.value != null) as { time: string; value: number }[]
          if (filtered.length === 0) return []
          const firstVal = filtered[0].value
          const padCount = sorted.length - filtered.length
          const pad = sorted.slice(0, padCount).map((b) => ({ time: toTime(b.t), value: firstVal }))
          return [...pad, ...filtered]
        })(),
        pullbacks: vcpPullbacks.slice(-6),
        idealPullbackBarTimes: (() => {
          try {
            return findIdealPullbackBarTimes(sorted, 80)
          } catch {
            return []
          }
        })(),
        volumePriceBreakoutTimes: (() => {
          try {
            return findVolumePriceBreakouts(sorted)
          } catch {
            return []
          }
        })(),
        // Opus4.5 signals now fetched from server API (opus45History state)
      }
    } catch (e) {
      console.error('Chart indicators error:', e)
      return empty
    }
  }, [bars, spxBars, industryBars])

  useEffect(() => {
    if (!chartWrapperRef.current || !chartContainerRef.current || !rsiChartRef.current || !vcpChartRef.current || !rsChartRef.current || bars.length === 0) return
    if (chartInstance.current) {
      chartInstance.current.remove()
      chartInstance.current = null
    }
    if (rsiChartInstance.current) {
      rsiChartInstance.current.remove()
      rsiChartInstance.current = null
    }
    if (vcpChartInstance.current) {
      vcpChartInstance.current.remove()
      vcpChartInstance.current = null
    }
    if (rsChartInstance.current) {
      rsChartInstance.current.remove()
      rsChartInstance.current = null
    }

    const w = chartWrapperRef.current?.clientWidth ?? 0
    if (w <= 0) return

    // Left price scale so VCP high/low labels appear on the left (not right)
    const mainChart = createChart(chartContainerRef.current, {
      ...CHART_OPTIONS,
      width: w,
      height: 380,
      leftPriceScale: { visible: true, borderColor: '#334155', minimumWidth: 60 },
      rightPriceScale: { visible: false },
    })
    const rsiChart = createChart(rsiChartRef.current, {
      ...CHART_OPTIONS,
      width: w,
      height: 140,
      rightPriceScale: { borderColor: '#334155', minimumWidth: 60, scaleMargins: { top: 0.1, bottom: 0.1 } },
    })
    const vcpChart = createChart(vcpChartRef.current, {
      ...CHART_OPTIONS,
      width: w,
      height: 100,
      rightPriceScale: {
        borderColor: '#334155',
        minimumWidth: 60,
        scaleMargins: { top: 0.1, bottom: 0.1 },
        autoScale: true,
      },
    })
    const rsChart = createChart(rsChartRef.current, {
      ...CHART_OPTIONS,
      width: w,
      height: 120,
      rightPriceScale: {
        borderColor: '#334155',
        minimumWidth: 60,
        scaleMargins: { top: 0.1, bottom: 0.1 },
        autoScale: true,
      },
    })

    const sortByTime = <T extends { time: string | number }>(arr: T[]) =>
      [...arr].sort((a, b) => (a.time as number) - (b.time as number))
    // lightweight-charts requires asc + unique times; dedupe by keeping last per time
    const dedupeByTime = <T extends { time: string | number }>(arr: T[]) => {
      const sorted = sortByTime(arr)
      return sorted.reduce<T[]>((acc, d) => {
        const t = d.time as number
        if (acc.length === 0 || (acc[acc.length - 1].time as number) < t) acc.push(d)
        else if ((acc[acc.length - 1].time as number) === t) acc[acc.length - 1] = d
        return acc
      }, [])
    }
    const candle = mainChart.addCandlestickSeries({ upColor: '#22c55e', downColor: '#ef4444', borderVisible: false, priceScaleId: 'left' })
    const candleSorted = dedupeByTime(candleData)
    candle.setData(candleSorted)

    // Buy markers:
    // (1) Blue: Volume increase 4-10 days prior with price decrease, then price breaks above MA or high
    // (2) Yellow: Ideal pullback setup
    // (3) Signal Agents: Per-agent buy signals (colored circles)
    const toTimeSec = (t: number) => Math.floor(t / 1000) as any
    const blueMarkers = volumePriceBreakoutTimes
      .map(toTimeSec)
      .filter((t) => candleSorted.some((d) => d.time === t))
      .map((t) => ({ time: t as any, position: 'belowBar' as const, shape: 'arrowUp' as const, color: '#3b82f6' }))
    const yellowMarkers = idealPullbackBarTimes
      .map(toTimeSec)
      .filter((t) => candleSorted.some((d) => d.time === t))
      .map((t) => ({ time: t as any, position: 'belowBar' as const, shape: 'arrowUp' as const, color: '#facc15' }))

    // Signal Agent buy markers (per-agent, on-demand by checkbox)
    const candleTimes = new Set(candleSorted.map((d) => d.time))
    const agentMarkers = toAgentChartMarkers(agentSignalHistory?.agents ?? null, agentVisibility)
      .filter((m) => candleTimes.has(m.time as any))

    // Combine all markers, with Signal Agents taking priority (shown last = on top)
    const allMarkers = [...blueMarkers, ...yellowMarkers, ...agentMarkers].sort((a, b) => (a.time as number) - (b.time as number))
    candle.setMarkers(allMarkers as any)

    const ma10Series = mainChart.addLineSeries({ color: '#f59e0b', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, priceScaleId: 'left' })
    const ma20Series = mainChart.addLineSeries({ color: '#3b82f6', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, priceScaleId: 'left' })
    const ma50Series = mainChart.addLineSeries({ color: '#8b5cf6', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, priceScaleId: 'left' })
    const ma150Series = mainChart.addLineSeries({ color: '#ec4899', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, priceScaleId: 'left' })
    ma10Series.setData(dedupeByTime(ma10Data))

    // Volume histogram (overlay at bottom) + 20 MA volume line
    const volumeSeries = mainChart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    })
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
      borderVisible: false,
    })
    volumeSeries.setData(dedupeByTime(volumeData))
    const ma20VolSeries = mainChart.addLineSeries({
      color: '#f59e0b',
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
      priceScaleId: '',
    })
    ma20VolSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
      borderVisible: false,
    })
    ma20VolSeries.setData(dedupeByTime(ma20VolumeData))

    ma10Series.setData(dedupeByTime(ma10Data))
    ma20Series.setData(dedupeByTime(ma20Data))
    ma50Series.setData(dedupeByTime(ma50Data))
    ma150Series.setData(dedupeByTime(ma150Data))

    const VCP_COLORS = ['#22c55e', '#16a34a', '#15803d', '#166534', '#14532d', '#052e16']
    pullbacks.forEach((pb, i) => {
      const color = VCP_COLORS[Math.min(i, VCP_COLORS.length - 1)]
      const vcpLine = mainChart.addLineSeries({
        color,
        lineWidth: 2,
        lineStyle: 2,
        lastValueVisible: false,
        priceLineVisible: false,
        priceScaleId: 'left',
      })
      vcpLine.setData([
        { time: (pb.highTimeUtc ?? Math.floor(new Date(pb.highTime).getTime() / 1000)) as any, value: pb.highPrice },
        { time: (pb.lowTimeUtc ?? Math.floor(new Date(pb.lowTime).getTime() / 1000)) as any, value: pb.lowPrice },
      ])
    })
    if (pullbacks.length > 0) {
      const last = pullbacks[pullbacks.length - 1]
      candle.createPriceLine({ price: last.highPrice, color: '#22c55e', lineWidth: 1, lineStyle: 1, title: `VCP high ${last.pct.toFixed(1)}%` })
      candle.createPriceLine({ price: last.lowPrice, color: '#ef4444', lineWidth: 1, lineStyle: 1, title: `VCP low` })
    }

    // Relative Strength to Industry on main chart (only when showRsIndustry checked)
    if (showRsIndustry && rsIndustryData.length > 0) {
      const rsIndustryMainSeries = mainChart.addLineSeries({
        color: '#f59e0b',
        lineWidth: 1,
        priceScaleId: 'rs-industry',
        title: 'Relative Strength to Industry',
      })
      rsIndustryMainSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.1, bottom: 0.1 },
        borderColor: '#92400e',
        autoScale: true,
      })
      rsIndustryMainSeries.setData(dedupeByTime(rsIndustryData))
    }

    const rsiSeries = rsiChart.addLineSeries({ color: '#06b6d4', lineWidth: 2 })
    rsiSeries.setData(dedupeByTime(rsiData))

    // Add RSI reference lines at 70 (overbought) and 30 (oversold)
    rsiSeries.createPriceLine({ 
      price: 70, 
      color: '#5eead4', 
      lineWidth: 1, 
      lineStyle: 1, // 1 = dashed/dotted
      axisLabelVisible: true,
      title: 'Overbought' 
    })
    rsiSeries.createPriceLine({ 
      price: 30, 
      color: '#5eead4', 
      lineWidth: 1, 
      lineStyle: 1, // 1 = dashed/dotted
      axisLabelVisible: true,
      title: 'Oversold' 
    })

    const vcpSeries = vcpChart.addLineSeries({ color: '#a855f7', lineWidth: 2 })
    vcpSeries.setData(dedupeByTime(vcpContractionData))

    // RS pane: only Relative Strength to S&P 500 (Relative Strength to Industry is on main price chart)
    const rsSeries = rsChart.addLineSeries({ color: '#14b8a6', lineWidth: 2 })
    if (rsData.length > 0) {
      rsSeries.setData(dedupeByTime(rsData))
    }

    // Sync crosshair across all panes: when hovering any chart, show vertical line on all
    const findValAtTime = (data: { time: string | number; value?: number; close?: number }[], time: string | number | undefined) => {
      if (time == null) return 0
      const pt = data.find((d) => d.time === time)
      if (pt) return (pt.value ?? pt.close) ?? 0
      const idx = data.findIndex((d) => (typeof d.time === 'number' && typeof time === 'number' ? d.time >= time : String(d.time) >= String(time)))
      if (idx <= 0) return (data[0]?.value ?? data[0]?.close) ?? 0
      return (data[idx - 1]?.value ?? data[idx - 1]?.close) ?? 0
    }
    const mainPriceAtTime = (t: string | number | undefined) => findValAtTime(candleData, t)
    let crosshairSyncing = false
    const syncCrosshair = (time: string | number | undefined) => {
      if (!time || crosshairSyncing) return
      crosshairSyncing = true
      try {
        const timeVal = time as import('lightweight-charts').Time
        mainChart.setCrosshairPosition(mainPriceAtTime(time), timeVal, candle)
        rsiChart.setCrosshairPosition(findValAtTime(rsiData, time), timeVal, rsiSeries)
        vcpChart.setCrosshairPosition(findValAtTime(vcpContractionData, time), timeVal, vcpSeries)
        if (rsData.length > 0) {
          rsChart.setCrosshairPosition(findValAtTime(rsData, time), timeVal, rsSeries)
        }
      } finally {
        crosshairSyncing = false
      }
    }
    const clearCrosshair = () => {
      if (crosshairSyncing) return
      mainChart.clearCrosshairPosition()
      rsiChart.clearCrosshairPosition()
      vcpChart.clearCrosshairPosition()
      rsChart.clearCrosshairPosition()
    }
    mainChart.subscribeCrosshairMove((param) => {
      if (param.time != null) syncCrosshair(param.time as string | number)
      else clearCrosshair()
    })
    rsiChart.subscribeCrosshairMove((param) => {
      if (param.time != null) syncCrosshair(param.time as string | number)
      else clearCrosshair()
    })
    vcpChart.subscribeCrosshairMove((param) => {
      if (param.time != null) syncCrosshair(param.time as string | number)
      else clearCrosshair()
    })
    rsChart.subscribeCrosshairMove((param) => {
      if (param.time != null) syncCrosshair(param.time as string | number)
      else clearCrosshair()
    })

    // Sync by logical range so right margin is preserved (time range strips it)
    let syncing = false
    const syncToOthers = (range: { from: number; to: number } | null) => {
      if (!range || syncing) return
      syncing = true
      rsiChart.timeScale().setVisibleLogicalRange(range)
      vcpChart.timeScale().setVisibleLogicalRange(range)
      rsChart.timeScale().setVisibleLogicalRange(range)
      mainChart.timeScale().setVisibleLogicalRange(range)
      syncing = false
    }
    mainChart.timeScale().subscribeVisibleLogicalRangeChange(syncToOthers)
    rsiChart.timeScale().subscribeVisibleLogicalRangeChange(syncToOthers)
    vcpChart.timeScale().subscribeVisibleLogicalRangeChange(syncToOthers)
    rsChart.timeScale().subscribeVisibleLogicalRangeChange(syncToOthers)

    // Fit content first, then add right margin (50px gap)
    mainChart.timeScale().fitContent()
    const RIGHT_MARGIN_PX = 50
    const barSpacing = mainChart.timeScale().options().barSpacing
    const rightOffsetBars = Math.max(15, Math.ceil(RIGHT_MARGIN_PX / barSpacing))
    mainChart.timeScale().applyOptions({ rightOffset: rightOffsetBars })
    rsiChart.timeScale().applyOptions({ rightOffset: rightOffsetBars })
    vcpChart.timeScale().applyOptions({ rightOffset: rightOffsetBars })
    rsChart.timeScale().applyOptions({ rightOffset: rightOffsetBars })
    const logicalRange = mainChart.timeScale().getVisibleLogicalRange()
    if (logicalRange) {
      rsiChart.timeScale().setVisibleLogicalRange(logicalRange)
      vcpChart.timeScale().setVisibleLogicalRange(logicalRange)
      rsChart.timeScale().setVisibleLogicalRange(logicalRange)
    }

    chartInstance.current = mainChart
    rsiChartInstance.current = rsiChart
    vcpChartInstance.current = vcpChart
    rsChartInstance.current = rsChart

    const resize = () => {
      const w = chartWrapperRef.current?.clientWidth ?? 0
      if (w > 0) {
        mainChart.applyOptions({ width: w })
        rsiChart.applyOptions({ width: w })
        vcpChart.applyOptions({ width: w })
        rsChart.applyOptions({ width: w })
      }
    }
    const ro = new ResizeObserver(resize)
    ro.observe(chartWrapperRef.current!)
    resize()

    return () => {
      ro.disconnect()
      mainChart.remove()
      rsiChart.remove()
      vcpChart.remove()
      rsChart.remove()
      chartInstance.current = null
      rsiChartInstance.current = null
      vcpChartInstance.current = null
      rsChartInstance.current = null
    }
  }, [bars, candleData, ma10Data, ma20Data, ma50Data, ma150Data, volumeData, ma20VolumeData, rsiData, vcpContractionData, rsData, rsIndustryData, pullbacks, idealPullbackBarTimes, volumePriceBreakoutTimes, agentSignalHistory, agentVisibility, showRsIndustry])

  // Adjust visible range when timeframe changes (zoom in/out while keeping all 12 months of data loaded)
  useEffect(() => {
    if (!chartInstance.current || bars.length === 0) return
    
    // Calculate how many bars to show based on timeframe selection
    const now = Date.now() / 1000
    const targetFromTime = now - (timeframe.days * 24 * 60 * 60)
    
    // Find the bar index closest to our target start time
    const sorted = [...bars].sort((a, b) => a.t - b.t)
    const targetIndex = sorted.findIndex(b => (b.t / 1000) >= targetFromTime)
    const fromIndex = targetIndex >= 0 ? targetIndex : 0
    const toIndex = sorted.length - 1
    
    // Set the logical range to show only the selected timeframe
    if (fromIndex < toIndex) {
      const logicalRange = { from: fromIndex, to: toIndex }
      chartInstance.current.timeScale().setVisibleLogicalRange(logicalRange)
      if (rsiChartInstance.current) rsiChartInstance.current.timeScale().setVisibleLogicalRange(logicalRange)
      if (vcpChartInstance.current) vcpChartInstance.current.timeScale().setVisibleLogicalRange(logicalRange)
      if (rsChartInstance.current) rsChartInstance.current.timeScale().setVisibleLogicalRange(logicalRange)
    }
  }, [timeframe, bars])

  // Prefer scan data when API returned 0/not enough bars so profile shows enhanced score (matches table). Use scanResult from navigation or scanFallback from latest scan.
  const apiFailedOrZero = vcp && (vcp.reason === 'not_enough_bars' || vcp.score === 0)
  const fromScan = (scanResult && !scanResult.error) || (scanFallback && !scanFallback.error)
  const displayVcp = apiFailedOrZero && fromScan
    ? (scanResult && !scanResult.error ? scanResult : scanFallback)
    : (vcp ?? (scanResult && !scanResult.error ? scanResult : scanFallback ?? null))
  const visibleAgentLegend = AGENT_CHART_LIST.filter((agent) => agentVisibility[agent.agentType])

  if (loading || !ticker) {
    return (
      <div className="w-[80%] max-w-full mx-auto py-12 text-slate-400">
        {loading ? 'Loading…' : 'Missing ticker.'}
      </div>
    )
  }

  return (
    <div className="w-[80%] max-w-full mx-auto space-y-6">
      <div className="flex flex-wrap items-start gap-4">
        <Link to="/" className="text-slate-400 hover:text-slate-200 text-sm">
          ← Dashboard
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-100">{ticker}</h1>
          {companyName && <p className="text-slate-400 text-sm mt-0.5">{companyName}</p>}
        </div>
        {/* Scan score = VCP + industry rank. Signal strength = Opus4.5 entry quality (shown in Opus4.5 panel when in position). */}
        {(displayVcp && typeof (displayVcp.enhancedScore ?? displayVcp.score) === 'number') && (
          <span className="flex items-center gap-2 flex-wrap">
            <span className="px-2 py-1 rounded bg-slate-700 text-slate-200 text-sm font-medium" title="Scan score: VCP + industry rank (0–100)">
              Scan: {displayVcp.enhancedScore ?? displayVcp.score}/100
            </span>
            {opus45History?.lastBuySignal && (opus45History.lastBuySignal.confidence != null || opus45History.lastBuySignal.grade) && (
              <span className="px-2 py-1 rounded bg-slate-700 text-emerald-300 text-sm font-medium" title="Opus4.5 signal strength (entry quality, pattern, volume)">
                Signal: {opus45History.lastBuySignal.confidence ?? '–'}%{opus45History.lastBuySignal.grade ? ` ${opus45History.lastBuySignal.grade}` : ''}
              </span>
            )}
            {displayVcp === scanFallback && (
              <span className="text-slate-500 text-xs">(scan from last run)</span>
            )}
          </span>
        )}
        {displayVcp?.recommendation === 'buy' && (
          <span className="px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 text-sm font-medium">
            Buy
          </span>
        )}
        {displayVcp?.recommendation === 'hold' && (
          <span className="px-2 py-1 rounded bg-amber-500/20 text-amber-400 text-sm font-medium">
            Hold
          </span>
        )}
        {displayVcp?.recommendation === 'avoid' && (
          <span className="px-2 py-1 rounded bg-slate-600 text-slate-400 text-sm font-medium">
            Avoid
          </span>
        )}
        {displayVcp?.vcpBullish && !displayVcp?.recommendation && (
          <span className="px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 text-sm font-medium">
            VCP Bullish
          </span>
        )}
      </div>

      {/* Horizontal Ticker Navigation Bar */}
      {scanTickers.length > 0 && (
        <div className="relative">
          {/* Gradient fade on left edge */}
          <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-slate-950 to-transparent z-10 pointer-events-none" />
          {/* Gradient fade on right edge */}
          <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-slate-950 to-transparent z-10 pointer-events-none" />
          
          <div 
            ref={tickerBarRef}
            className="flex gap-2 overflow-x-auto py-2 px-2 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-slate-900"
            style={{ scrollbarWidth: 'thin' }}
          >
            {scanTickers.map((item) => {
              const isActive = item.ticker === ticker
              return (
                <Link
                  key={item.ticker}
                  to={`/stock/${item.ticker}`}
                  data-ticker={item.ticker}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-sky-500 text-white ring-2 ring-sky-400'
                      : item.hasActionableBuy
                        ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'
                  }`}
                >
                  <span>{item.ticker}</span>
                  {item.score !== undefined && (
                    <span className={`ml-1.5 text-xs ${isActive ? 'text-sky-100' : item.hasActionableBuy ? 'text-emerald-300' : 'text-slate-500'}`}>
                      {item.score}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Opus4.5 Signal Status Panel (from server API) */}
      {opus45History && (
        <div className={`rounded-xl border p-4 ${
          opus45History.isActionableBuy
            ? 'border-emerald-500/50 bg-emerald-500/10'
            : opus45History.currentStatus === 'in_position'
              ? 'border-sky-500/30 bg-sky-500/5'
              : 'border-slate-800 bg-slate-900/50'
        }`}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className={`text-lg font-bold ${
                opus45History.isActionableBuy 
                  ? 'text-emerald-400' 
                  : opus45History.currentStatus === 'in_position'
                    ? 'text-sky-400'
                    : 'text-slate-400'
              }`}>
                Opus4.5 Signal
              </div>
              {opus45History.isActionableBuy ? (
                <span className="px-3 py-1 rounded-full text-sm font-semibold bg-emerald-500 text-white">
                  BUY
                </span>
              ) : opus45History.currentStatus === 'in_position' ? (
                <span className="px-3 py-1 rounded-full text-sm font-medium bg-sky-600/80 text-sky-100">
                  Holding
                </span>
              ) : (
                <span className="px-3 py-1 rounded-full text-sm font-medium bg-slate-700 text-slate-300">
                  No Signal
                </span>
              )}
              {opus45History.lastBuySignal?.confidence && opus45History.lastBuySignal.confidence > 0 && (
                <span className="px-2 py-1 rounded bg-slate-700 text-slate-200 text-sm">
                  {opus45History.lastBuySignal.confidence}% confidence
                </span>
              )}
            </div>
            {opus45History.holdingPeriod !== null && opus45History.lastBuySignal && (
              <div className="flex items-center gap-2">
                <span className="text-slate-400 text-sm">{opus45History.isActionableBuy ? 'Entry:' : 'Holding:'}</span>
                <span className="text-slate-500 text-sm">
                  ({opus45History.holdingPeriod} days)
                </span>
              </div>
            )}
          </div>
          <div className="text-slate-400 text-sm mt-2">
            {opus45History.reason || (
              opus45History.isActionableBuy 
                ? 'Fresh buy signal - actionable entry' 
                : opus45History.currentStatus === 'in_position' 
                  ? 'Position open (buy signal passed - not a new entry)' 
                  : 'No active signal'
            )}
          </div>
          
          {/* Show trade details if in position */}
          {opus45History.currentStatus === 'in_position' && opus45History.lastBuySignal && (
            <div className="mt-3 pt-3 border-t border-slate-700/50 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <div className="text-slate-500 text-xs">Entry Price</div>
                <div className="text-slate-200 font-mono">${opus45History.lastBuySignal.price.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-slate-500 text-xs">Stop Loss (4%)</div>
                <div className="text-red-400 font-mono">${opus45History.lastBuySignal.stopLoss?.toFixed(2) || '–'}</div>
              </div>
              <div>
                <div className="text-slate-500 text-xs">Target (52w High)</div>
                <div className="text-emerald-400 font-mono">${opus45History.lastBuySignal.target?.toFixed(2) || '–'}</div>
              </div>
              <div>
                <div className="text-slate-500 text-xs">Exit Rule</div>
                <div className="text-slate-200">Below 10 MA or -4%</div>
              </div>
            </div>
          )}

          {/* Recent signals & trades: show current open position (buy) first, then last 5 completed trades */}
          <div className="mt-3 pt-3 border-t border-slate-700/50">
            <div className="text-slate-400 text-xs font-medium mb-2">Recent signals &amp; trades</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-500 text-xs text-left">
                    <th className="pb-2 pr-3">Type</th>
                    <th className="pb-2 pr-3">Entry</th>
                    <th className="pb-2 pr-3">Entry $</th>
                    <th className="pb-2 pr-3">Exit</th>
                    <th className="pb-2 pr-3">Exit $</th>
                    <th className="pb-2 pr-3">Days</th>
                    <th className="pb-2 text-right">Return</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Current open position (buy signal in last 2 days or holding) */}
                  {opus45History.currentStatus === 'in_position' && opus45History.lastBuySignal && (() => {
                    const entryPrice = opus45History.lastBuySignal!.price
                    // Current price: VCP last close, or latest bar close from chart data
                    const currentPrice = displayVcp?.lastClose ?? (bars.length ? Number(bars[bars.length - 1].c) : null)
                    const unrealizedReturnPct = currentPrice != null ? ((currentPrice - entryPrice) / entryPrice) * 100 : null
                    const unrealizedDollars = currentPrice != null ? currentPrice - entryPrice : null
                    return (
                      <tr className="border-t border-slate-700/50 bg-slate-800/50">
                        <td className="py-1.5 pr-3">
                          <span className="text-emerald-400 font-medium">BUY</span>
                          {opus45History.lastBuySignal!.grade && (
                            <span className="ml-1 text-slate-500 text-xs">{opus45History.lastBuySignal!.grade}</span>
                          )}
                        </td>
                        <td className="py-1.5 pr-3 text-slate-300">
                          {new Date(opus45History.lastBuySignal!.time * 1000).toISOString().slice(0, 10)}
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-slate-200">${entryPrice.toFixed(2)}</td>
                        <td className="py-1.5 pr-3 text-slate-500">—</td>
                        <td className="py-1.5 pr-3 text-slate-500">—</td>
                        <td className="py-1.5 pr-3 text-slate-300">{opus45History.holdingPeriod ?? '—'}</td>
                        <td className={`py-1.5 font-mono text-right font-medium ${unrealizedReturnPct != null ? (unrealizedReturnPct >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-amber-400'}`}>
                          {unrealizedReturnPct != null && unrealizedDollars != null
                            ? `${unrealizedReturnPct >= 0 ? '+' : ''}${unrealizedReturnPct.toFixed(1)}% ($${unrealizedDollars >= 0 ? '+' : ''}${unrealizedDollars.toFixed(0)})`
                            : 'open'}
                        </td>
                      </tr>
                    )
                  })()}
                  {/* Last sell (if we're not in position, show most recent sell for context) */}
                  {opus45History.currentStatus === 'no_position' && opus45History.lastSellSignal && (
                    <tr className="border-t border-slate-700/50">
                      <td className="py-1.5 pr-3 text-red-400 font-medium">SELL</td>
                      <td className="py-1.5 pr-3 text-slate-500">—</td>
                      <td className="py-1.5 pr-3 text-slate-500">—</td>
                      <td className="py-1.5 pr-3 text-slate-300">
                        {new Date(opus45History.lastSellSignal.time * 1000).toISOString().slice(0, 10)}
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-slate-200">${opus45History.lastSellSignal.price.toFixed(2)}</td>
                      <td className="py-1.5 pr-3 text-slate-500">—</td>
                      <td className="py-1.5 pr-3 text-slate-500 text-right">—</td>
                    </tr>
                  )}
                  {/* Completed trades (from chart signals) */}
                  {opus45History.completedTrades && opus45History.completedTrades.slice(-5).reverse().map((t, i) => (
                    <tr key={i} className="border-t border-slate-700/50">
                      <td className="py-1.5 pr-3 text-slate-500 text-xs">closed</td>
                      <td className="py-1.5 pr-3 text-slate-300">{t.entryDate}</td>
                      <td className="py-1.5 pr-3 font-mono text-slate-200">${t.entryPrice.toFixed(2)}</td>
                      <td className="py-1.5 pr-3 text-slate-300">{t.exitDate}</td>
                      <td className="py-1.5 pr-3 font-mono text-slate-200">${t.exitPrice.toFixed(2)}</td>
                      <td className="py-1.5 pr-3 text-slate-300">{t.daysInTrade}</td>
                      <td className={`py-1.5 font-mono text-right font-medium ${t.returnPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {t.returnPct >= 0 ? '+' : ''}{t.returnPct}% (${t.profitDollars >= 0 ? '+' : ''}{t.profitDollars.toFixed(0)})
                      </td>
                    </tr>
                  ))}
                  {opus45History.currentStatus !== 'in_position' && !opus45History.lastSellSignal && (!opus45History.completedTrades || opus45History.completedTrades.length === 0) && (
                    <tr className="border-t border-slate-700/50">
                      <td colSpan={7} className="py-3 text-center text-slate-500 text-sm">No signals or completed trades yet</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {displayVcp && (
        <>
        {(displayVcp.scoreBreakdown?.length ? displayVcp.scoreBreakdown : getScoreBreakdown(displayVcp)).length > 0 && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            {/* Whole section (Why this score? + Opus4.5 rules) in one accordion, closed by default */}
            <button
              type="button"
              onClick={() => setOpus45RulesOpen((o) => !o)}
              className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-slate-800/60 focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:ring-offset-2 focus:ring-offset-slate-900"
              aria-expanded={opus45RulesOpen ? 'true' : 'false'}
              aria-controls="score-and-rules-content"
              id="score-and-rules-heading"
            >
              <span className="text-slate-400 text-sm" aria-hidden>
                {opus45RulesOpen ? '▼' : '▶'}
              </span>
              <span className="text-slate-200 text-sm font-medium">Why this score? & Opus4.5 Buy Signal Rules</span>
              <span className="ml-auto text-slate-500 text-xs">
                {opus45RulesOpen ? 'Click to collapse' : 'Click to expand'}
              </span>
            </button>
            <div
              id="score-and-rules-content"
              role="region"
              aria-labelledby="score-and-rules-heading"
              hidden={!opus45RulesOpen}
              className="mt-3"
            >
              <div className="text-slate-400 text-sm font-medium mb-2">Why this score?</div>
              <ul className="space-y-1.5 text-sm">
                {(displayVcp.scoreBreakdown?.length ? displayVcp.scoreBreakdown : getScoreBreakdown(displayVcp)).map((c, i) => (
                  <li key={i} className={c.matched ? 'text-slate-200' : 'text-slate-500'}>
                    {c.matched ? '✓' : '–'} {c.criterion}
                    {c.detail && <span className="text-slate-500"> ({c.detail})</span>}
                    {c.points > 0 && <span className="text-sky-400 ml-1">+{c.points}</span>}
                  </li>
                ))}
              </ul>
              <div className="mt-4 pt-4 border-t border-slate-700/50">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-green-400 text-lg">↑</span>
                  <span className="text-green-400 text-sm font-medium">Opus4.5 Buy Signal Rules</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div className="space-y-3">
                    <div>
                      <div className="text-slate-400 text-xs uppercase tracking-wide mb-1">Mandatory (All Required)</div>
                      <ul className="space-y-1">
                        <li className="text-emerald-400 font-medium">• 10 MA rising 3%+ over 14 days</li>
                        <li className="text-slate-300">• Price above 50 MA (Stage 2 uptrend)</li>
                        <li className="text-slate-300">• Relative Strength ≥ 70 vs market</li>
                        <li className="text-slate-300">• Within 25% of 52-week high</li>
                        <li className="text-slate-300">• At MA support (10 or 20 MA)</li>
                      </ul>
                    </div>
                    <div>
                      <div className="text-slate-400 text-xs uppercase tracking-wide mb-1">Exit Rules</div>
                      <ul className="space-y-1">
                        <li className="text-red-400/80">• Hard stop: -4% from entry</li>
                        <li className="text-red-400/80">• Close below 10 MA</li>
                        <li className="text-red-400/80">• Trailing stop: 2.25 ATR from high</li>
                      </ul>
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400 text-xs uppercase tracking-wide mb-1">Entry Quality Factors</div>
                    <ul className="space-y-1">
                      <li className="text-emerald-400">• 10 MA slope 5%+ (strong) <span className="text-sky-400">+15</span></li>
                      <li className="text-emerald-400">• 10 MA slope 4%+ <span className="text-sky-400">+10</span></li>
                      <li className="text-slate-500">• 3+ VCP contractions <span className="text-sky-400">+15</span></li>
                      <li className="text-slate-500">• Volume drying up <span className="text-sky-400">+10</span></li>
                      <li className="text-slate-500">• At 10 MA (tight entry) <span className="text-sky-400">+10</span></li>
                      <li className="text-slate-500">• RS &gt; 80 <span className="text-sky-400">+10</span></li>
                      <li className="text-slate-500">• Near 52w high (&lt;10%) <span className="text-sky-400">+10</span></li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-9 gap-4">
          <div>
            <div className="text-slate-500 text-xs">Close</div>
            <div className="text-slate-200 font-mono">{displayVcp.lastClose?.toFixed(2) ?? '–'}</div>
          </div>
          <div>
            <div className="text-slate-500 text-xs">Contractions</div>
            <div className="text-slate-200">{displayVcp.contractions}</div>
          </div>
          <div>
            <div className="text-slate-500 text-xs">At 10 / 20 / 50 MA</div>
            <div className="text-slate-200">
              {displayVcp.atMa10 ? '✓' : '–'} / {displayVcp.atMa20 ? '✓' : '–'} / {displayVcp.atMa50 ? '✓' : '–'}
            </div>
          </div>
          <div>
            <div className="text-slate-500 text-xs">SMA 50</div>
            <div className="text-slate-200 font-mono">{displayVcp.sma50?.toFixed(2) ?? '–'}</div>
          </div>
          <div>
            <div className="text-slate-500 text-xs">Volume dry up</div>
            <div className="text-slate-200">{displayVcp.volumeDryUp ? '✓' : '–'}</div>
          </div>
          <div>
            <div className="text-slate-500 text-xs">Vol ratio (5d/20d)</div>
            <div className="text-slate-200 font-mono">{displayVcp.volumeRatio != null ? displayVcp.volumeRatio.toFixed(2) : '–'}</div>
          </div>
          <div>
            <div className="text-slate-500 text-xs">Profit Margin</div>
            <div className="text-slate-200 font-mono">{fundamentals?.profitMargin != null ? `${fundamentals.profitMargin}%` : '–'}</div>
          </div>
          <div>
            <div className="text-slate-500 text-xs">Operating Margin</div>
            <div className="text-slate-200 font-mono">{fundamentals?.operatingMargin != null ? `${fundamentals.operatingMargin}%` : '–'}</div>
          </div>
          <div>
            <div className="text-slate-500 text-xs">Industry</div>
            <div className="text-slate-200">{fundamentals?.industry ?? '–'}</div>
          </div>
          <div>
            <div className="text-slate-500 text-xs">Industry 3M Return</div>
            <div className="text-slate-200">
              {industry3M != null ? (
                <span className={industry3M >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {industry3M >= 0 ? '+' : ''}{industry3M.toFixed(1)}%
                </span>
              ) : (
                '–'
              )}
            </div>
          </div>
          <div>
            <div className="text-slate-500 text-xs">Industry 1Y Return</div>
            <div className="text-slate-200">
              {industry1Y != null ? (
                <span className={industry1Y >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {industry1Y >= 0 ? '+' : ''}{industry1Y.toFixed(1)}%
                </span>
              ) : (
                '–'
              )}
            </div>
          </div>
          <div>
            <div className="text-slate-500 text-xs">Industry YTD</div>
            <div className="text-slate-200">
              {industryYtd != null ? (
                <span className={industryYtd >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {industryYtd >= 0 ? '+' : ''}{industryYtd.toFixed(1)}%
                </span>
              ) : (
                '–'
              )}
            </div>
          </div>
        </div>
        </>
      )}

      {/* Main content area: Chart + Trade Panel side by side */}
      <div className="flex gap-4">
        {/* Chart Section (main area) */}
        <div className="flex-1 min-w-0">
          {bars.length === 0 && displayVcp && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <p className="text-amber-400/90 text-sm">
                Chart data couldn&apos;t be loaded (network or API limit). Score above is from the last scan.
              </p>
              <button
                type="button"
                onClick={() => setBarsRetryKey((k) => k + 1)}
                className="rounded-lg bg-amber-600/80 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-600"
              >
                Retry
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-4 mb-2">
            <h2 className="text-lg font-medium text-slate-200">
              {`${INTERVALS.find((i) => i.value === interval)?.label ?? 'Daily'} chart`}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex gap-1">
                {INTERVALS.map((i) => (
                  <button
                    key={i.value}
                    type="button"
                    onClick={() => setInterval(i.value)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                      interval === i.value
                        ? 'bg-sky-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                    }`}
                  >
                    {i.label}
                  </button>
                ))}
              </div>
              <span className="text-slate-500 text-sm">|</span>
              <div className="flex gap-1">
                {TIMEFRAMES.map((tf) => (
                  <button
                    key={tf.label}
                    type="button"
                    onClick={() => setTimeframe(tf)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                      timeframe.label === tf.label
                        ? 'bg-sky-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                    }`}
                  >
                    {tf.label}
                  </button>
                ))}
              </div>
              <span className="text-slate-500 text-sm">|</span>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs uppercase tracking-wide text-slate-500">Signal agents</span>
                <div className="flex flex-wrap items-center gap-3">
                  {AGENT_CHART_LIST.map((agent) => (
                    <label key={agent.agentType} className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={agentVisibility[agent.agentType]}
                        onChange={(e) =>
                          setAgentVisibility((prev) => ({
                            ...prev,
                            [agent.agentType]: e.target.checked,
                          }))
                        }
                        className={`rounded border-slate-600 bg-slate-800 focus:ring-emerald-500/50 ${agent.accentClass}`}
                      />
                      <span className="text-sm text-slate-400">{agent.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              {(fundamentals?.industry || rsIndustryData.length > 0) && (
                <>
                  <span className="text-slate-500 text-sm">|</span>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showRsIndustry}
                      onChange={(e) => setShowRsIndustry(e.target.checked)}
                      className="rounded border-slate-600 bg-slate-800 text-amber-500 focus:ring-amber-500/50"
                    />
                    <span className="text-sm text-slate-400">Relative Strength to Industry</span>
                  </label>
                </>
              )}
            </div>
          </div>
        <div ref={chartWrapperRef} className="rounded-xl border border-slate-800 overflow-hidden">
          <div className="relative">
            <div ref={chartContainerRef} style={{ height: 380 }} />
            <div className="absolute top-2 left-2 bg-slate-900/95 backdrop-blur-sm px-3 py-1.5 rounded text-xs font-medium pointer-events-none border border-slate-700/50 shadow-lg flex flex-wrap items-center gap-2">
              <span className="text-amber-400 text-base">━</span> <span className="text-slate-300">10 MA</span>
              <span className="text-blue-400 text-base">━</span> <span className="text-slate-300">20 MA</span>
              <span className="text-purple-400 text-base">━</span> <span className="text-slate-300">50 MA</span>
              <span className="text-pink-400 text-base">━</span> <span className="text-slate-300">150 MA</span>
              {showRsIndustry && rsIndustryData.length > 0 && (
                <>
                  <span className="text-slate-600">│</span>
                  <span className="text-amber-400 text-base">━</span> <span className="text-slate-300">Relative Strength to Industry</span>
                </>
              )}
              {visibleAgentLegend.length > 0 && (
                <>
                  <span className="text-slate-600">│</span>
                  {visibleAgentLegend.map((agent) => (
                    <span key={agent.agentType} className="flex items-center gap-1">
                      <span className={`text-base ${agent.legendClass}`}>●</span>
                      <span className="text-slate-300">{agent.label}</span>
                    </span>
                  ))}
                </>
              )}
            </div>
            {fundamentals?.industry && rsIndustryData.length === 0 && (
              <div className="absolute bottom-2 left-2 bg-amber-900/80 backdrop-blur-sm px-2 py-1 rounded text-[10px] text-amber-200 pointer-events-none">
                Relative Strength to Industry: run &quot;Fetch all industries&quot; on the Industry page to load.
              </div>
            )}
          </div>
          <div className="border-t border-slate-800">
            <div className="px-3 py-1.5 text-xs font-semibold text-cyan-400 bg-slate-900/50">RSI (14) - Relative Strength Index</div>
            <div className="relative">
              <div ref={rsiChartRef} style={{ height: 140 }} />
              <div className="absolute top-2 left-2 bg-slate-900/95 backdrop-blur-sm px-3 py-1.5 rounded text-xs text-cyan-400 font-medium pointer-events-none border border-cyan-500/50 shadow-lg">
                RSI (14) • Overbought &gt;70 • Oversold &lt;30
              </div>
            </div>
          </div>
          <div className="border-t border-slate-800">
            <div className="px-3 py-1.5 text-xs font-semibold text-teal-400 bg-slate-900/50 flex items-center gap-2">
              <span>Relative Strength to S&P 500</span>
              <span className="text-slate-500 text-[10px] font-normal">Rising = Outperforming (Bullish) • Falling = Underperforming (Bearish)</span>
            </div>
            <div className="relative">
              <div ref={rsChartRef} style={{ height: 120 }} />
              <div className="absolute top-2 left-2 bg-slate-900/95 backdrop-blur-sm px-3 py-1.5 rounded text-xs font-medium pointer-events-none border border-teal-500/50 shadow-lg">
                <span className="text-teal-400 text-base">━━</span> <span className="text-slate-200">Relative Strength to S&P 500</span>
              </div>
            </div>
          </div>
          <div className="border-t border-slate-800">
            <div className="px-3 py-1.5 text-xs font-semibold text-purple-400 bg-slate-900/50">VCP Contraction - Volatility Compression Pattern</div>
            <div className="relative">
              <div ref={vcpChartRef} style={{ height: 100 }} />
              <div className="absolute top-2 left-2 bg-slate-900/95 backdrop-blur-sm px-3 py-1.5 rounded text-xs text-purple-400 font-medium pointer-events-none border border-purple-500/50 shadow-lg">
                VCP Score (consecutive smaller pullbacks)
              </div>
            </div>
          </div>
          </div>
        </div>

        {/* Trade Journal Side Panel - visible on large screens */}
        <div className="w-80 shrink-0 hidden lg:block">
          <TradePanel
            ticker={ticker || ''}
            companyName={companyName}
            currentPrice={displayVcp?.lastClose || null}
            metrics={{
              sma10: displayVcp?.sma10 || null,
              sma20: displayVcp?.sma20 || null,
              sma50: displayVcp?.sma50 || null,
              contractions: displayVcp?.contractions || 0,
              volumeDryUp: displayVcp?.volumeDryUp || false,
              pattern: 'VCP',
              patternConfidence: null,
              relativeStrength: opus45History?.lastBuySignal?.confidence || null,
              industryName: fundamentals?.industry || null,
              industryRank: null,
              opus45Confidence: opus45History?.lastBuySignal?.confidence || null,
              opus45Grade: null,
              vcpScore: displayVcp?.score || null,
              enhancedScore: displayVcp ? (displayVcp.enhancedScore ?? displayVcp.score ?? null) : null
            }}
          />
        </div>
      </div>

      <p className="text-slate-500 text-sm">
        <strong>Chart includes:</strong> Moving Averages 10 (orange), 20 (blue), 50 (purple), 150 (pink) + RSI 14 + Relative Strength (RS) Line vs S&P 500 + Volume with 20d MA + VCP pullback analysis. <strong>Opus4.5 Signals:</strong> <span className="text-green-400">↑</span> Green arrow = BUY signal, <span className="text-red-400">↓</span> Red arrow = SELL signal. RS Line: Rising = outperforming market (bullish), Falling = underperforming market (bearish). Data: Yahoo (OHLC); chart also available via TradingView widget below.
      </p>

      {/* TradingView Interactive Chart */}
      <div className="mt-8">
        <h2 className="text-lg font-medium text-slate-200 mb-2">TradingView Interactive Chart</h2>
        <p className="text-slate-500 text-sm mb-3">
          Professional charting tools with 10, 20, 50, 150 MA and RSI (14). Interactive features include drawing tools, more indicators, and multiple timeframes.
        </p>
        <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-900/50">
          <TradingViewWidget ticker={ticker} height={1100} theme="dark" />
        </div>
      </div>
    </div>
  )
}
