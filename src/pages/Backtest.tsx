import { useEffect, useState, useCallback, useMemo } from 'react'
import { API_BASE } from '../utils/api'
import { ClickTooltip } from '../components/ClickTooltip'

// ── Interfaces ──────────────────────────────────────────────

interface ActiveWeights {
  weights: Record<string, number>
  source: string
  agentType?: string
  signalsAnalyzed?: number
  baselineWinRate?: number
  avgReturn?: number
  expectancy?: number
  avgWin?: number
  avgLoss?: number
  profitFactor?: number
  generatedAt?: string
}

interface ABMetrics {
  avgReturn: number
  expectancy: number
  winRate: number
  avgWin: number
  avgLoss: number
  profitFactor: number
  maxDrawdownPct?: number
  sharpe?: number
  sortino?: number
  signalCount?: number
  source?: string
}

interface ABComparison {
  available: boolean
  runNumber?: number
  agentType?: string
  objective?: string
  control?: ABMetrics
  variant?: ABMetrics
  delta?: { avgReturn: number; expectancy: number; winRate: number }
  factorChanges?: Array<{ weight: string; oldValue: number; newValue: number; delta: number; factor: string; reason: string }>
  topFactors?: any[]
  promoted?: boolean
  promotionReason?: string
  iterationsRun?: number
  signalsEvaluated?: number
  completedAt?: string
}

interface ABHistoryRun {
  runNumber: number
  agentType?: string
  objective: string
  controlAvgReturn: number
  variantAvgReturn: number
  deltaAvgReturn: number
  controlExpectancy: number
  variantExpectancy: number
  deltaExpectancy: number
  controlWinRate: number
  variantWinRate: number
  controlProfitFactor: number | null
  variantProfitFactor: number | null
  promoted: boolean
  promotionReason: string
  iterationsRun: number
  signalsEvaluated: number
  completedAt: string
}

interface MarketRegime {
  regime: string
  confidence: number
  exposureMultiplier: number
  agentBudgets: Record<string, number>
  distributionDays?: number
  raw?: {
    spyClose?: number
    spy50ma?: number
    spy200ma?: number
    qqqClose?: number
    qqq50ma?: number
    spyAbove50ma?: boolean
    qqqAbove50ma?: boolean
  }
}

// Fallback when regime API hasn't loaded or fails — all strategy agents active so cards show "Active"
const FALLBACK_AGENT_BUDGETS: Record<string, number> = {
  momentum_scout: 0.20,
  base_hunter: 0.30,
  breakout_tracker: 0.15,
  turtle_trader: 0.20,
  ma_crossover_10_20: 0.15,
}

interface AgentManifestEntry {
  name: string
  agentType: string
  mandatoryOverrides?: Record<string, number>
}

interface AgentStatus {
  name: string
  agentType: string
  weights: ActiveWeights | null
  latestAB: ABComparison | null
  mandatoryOverrides?: Record<string, number>
}

interface AgentProgress {
  iteration: number
  maxIterations: number
  phase: string
}

interface BatchProgress {
  current: number
  total: number
  status: string
}

interface BatchAgentProgress {
  completed: number
  total: number
}

interface BatchSharedPoolStatus {
  status: 'idle' | 'loading' | 'ready' | 'reused'
  signalCount: number | null
  reuseCount: number
}

interface FactorAnalysis {
  factor: string
  factorName: string
  bestBucket: string
  bestWinRate: number
}

interface PatternType {
  pattern: string
  total: number
  wins: number
  winRate: number
  avgReturn: number
}

interface ExitType {
  exitType: string
  total: number
  percentage: number
  avgReturn: number
  avgHoldingDays: number
}

type BacktestTier = 'simple' | 'wfo' | 'wfo_mc' | 'holdout'
type BacktestEngine = 'node' | 'vectorbt'

// ── Agent display helpers ───────────────────────────────────

const AGENT_COLORS: Record<string, { text: string; bg: string; border: string; icon: string; progress: string }> = {
  momentum_scout: { text: 'text-cyan-400', bg: 'bg-cyan-900/20', border: 'border-cyan-800/50', icon: '⚡', progress: 'bg-cyan-500' },
  base_hunter:    { text: 'text-amber-400', bg: 'bg-amber-900/20', border: 'border-amber-800/50', icon: '🔍', progress: 'bg-amber-500' },
  breakout_tracker: { text: 'text-pink-400', bg: 'bg-pink-900/20', border: 'border-pink-800/50', icon: '🚀', progress: 'bg-pink-500' },
  turtle_trader:  { text: 'text-emerald-400', bg: 'bg-emerald-900/20', border: 'border-emerald-800/50', icon: '🐢', progress: 'bg-emerald-500' },
  ma_crossover_10_20: { text: 'text-teal-400', bg: 'bg-teal-900/20', border: 'border-teal-800/50', icon: '🔀', progress: 'bg-teal-500' },
  default:        { text: 'text-slate-400', bg: 'bg-slate-800/50', border: 'border-slate-700', icon: '🤖', progress: 'bg-slate-500' },
}

const AGENT_LABELS: Record<string, string> = {
  momentum_scout: 'Momentum Scout',
  base_hunter: 'Base Hunter',
  breakout_tracker: 'Breakout Tracker',
  turtle_trader: 'Turtle Trader',
  ma_crossover_10_20: '10-20 Cross Over',
  default: 'Default',
}

const AGENT_DESCRIPTIONS: Record<string, string> = {
  momentum_scout: 'Steep uptrend, RS 85+, near 52w highs',
  base_hunter: 'Deep VCP bases, 4+ contractions, volume dry-up',
  breakout_tracker: 'Tight consolidation, within 5% of highs',
  turtle_trader: 'Donchian 20/55d breakouts, 2N stop, 10/20d exit',
  ma_crossover_10_20: 'Buy on 10/20 MA cross, exit below 10 MA',
}

function getAgentColor(agentType: string) {
  return AGENT_COLORS[agentType] || AGENT_COLORS.default
}

function getAgentLabel(agentType: string) {
  return AGENT_LABELS[agentType] || agentType
}

// ── Main Component ──────────────────────────────────────────

export default function Backtest() {
  // Pipeline state
  const [isRunning, setIsRunning] = useState(false)
  const [runningStep, setRunningStep] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ current: number; total: number; ticker?: string } | null>(null)
  const [scanPhase, setScanPhase] = useState<string | null>(null)

  // Per-agent live progress during a multi-agent run
  const [agentProgress, setAgentProgress] = useState<Record<string, AgentProgress>>({})

  // Config
  const lookbackMonths = 60 // Fixed at 5 years for walk-forward optimization
  const [tickerLimit, setTickerLimit] = useState(200)
  const [hierarchyTier, setHierarchyTier] = useState<BacktestTier>('simple')
  // Engine is fixed to vectorbt while the selector is removed.
  const [hierarchyEngine] = useState<BacktestEngine>('vectorbt')
  const [hierarchyAgentType, setHierarchyAgentType] = useState('momentum_scout')
  const [hierarchyStartDate, setHierarchyStartDate] = useState(() => {
    const end = new Date()
    const start = new Date(end)
    start.setFullYear(start.getFullYear() - 5)
    return start.toISOString().slice(0, 10)
  })
  const [hierarchyEndDate, setHierarchyEndDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [hierarchyHoldoutPct, setHierarchyHoldoutPct] = useState(0.2)
  const [hierarchyTrainMonths, setHierarchyTrainMonths] = useState(12)
  const [hierarchyTestMonths, setHierarchyTestMonths] = useState(3)
  const [hierarchyStepMonths, setHierarchyStepMonths] = useState(3)
  const [hierarchyHoldingPeriods, setHierarchyHoldingPeriods] = useState('60,90,120')
  const [hierarchyOptimizeMetric] = useState('expectancy')
  const [hierarchyMonteCarloTrials, setHierarchyMonteCarloTrials] = useState(500)
  const [hierarchyResult, setHierarchyResult] = useState<any>(null)
  const [hierarchyRunning, setHierarchyRunning] = useState(false)
  const [hierarchyError, setHierarchyError] = useState<string | null>(null)
  const [hierarchyProgress, setHierarchyProgress] = useState<Record<BacktestTier, { current: number; total: number; label: string; status: 'idle' | 'running' | 'done' | 'error' }>>({
    simple: { current: 0, total: 0, label: 'Idle', status: 'idle' },
    wfo: { current: 0, total: 0, label: 'Idle', status: 'idle' },
    wfo_mc: { current: 0, total: 0, label: 'Idle', status: 'idle' },
    holdout: { current: 0, total: 0, label: 'Idle', status: 'idle' },
  })

  // Market + agents
  const [regime, setRegime] = useState<MarketRegime | null>(null)
  const [agentManifest, setAgentManifest] = useState<AgentManifestEntry[]>([])
  const [agentStatuses, setAgentStatuses] = useState<Record<string, AgentStatus>>({})

  // Global data
  const [abHistory, setAbHistory] = useState<ABHistoryRun[]>([])
  const [historyFilter, setHistoryFilter] = useState<string | null>(null)
  const [multiAgentResult, setMultiAgentResult] = useState<any>(null)
  const [batchResult, setBatchResult] = useState<any>(null)
  const [batchCheckpoint, setBatchCheckpoint] = useState<any>(null)
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null)
  const [batchAgentProgress, setBatchAgentProgress] = useState<Record<string, BatchAgentProgress>>({})
  const [batchSharedPoolStatus, setBatchSharedPoolStatus] = useState<BatchSharedPoolStatus>({
    status: 'idle',
    signalCount: null,
    reuseCount: 0,
  })

  // Analysis
  const [, setFactorAnalysis] = useState<FactorAnalysis[] | null>(null)
  const [patternTypes, setPatternTypes] = useState<PatternType[] | null>(null)
  const [exitTypes, setExitTypes] = useState<ExitType[] | null>(null)

  // Results modal
  const [showReport, setShowReport] = useState(false)
  const [, setPipelineResult] = useState<any>(null)

  // Error handling
  const [error, setError] = useState<string | null>(null)
  const [activeAgentRun, setActiveAgentRun] = useState<string | null>(null)
  const [topDownFilter, setTopDownFilter] = useState(true)
  const [batchCyclesPerAgent, setBatchCyclesPerAgent] = useState(25)
  const [batchRunId, setBatchRunId] = useState(() => `batch_${Date.now()}`)
  const [batchResume, setBatchResume] = useState(false)
  const [batchValidationEnabled, setBatchValidationEnabled] = useState(true)
  const [batchValidationPromotedOnly, setBatchValidationPromotedOnly] = useState(true)
  const [batchValidationWfoEvery, setBatchValidationWfoEvery] = useState(10)
  const [batchValidationWfoMcEvery, setBatchValidationWfoMcEvery] = useState(25)
  const [batchValidationHoldoutFinal, setBatchValidationHoldoutFinal] = useState(true)

  // ── Helpers ───────────────────────────────────────────────

  const safeJsonParse = async (res: Response) => {
    try {
      const text = await res.text()
      if (!text || text.trim() === '') return null
      return JSON.parse(text)
    } catch {
      return null
    }
  }

  const formatBatchHttpError = (status: number, statusText: string, apiError: string | null, rawText: string | null) => {
    if (apiError && apiError.trim()) return apiError.trim()
    const normalized = `${status} ${statusText} ${rawText || ''}`.toLowerCase()

    if (status === 404) {
      return 'Batch API route not found in production (HTTP 404). Redeploy latest build so /api/agents/optimize/batch is available.'
    }
    if (
      status === 502 ||
      status === 503 ||
      status === 504 ||
      normalized.includes('function_invocation_timeout') ||
      normalized.includes('timed out')
    ) {
      return 'Batch run exceeded serverless runtime on Vercel. Reduce cycles/ticker limit, or run batch from a long-running API (local/server).'
    }
    if (status === 429) {
      return 'Batch API is rate limited (HTTP 429). Wait a moment and retry.'
    }

    return `HTTP ${status} ${statusText}`.trim()
  }

  const parseHoldingPeriods = useCallback((input: string) => {
    const values = input
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isFinite(v) && v > 0)
    return values.length > 0 ? values : [90]
  }, [])

  const runHierarchyBacktest = useCallback(async () => {
    setHierarchyRunning(true)
    setHierarchyError(null)
    setHierarchyResult(null)
    setHierarchyProgress({
      simple: { current: 0, total: 0, label: 'Idle', status: 'idle' },
      wfo: { current: 0, total: 0, label: 'Idle', status: 'idle' },
      wfo_mc: { current: 0, total: 0, label: 'Idle', status: 'idle' },
      holdout: { current: 0, total: 0, label: 'Idle', status: 'idle' },
    })

    const requestPayload = {
      tier: hierarchyTier,
      engine: hierarchyEngine,
      agentType: hierarchyAgentType,
      startDate: hierarchyStartDate,
      endDate: hierarchyEndDate,
      holdoutPct: hierarchyHoldoutPct,
      trainMonths: hierarchyTrainMonths,
      testMonths: hierarchyTestMonths,
      stepMonths: hierarchyStepMonths,
      candidateHoldingPeriods: parseHoldingPeriods(hierarchyHoldingPeriods),
      optimizeMetric: hierarchyOptimizeMetric,
      topN: tickerLimit && tickerLimit > 0 ? tickerLimit : null,
      lookbackMonths,
      monteCarloTrials: hierarchyMonteCarloTrials,
    }

    try {
      const res = await fetch(`${API_BASE}/api/backtest/hierarchy/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
      })

      if (!res.ok) {
        const fallbackRes = await fetch(`${API_BASE}/api/backtest/hierarchy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestPayload),
        })
        const fallbackData = await safeJsonParse(fallbackRes)
        if (fallbackRes.ok) {
          setHierarchyResult(fallbackData)
          setHierarchyProgress((prev) => ({
            ...prev,
            [hierarchyTier]: {
              ...(prev[hierarchyTier] || { current: 0, total: 0, label: '' }),
              status: 'done',
              label: 'Complete',
            },
          }))
          await loadDashboardData()
          if (agentManifest.length > 0) {
            loadAgentStatuses(agentManifest)
          }
          return
        }

        const statusLine = `HTTP ${res.status} ${res.statusText}`
        const fallbackError = fallbackData?.error ? `Fallback: ${fallbackData.error}` : null
        throw new Error(fallbackError || statusLine || 'Backtest hierarchy failed')
      }

      if (!res.body) {
        // Fallback to non-stream endpoint if streaming isn't supported.
        const fallbackRes = await fetch(`${API_BASE}/api/backtest/hierarchy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestPayload),
        })
        const data = await safeJsonParse(fallbackRes)
        if (!fallbackRes.ok) {
          throw new Error(data?.error || `HTTP ${fallbackRes.status} ${fallbackRes.statusText}` || 'Backtest hierarchy failed')
        }
        setHierarchyResult(data)
        setHierarchyProgress((prev) => ({
          ...prev,
          [hierarchyTier]: {
            ...(prev[hierarchyTier] || { current: 0, total: 0, label: '' }),
            status: 'done',
            label: 'Complete',
          },
        }))
        await loadDashboardData()
        if (agentManifest.length > 0) {
          loadAgentStatuses(agentManifest)
        }
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          let payload = null
          try {
            payload = JSON.parse(line.slice(6))
          } catch {
            continue
          }
          if (payload.done) {
            if (payload.error) {
              setHierarchyError(payload.error)
              setHierarchyProgress((prev) => ({
                ...prev,
                [hierarchyTier]: {
                  ...(prev[hierarchyTier] || { current: 0, total: 0, label: '' }),
                  status: 'error',
                  label: payload.error,
                },
              }))
            } else if (payload.result) {
              setHierarchyResult(payload.result)
              setHierarchyProgress((prev) => ({
                ...prev,
                [hierarchyTier]: {
                  ...(prev[hierarchyTier] || { current: 0, total: 0, label: '' }),
                  status: 'done',
                  label: 'Complete',
                },
              }))
              await loadDashboardData()
              if (agentManifest.length > 0) {
                loadAgentStatuses(agentManifest)
              }
            }
            continue
          }

          if (payload.progress) {
            const tier = payload.tier as BacktestTier
            setHierarchyProgress((prev) => ({
              ...prev,
              [tier]: {
                current: payload.current ?? 0,
                total: payload.total ?? 0,
                label: payload.label || 'Running',
                status: 'running',
              },
            }))
          }
        }
      }
    } catch (e: any) {
      setHierarchyError(e?.message || 'Backtest hierarchy failed')
      setHierarchyProgress((prev) => ({
        ...prev,
        [hierarchyTier]: {
          ...(prev[hierarchyTier] || { current: 0, total: 0, label: '' }),
          status: 'error',
          label: e?.message || 'Failed',
        },
      }))
    } finally {
      setHierarchyRunning(false)
    }
  }, [
    hierarchyTier,
    hierarchyEngine,
    hierarchyStartDate,
    hierarchyEndDate,
    hierarchyHoldoutPct,
    hierarchyTrainMonths,
    hierarchyTestMonths,
    hierarchyStepMonths,
    hierarchyHoldingPeriods,
    hierarchyOptimizeMetric,
    hierarchyMonteCarloTrials,
    tickerLimit,
    parseHoldingPeriods,
  ])

  // ── Data loading ──────────────────────────────────────────

  const loadDashboardData = useCallback(async () => {
    try {
      const [analysisRes, factorsRes, patternsRes, exitsRes, regimeRes, manifestRes, historyRes] = await Promise.allSettled([
        fetch(`${API_BASE}/api/learning/historical/latest`),
        fetch(`${API_BASE}/api/learning/historical/factors`),
        fetch(`${API_BASE}/api/learning/historical/pattern-types`),
        fetch(`${API_BASE}/api/learning/historical/exits`),
        fetch(`${API_BASE}/api/agents/regime`),
        fetch(`${API_BASE}/api/agents/manifest`),
        fetch(`${API_BASE}/api/learning/run-history?limit=50`),
      ])

      const parse = async (r: PromiseSettledResult<Response | null>) => {
        if (r.status !== 'fulfilled' || !r.value || !(r.value instanceof Response) || !r.value.ok) return null
        return safeJsonParse(r.value)
      }

      const analysis = await parse(analysisRes)
      if (analysis && !analysis.error) { /* setLatestAnalysis not needed with new layout */ }

      const factors = await parse(factorsRes)
      if (factors?.factorRanking) setFactorAnalysis(factors.factorRanking)

      const patterns = await parse(patternsRes)
      if (patterns?.byPattern) setPatternTypes(patterns.byPattern)

      const exits = await parse(exitsRes)
      if (exits?.byExitType) setExitTypes(exits.byExitType)

      const r = await parse(regimeRes)
      if (r) setRegime(r)

      const m = await parse(manifestRes)
      if (m?.agents) setAgentManifest(m.agents)

      const history = await parse(historyRes)
      if (history?.runs) setAbHistory(history.runs)

    } catch (e) {
      console.error('Error loading dashboard:', e)
    }
  }, [])

  // Load per-agent statuses (weights + latest AB for each agent)
  const loadAgentStatuses = useCallback(async (manifest: AgentManifestEntry[]) => {
    const statuses: Record<string, AgentStatus> = {}

    await Promise.all(manifest.map(async (agent) => {
      const [weightsRes, abRes] = await Promise.allSettled([
        fetch(`${API_BASE}/api/agents/${agent.agentType}/weights`),
        fetch(`${API_BASE}/api/agents/${agent.agentType}/latest-ab`),
      ])

      const parseResult = async (r: PromiseSettledResult<Response>) => {
        if (r.status !== 'fulfilled' || !r.value.ok) return null
        return safeJsonParse(r.value)
      }

      statuses[agent.agentType] = {
        name: agent.name,
        agentType: agent.agentType,
        weights: await parseResult(weightsRes),
        latestAB: await parseResult(abRes),
        mandatoryOverrides: agent.mandatoryOverrides,
      }
    }))

    setAgentStatuses(statuses)
  }, [])

  useEffect(() => {
    loadDashboardData()
  }, [loadDashboardData])

  useEffect(() => {
    if (agentManifest.length > 0) {
      loadAgentStatuses(agentManifest)
    }
  }, [agentManifest, loadAgentStatuses])

  useEffect(() => {
    if (agentManifest.length > 0 && !agentManifest.some((a) => a.agentType === hierarchyAgentType)) {
      setHierarchyAgentType(agentManifest[0].agentType)
    }
  }, [agentManifest, hierarchyAgentType])

  // ── Multi-agent pipeline ──────────────────────────────────

  const runMultiAgentPipeline = useCallback(async (options?: {
    agentTypes?: string[] | null
    forceRefresh?: boolean
    tickerLimitOverride?: number
    runLabel?: string
  }) => {
    const {
      agentTypes = null,
      forceRefresh = false,
      tickerLimitOverride,
      runLabel,
    } = options || {}

    const resolvedLabel = runLabel
      ?? (Array.isArray(agentTypes) && agentTypes.length === 1 ? agentTypes[0] : 'all')
    const runName = Array.isArray(agentTypes) && agentTypes.length === 1
      ? `${getAgentLabel(agentTypes[0])} learning cycle`
      : 'multi-agent optimization'

    setIsRunning(true)
    setActiveAgentRun(resolvedLabel)
    setError(null)
    setPipelineResult(null)
    setMultiAgentResult(null)
    setRunningStep(`Starting ${runName}...`)
    setProgress(null)
    setScanPhase(null)
    setAgentProgress({})
    setBatchCheckpoint(null)
    setBatchProgress(null)
    setBatchAgentProgress({})

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30 * 60 * 1000)

      const res = await fetch(`${API_BASE}/api/agents/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lookbackMonths,
          tickerLimit: tickerLimitOverride ?? (tickerLimit || 200),
          maxIterations: 20,
          targetProfit: 5,
          agentTypes,
          forceRefresh,
          topDownFilter,
        }),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let finalResult: any = null

      const processSSELine = (line: string) => {
        if (!line.startsWith('data: ')) return
        try {
          const data = JSON.parse(line.slice(6))

          if (data.done) {
            if (data.error) setError(data.error)
            else if (data.result) finalResult = data.result
            return
          }

          switch (data.phase) {
            case 'starting':
              setRunningStep('Initializing Harry Historian...')
              break
            case 'regime':
              setScanPhase('Market Pulse')
              setRunningStep('Classifying market regime...')
              break
            case 'regime_complete':
              setScanPhase('Market Pulse')
              setRunningStep(`Regime: ${data.regime} (${data.confidence}% confidence)`)
              if (data.regime) setRegime(data as MarketRegime)
              break
            case 'scanning':
              setScanPhase('Scanning')
              setProgress({ current: data.current || 0, total: data.total || tickerLimit, ticker: data.ticker })
              setRunningStep(data.message || 'Scanning stocks...')
              break
            case 'checking_db':
            case 'db_cache':
              setScanPhase('Loading')
              setRunningStep(data.message || 'Checking signal cache...')
              if (data.fromCache) setProgress({ current: data.signalCount || 0, total: data.signalCount || 0 })
              break
            case 'saving':
              setScanPhase('Saving')
              setRunningStep(data.message || 'Saving signals...')
              break
            case 'signals_ready':
              setScanPhase('Ready')
              setRunningStep(`${data.signalCount} signals ready — deploying agents...`)
              break
            case 'sector_rs':
            case 'top_down_filter':
              setScanPhase('Top-down')
              setRunningStep(data.message || 'Applying top-down market->sector->VCP filter...')
              break
            case 'agents_starting':
              setScanPhase('Agents')
              setRunningStep(`Deploying ${data.agents?.length || 4} agents...`)
              // Initialize per-agent progress
              if (data.agents) {
                const initial: Record<string, AgentProgress> = {}
                data.agents.forEach((a: any) => {
                  initial[a.type] = { iteration: 0, maxIterations: 20, phase: 'queued' }
                })
                setAgentProgress(initial)
              }
              break
            case 'agent_iteration':
              setScanPhase(data.agentName || 'Agent')
              setRunningStep(`[${data.agentName}] Iteration ${data.iteration}/${data.maxIterations}`)
              if (data.agent) {
                setAgentProgress(prev => ({
                  ...prev,
                  [data.agent]: { iteration: data.iteration, maxIterations: data.maxIterations, phase: 'optimizing' },
                }))
              }
              break
            default:
              if (data.message) setRunningStep(data.message)
          }
        } catch { /* skip malformed SSE */ }
      }

      if (reader) {
        let buffer = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          for (const line of lines) processSSELine(line)
        }
        if (buffer.trim()) processSSELine(buffer.trim())
      }

      if (!finalResult) { setError('No result received'); return }
      if (!finalResult.success) { setError(finalResult.error || 'Optimization failed'); return }

      setMultiAgentResult(finalResult)
      setShowReport(true)
      await loadDashboardData()
      if (agentManifest.length > 0) await loadAgentStatuses(agentManifest)

    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        setError('Multi-agent optimization timed out after 30 minutes.')
      } else {
        setError(e instanceof Error ? e.message : 'Optimization failed')
      }
    } finally {
      setIsRunning(false)
      setActiveAgentRun(null)
      setRunningStep(null)
      setProgress(null)
      setScanPhase(null)
      setAgentProgress({})
    }
  }, [lookbackMonths, tickerLimit, loadDashboardData, loadAgentStatuses, agentManifest, topDownFilter])

  const runBatchMultiAgentPipeline = useCallback(async () => {
    const trimmedRunId = batchRunId.trim()
    if (!trimmedRunId) {
      setError('Batch run ID is required.')
      return
    }
    if (!Number.isFinite(batchCyclesPerAgent) || batchCyclesPerAgent < 1) {
      setError('Batch cycles must be 1 or higher.')
      return
    }

    setIsRunning(true)
    setActiveAgentRun('batch')
    setError(null)
    setPipelineResult(null)
    setBatchResult(null)
    setBatchCheckpoint(null)
    setBatchProgress({ current: 0, total: batchCyclesPerAgent, status: 'starting' })
    setBatchAgentProgress({})
    setBatchSharedPoolStatus({ status: 'idle', signalCount: null, reuseCount: 0 })
    setRunningStep(`Starting batch run ${trimmedRunId}...`)
    setProgress(null)
    setScanPhase('Batch')
    setAgentProgress({})

    try {
      const host = typeof window !== 'undefined' ? window.location.hostname.toLowerCase() : ''
      const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')
      const useChunkedBatchMode = !API_BASE && !isLocalHost
      const maxCyclesPerRequest = useChunkedBatchMode ? 1 : 0
      let chunkResume = batchResume
      let chunkRequestCount = 0
      let lastCyclesCompleted = -1
      let finalResult: any = null

      const runBatchRequestChunk = async (resumeFlag: boolean) => {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 60 * 60 * 1000)
        try {
          const res = await fetch(`${API_BASE}/api/agents/optimize/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              runId: trimmedRunId,
              cyclesPerAgent: batchCyclesPerAgent,
              lookbackMonths,
              tickerLimit: tickerLimit || 200,
              maxIterations: 20,
              targetProfit: 5,
              topDownFilter,
              resume: resumeFlag,
              maxCyclesPerRequest,
              validationEnabled: batchValidationEnabled,
              validationPromotedOnly: batchValidationPromotedOnly,
              validationWfoEveryNCycles: batchValidationWfoEvery,
              validationWfoMcEveryNCycles: batchValidationWfoMcEvery,
              validationHoldoutOnFinalCycle: batchValidationHoldoutFinal,
            }),
            signal: controller.signal,
          })

          if (!res.ok) {
            const maybeJson = await safeJsonParse(res.clone())
            const rawText = await res.text().catch(() => '')
            const normalizedMessage = formatBatchHttpError(
              res.status,
              res.statusText,
              maybeJson?.error || maybeJson?.message || null,
              rawText || null
            )
            throw new Error(normalizedMessage)
          }

          const reader = res.body?.getReader()
          const decoder = new TextDecoder()
          let chunkResult: any = null
          let streamError: string | null = null
          let sawBatchProgress = false

          const processSSELine = (line: string) => {
            if (!line.startsWith('data: ')) return
            try {
              const data = JSON.parse(line.slice(6))

              if (data.done) {
                if (data.error) {
                  streamError = data.error
                  setError(data.error)
                } else if (data.result) chunkResult = data.result
                return
              }

              if (data.phase) sawBatchProgress = true

              switch (data.phase) {
                case 'starting':
                  setScanPhase('Batch')
                  setRunningStep(data.message || 'Starting batch run...')
                  setBatchProgress(prev => ({
                    current: prev?.current ?? 0,
                    total: prev?.total || batchCyclesPerAgent,
                    status: 'starting',
                  }))
                  break
                case 'batch_cycle_start':
                  setScanPhase('Batch')
                  setRunningStep(data.message || `Batch cycle ${data.cycle}/${data.cyclesPerAgent} started`)
                  setBatchProgress({
                    current: Math.max(0, (data.cycle || 1) - 1),
                    total: data.cyclesPerAgent || batchCyclesPerAgent,
                    status: 'running',
                  })
                  break
                case 'batch_checkpoint':
                  setBatchCheckpoint(data.checkpoint || null)
                  setRunningStep(`Checkpoint saved — cycle ${data.checkpoint?.cycle ?? 'n/a'}/${data.checkpoint?.cyclesPerAgent ?? batchCyclesPerAgent}`)
                  setBatchProgress(prev => ({
                    current: data.checkpoint?.cycle ?? prev?.current ?? 0,
                    total: data.checkpoint?.cyclesPerAgent ?? prev?.total ?? batchCyclesPerAgent,
                    status: data.checkpoint?.status || 'running',
                  }))
                  if (data.checkpoint?.lastCycle?.agentResults) {
                    const completedCycle = Number(data.checkpoint?.cycle) || 0
                    const totalCycles = Number(data.checkpoint?.cyclesPerAgent) || batchCyclesPerAgent
                    const perCycleAgentTypes = (data.checkpoint.lastCycle.agentResults as any[])
                      .map((ar) => ar?.agentType)
                      .filter(Boolean)
                    if (perCycleAgentTypes.length > 0) {
                      setBatchAgentProgress((prev) => {
                        const next = { ...prev }
                        for (const agentType of perCycleAgentTypes) {
                          next[agentType] = {
                            completed: Math.max(next[agentType]?.completed || 0, completedCycle),
                            total: totalCycles,
                          }
                        }
                        return next
                      })
                    }
                  }
                  break
                case 'batch_cycle_complete':
                  setRunningStep(data.message || `Batch cycle ${data.cycle}/${data.cyclesPerAgent} complete`)
                  setBatchProgress({
                    current: data.cycle || 0,
                    total: data.cyclesPerAgent || batchCyclesPerAgent,
                    status: 'running',
                  })
                  break
                case 'batch_shared_pool_start':
                  setScanPhase('Loading')
                  setRunningStep(data.message || 'Preparing shared signal pool...')
                  setBatchSharedPoolStatus((prev) => ({
                    status: 'loading',
                    signalCount: prev.signalCount,
                    reuseCount: 0,
                  }))
                  break
                case 'batch_shared_sector_start':
                  setScanPhase('Loading')
                  setRunningStep(data.message || 'Preparing shared sector map...')
                  break
                case 'batch_shared_pool_ready':
                  setScanPhase('Ready')
                  setRunningStep(data.message || 'Shared pool ready')
                  setBatchSharedPoolStatus((prev) => ({
                    status: prev.reuseCount > 0 ? 'reused' : 'ready',
                    signalCount: Number.isFinite(Number(data.signalCount)) ? Number(data.signalCount) : prev.signalCount,
                    reuseCount: prev.reuseCount,
                  }))
                  break
                case 'batch_signal_pool_reuse':
                  setScanPhase('Ready')
                  setRunningStep(data.message || 'Reusing shared signal pool')
                  setBatchSharedPoolStatus((prev) => {
                    const incomingCycle = Number(data.cycle)
                    const nextReuseCount = Number.isFinite(incomingCycle) && incomingCycle > 0
                      ? Math.max(prev.reuseCount, incomingCycle)
                      : prev.reuseCount + 1
                    return {
                      status: 'reused',
                      signalCount: Number.isFinite(Number(data.signalCount)) ? Number(data.signalCount) : prev.signalCount,
                      reuseCount: nextReuseCount,
                    }
                  })
                  break
                case 'batch_validation':
                  setScanPhase('Validation')
                  setRunningStep(data.message || `Running ${String(data.tier || '').toUpperCase()} validation...`)
                  break
                case 'batch_done':
                  setRunningStep(data.message || 'Batch run complete')
                  setBatchProgress(prev => ({
                    current: prev?.total || batchCyclesPerAgent,
                    total: prev?.total || batchCyclesPerAgent,
                    status: 'completed',
                  }))
                  break
                case 'regime':
                  setScanPhase('Market Pulse')
                  setRunningStep('Classifying market regime...')
                  break
                case 'regime_complete':
                  setScanPhase('Market Pulse')
                  setRunningStep(`Regime: ${data.regime} (${data.confidence}% confidence)`)
                  if (data.regime) setRegime(data as MarketRegime)
                  break
                case 'scanning':
                  setScanPhase('Scanning')
                  setProgress({ current: data.current || 0, total: data.total || tickerLimit, ticker: data.ticker })
                  setRunningStep(data.message || 'Scanning stocks...')
                  break
                case 'checking_db':
                case 'db_cache':
                  setScanPhase('Loading')
                  setRunningStep(data.message || 'Checking signal cache...')
                  if (data.fromCache) setProgress({ current: data.signalCount || 0, total: data.signalCount || 0 })
                  break
                case 'saving':
                  setScanPhase('Saving')
                  setRunningStep(data.message || 'Saving signals...')
                  break
                case 'signals_ready':
                  setScanPhase('Ready')
                  setRunningStep(`${data.signalCount} signals ready — deploying agents...`)
                  break
                case 'sector_rs':
                case 'top_down_filter':
                  setScanPhase('Top-down')
                  setRunningStep(data.message || 'Applying top-down market->sector->VCP filter...')
                  break
                case 'agents_starting':
                  setScanPhase('Agents')
                  setRunningStep(`Deploying ${data.agents?.length || 4} agents...`)
                  if (data.agents) {
                    const initial: Record<string, AgentProgress> = {}
                    data.agents.forEach((a: any) => {
                      initial[a.type] = { iteration: 0, maxIterations: 20, phase: 'queued' }
                    })
                    setAgentProgress(initial)
                  }
                  break
                case 'agent_iteration':
                  setScanPhase(data.agentName || 'Agent')
                  setRunningStep(`[${data.agentName}] Iteration ${data.iteration}/${data.maxIterations}`)
                  if (data.agent) {
                    setAgentProgress(prev => ({
                      ...prev,
                      [data.agent]: { iteration: data.iteration, maxIterations: data.maxIterations, phase: 'optimizing' },
                    }))
                  }
                  break
                default:
                  if (data.message) setRunningStep(data.message)
              }
            } catch {
              // skip malformed SSE
            }
          }

          if (reader) {
            let buffer = ''
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              buffer += decoder.decode(value, { stream: true })
              const lines = buffer.split('\n')
              buffer = lines.pop() || ''
              for (const line of lines) processSSELine(line)
            }
            if (buffer.trim()) processSSELine(buffer.trim())
          }

          if (!chunkResult) {
            if (streamError) throw new Error(streamError)
            if (sawBatchProgress) {
              throw new Error('Batch stream ended before completion. In production this often means serverless timeout. Reduce cycles/ticker limit, or run batch on a long-running API.')
            }
            throw new Error('No batch result received')
          }

          return chunkResult
        } finally {
          clearTimeout(timeoutId)
        }
      }

      if (useChunkedBatchMode) {
        setRunningStep('Serverless mode detected: processing batch in 1-cycle chunks with auto-resume...')
      }

      while (true) {
        chunkRequestCount += 1
        const chunkResult = await runBatchRequestChunk(chunkResume)
        finalResult = chunkResult

        const cyclesCompleted = Number(chunkResult?.cyclesCompleted) || 0
        const cyclesPlanned = Number(chunkResult?.cyclesPlanned) || batchCyclesPerAgent
        const completed = Boolean(chunkResult?.completed) || cyclesCompleted >= cyclesPlanned

        if (!useChunkedBatchMode || completed) break

        if (cyclesCompleted <= lastCyclesCompleted) {
          throw new Error('Batch chunk did not advance to a new cycle. Stopping to avoid an infinite resume loop.')
        }
        lastCyclesCompleted = cyclesCompleted
        if (chunkRequestCount > batchCyclesPerAgent + 2) {
          throw new Error('Batch chunk safety limit reached before completion. Reduce cycles per run or retry with Resume enabled.')
        }

        chunkResume = true
        setRunningStep(`Chunk complete (${cyclesCompleted}/${cyclesPlanned}) — requesting next chunk...`)
      }

      if (!finalResult) {
        setError('No batch result received')
        return
      }

      setBatchResult(finalResult)
      setBatchProgress({
        current: finalResult?.cyclesCompleted || batchCyclesPerAgent,
        total: finalResult?.cyclesPlanned || batchCyclesPerAgent,
        status: 'completed',
      })
      if (Array.isArray(finalResult?.cycles) && finalResult.cycles.length > 0) {
        const next: Record<string, BatchAgentProgress> = {}
        const totalCycles = Number(finalResult?.cyclesPlanned) || batchCyclesPerAgent
        for (const cycle of finalResult.cycles) {
          const cycleNumber = Number(cycle?.cycle) || 0
          for (const ar of cycle?.agentResults || []) {
            const type = ar?.agentType
            if (!type) continue
            next[type] = {
              completed: Math.max(next[type]?.completed || 0, cycleNumber),
              total: totalCycles,
            }
          }
        }
        setBatchAgentProgress(next)
      }
      const lastCycle = finalResult?.cycles?.[finalResult.cycles.length - 1]
      if (lastCycle?.agentResults?.length) {
        setMultiAgentResult({
          success: true,
          regime: lastCycle.regime,
          signalCount: lastCycle.signalCount,
          elapsedMs: lastCycle.elapsedMs,
          agentResults: lastCycle.agentResults,
          summary: `Batch ${trimmedRunId} completed ${finalResult.cyclesCompleted}/${finalResult.cyclesPlanned} cycles.`,
        })
      }

      await loadDashboardData()
      if (agentManifest.length > 0) await loadAgentStatuses(agentManifest)
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        setError('Batch run timed out after 60 minutes.')
      } else {
        const msg = e instanceof Error ? e.message : 'Batch run failed'
        const normalized = String(msg).toLowerCase()
        if (normalized.includes('failed to fetch') || normalized.includes('networkerror') || normalized.includes('load failed')) {
          setError('Network/API request failed before batch could start. Verify deployment health and API availability, then retry.')
        } else {
          setError(msg)
        }
      }
    } finally {
      setIsRunning(false)
      setActiveAgentRun(null)
      setRunningStep(null)
      setProgress(null)
      setScanPhase(null)
      setAgentProgress({})
    }
  }, [
    agentManifest,
    batchCyclesPerAgent,
    batchValidationEnabled,
    batchValidationPromotedOnly,
    batchValidationWfoEvery,
    batchValidationWfoMcEvery,
    batchValidationHoldoutFinal,
    batchResume,
    batchRunId,
    loadAgentStatuses,
    loadDashboardData,
    lookbackMonths,
    tickerLimit,
    topDownFilter,
  ])

  // ── Derived data ──────────────────────────────────────────

  // Best metrics per agent from history
  const agentBestMetrics = useMemo(() => {
    const best: Record<string, { expectancy: number; winRate: number; profitFactor: number; signals: number; runs: number; promoted: number }> = {}
    for (const run of abHistory) {
      const type = run.agentType || 'default'
      if (!best[type]) {
        best[type] = { expectancy: -Infinity, winRate: 0, profitFactor: 0, signals: 0, runs: 0, promoted: 0 }
      }
      best[type].runs++
      if (run.promoted) best[type].promoted++
      const useVariant = run.promoted
      const exp = useVariant ? run.variantExpectancy : run.controlExpectancy
      const expValue = typeof exp === 'number' ? exp : -Infinity
      if (expValue > best[type].expectancy) {
        best[type].expectancy = expValue
        best[type].winRate = useVariant ? run.variantWinRate : run.controlWinRate
        best[type].profitFactor = (useVariant ? run.variantProfitFactor : run.controlProfitFactor) ?? 0
        best[type].signals = run.signalsEvaluated
      }
    }
    return best
  }, [abHistory])

  // Filtered A/B history
  const filteredHistory = useMemo(() => {
    if (!historyFilter) return abHistory
    return abHistory.filter(r => (r.agentType || 'default') === historyFilter)
  }, [abHistory, historyFilter])

  const isWfoTier = hierarchyTier === 'wfo' || hierarchyTier === 'wfo_mc' || hierarchyTier === 'holdout'
  const isHoldoutTier = hierarchyTier === 'holdout'
  const isMonteCarloTier = hierarchyTier === 'wfo_mc'
  const tierLabels: Record<BacktestTier, string> = {
    simple: 'Simple',
    wfo: 'WFO',
    wfo_mc: 'WFO + MC',
    holdout: 'Holdout',
  }

  const formatPct = (value?: number | null, decimals = 1) => {
    if (value == null || Number.isNaN(value)) return '—'
    const sign = value >= 0 ? '+' : ''
    return `${sign}${value.toFixed(decimals)}%`
  }

  const formatNum = (value?: number | null, decimals = 2) => {
    if (value == null || Number.isNaN(value)) return '—'
    return value.toFixed(decimals)
  }

  const hierarchySummary = useMemo(() => {
    if (!hierarchyResult) return null

    const base = {
      train: null as any,
      test: null as any,
      holdout: null as any,
      monteCarlo: hierarchyResult.monteCarlo?.summary || null,
      bestHoldingPeriod: null as number | null,
      insights: [] as string[],
      corrections: [] as string[],
    }

    if (hierarchyTier === 'simple') {
      base.test = hierarchyResult.node?.summary || hierarchyResult.summary || null
    } else if (hierarchyTier === 'wfo' || hierarchyTier === 'wfo_mc') {
      base.train = hierarchyResult.combinedTrain || null
      base.test = hierarchyResult.combinedTest || null
      const counts: Record<string, number> = {}
      ;(hierarchyResult.windows || []).forEach((w: any) => {
        const hp = w?.bestConfig?.holdingPeriod
        if (hp != null) counts[hp] = (counts[hp] || 0) + 1
      })
      const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
      base.bestHoldingPeriod = best ? Number(best[0]) : null
    } else if (hierarchyTier === 'holdout') {
      base.train = hierarchyResult.inSample?.wfo?.combinedTest || hierarchyResult.inSample?.wfo?.combinedTrain || null
      base.holdout = hierarchyResult.holdout?.node?.summary || null
    }

    const compareTrainTest = (train: any, test: any, label: string) => {
      if (!train || !test) return
      const trainExp = train.expectancy
      const testExp = test.expectancy
      if (typeof trainExp === 'number' && typeof testExp === 'number') {
        const delta = testExp - trainExp
        if (delta < -0.5) base.insights.push(`${label} expectancy dropped vs train (overfitting risk).`)
        if (delta > 0.5) base.insights.push(`${label} expectancy improved vs train (robust generalization).`)
      }
      if (typeof testExp === 'number' && testExp < 0) {
        base.corrections.push(`${label} expectancy is negative — tighten filters or reduce universe size.`)
      }
    }

    if (base.train && base.test) compareTrainTest(base.train, base.test, 'Test')
    if (base.train && base.holdout) compareTrainTest(base.train, base.holdout, 'Holdout')

    if (base.test && typeof base.test.winRate === 'number' && typeof base.test.profitFactor === 'number') {
      if (base.test.winRate < 50 && base.test.profitFactor >= 1.5) {
        base.insights.push('Low win rate but strong payoff — edge relies on outsized winners.')
      }
    }

    if (base.monteCarlo && typeof base.monteCarlo.p5EndingEquity === 'number') {
      if (base.monteCarlo.p5EndingEquity < 1) {
        base.corrections.push('Monte Carlo 5th percentile below breakeven — reduce risk or tighten exits.')
      }
    }

    if (base.corrections.length === 0 && base.insights.length === 0) {
      base.insights.push('Results are within normal ranges — re-run with a larger universe to validate.')
    }

    return base
  }, [hierarchyResult, hierarchyTier])

  const batchSharedPoolBadge = useMemo(() => {
    if (batchSharedPoolStatus.status === 'idle') return null

    if (batchSharedPoolStatus.status === 'loading') {
      return {
        text: 'Shared Pool: Loading',
        className: 'bg-slate-800 text-slate-300 border-slate-700',
      }
    }

    const countText = batchSharedPoolStatus.signalCount != null
      ? ` · ${batchSharedPoolStatus.signalCount.toLocaleString()} signals`
      : ''
    const reuseText = batchSharedPoolStatus.reuseCount > 0
      ? ` · reused ${batchSharedPoolStatus.reuseCount}x`
      : ''

    return {
      text: `Shared Pool: Reused${countText}${reuseText}`,
      className: 'bg-emerald-900/30 text-emerald-300 border-emerald-700/60',
    }
  }, [batchSharedPoolStatus])

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* ═══ Page Header ═══ */}
      <div>
        <h1 className="text-2xl font-bold text-slate-100">Opus Signal — Mission Control</h1>
        <p className="text-slate-400 mt-1">
          Multi-agent learning system. Harry Historian fetches 5yr OHLC data and coordinates specialized agents in parallel.
          Each agent optimizes on its own signal subset and A/B tests independently.
        </p>
      </div>

      {/* ═══ Backtest Hierarchy (Simple → WFO → MC → Holdout) ═══ */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Backtest hierarchy</h2>
            <p className="text-xs text-slate-500 mt-1">
              Simple → Walk-forward → Monte Carlo → Holdout. Runs per-agent so each signal specialist is optimized in isolation.
            </p>
          </div>
        </div>

        {hierarchyError && (
          <div className="mb-4 p-3 rounded-lg bg-red-900/20 border border-red-800/50 text-sm text-red-300">
            {hierarchyError}
          </div>
        )}

        {/* Single row: all six controls, no wrap */}
        <div className="flex flex-nowrap items-end gap-4 text-sm">
          <label className="space-y-1 min-w-0 flex-1">
            <span className="text-xs text-slate-500 uppercase tracking-wide">Tier</span>
            <select
              value={hierarchyTier}
              onChange={(e) => setHierarchyTier(e.target.value as BacktestTier)}
              className="w-full px-3 py-2 rounded-md bg-slate-800 border border-slate-700 text-slate-100"
            >
              <option value="simple">Simple backtest</option>
              <option value="wfo">Walk-forward (WFO)</option>
              <option value="wfo_mc">WFO + Monte Carlo</option>
              <option value="holdout">Out-of-sample holdout</option>
            </select>
          </label>

          <label className="space-y-1 min-w-0 flex-1">
            <span className="text-xs text-slate-500 uppercase tracking-wide">Signal agent</span>
            <select
              value={hierarchyAgentType}
              onChange={(e) => setHierarchyAgentType(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-slate-800 border border-slate-700 text-slate-100"
            >
              {(agentManifest.length > 0 ? agentManifest : [
                { name: 'Momentum Scout', agentType: 'momentum_scout' },
                { name: 'Base Hunter', agentType: 'base_hunter' },
                { name: 'Breakout Tracker', agentType: 'breakout_tracker' },
                { name: 'Turtle Trader', agentType: 'turtle_trader' },
                { name: '10-20 Cross Over', agentType: 'ma_crossover_10_20' },
              ]).map((agent) => (
                <option key={agent.agentType} value={agent.agentType}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 min-w-0 flex-1">
            <span className="text-xs text-slate-500 uppercase tracking-wide">Universe</span>
            <select
              value={tickerLimit}
              onChange={(e) => setTickerLimit(Number(e.target.value))}
              disabled={hierarchyRunning || isRunning}
              className="w-full px-3 py-2 rounded-md bg-slate-800 border border-slate-700 text-slate-100"
            >
              <option value={100}>Top 100</option>
              <option value={200}>Top 200</option>
              <option value={500}>Top 500</option>
              <option value={0}>All tickers</option>
            </select>
          </label>

          <label className="space-y-1 min-w-0 flex-1">
            <span className="text-xs text-slate-500 uppercase tracking-wide">Start</span>
            <input
              type="date"
              value={hierarchyStartDate}
              onChange={(e) => setHierarchyStartDate(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-slate-800 border border-slate-700 text-slate-100"
            />
          </label>

          <label className="space-y-1 min-w-0 flex-1">
            <span className="text-xs text-slate-500 uppercase tracking-wide">End</span>
            <input
              type="date"
              value={hierarchyEndDate}
              onChange={(e) => setHierarchyEndDate(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-slate-800 border border-slate-700 text-slate-100"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 text-sm mt-4">
          {isWfoTier && (
            <>
              <label className="space-y-1">
                <span className="text-xs text-slate-500 uppercase tracking-wide">Train months</span>
                <input
                  type="number"
                  min={3}
                  value={hierarchyTrainMonths}
                  onChange={(e) => setHierarchyTrainMonths(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-md bg-slate-800 border border-slate-700 text-slate-100"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-slate-500 uppercase tracking-wide">Test months</span>
                <input
                  type="number"
                  min={1}
                  value={hierarchyTestMonths}
                  onChange={(e) => setHierarchyTestMonths(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-md bg-slate-800 border border-slate-700 text-slate-100"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-slate-500 uppercase tracking-wide">Step months</span>
                <input
                  type="number"
                  min={1}
                  value={hierarchyStepMonths}
                  onChange={(e) => setHierarchyStepMonths(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-md bg-slate-800 border border-slate-700 text-slate-100"
                />
              </label>
            </>
          )}

          {isHoldoutTier && (
            <label className="space-y-1">
              <span className="text-xs text-slate-500 uppercase tracking-wide">Holdout %</span>
              <input
                type="number"
                min={0.1}
                max={0.4}
                step={0.05}
                value={hierarchyHoldoutPct}
                onChange={(e) => setHierarchyHoldoutPct(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-md bg-slate-800 border border-slate-700 text-slate-100"
              />
            </label>
          )}

          {isWfoTier && (
            <>
              <label className="space-y-1">
                <span className="text-xs text-slate-500 uppercase tracking-wide">Holding periods</span>
                <input
                  type="text"
                  value={hierarchyHoldingPeriods}
                  onChange={(e) => setHierarchyHoldingPeriods(e.target.value)}
                  placeholder="60,90,120"
                  className="w-full px-3 py-2 rounded-md bg-slate-800 border border-slate-700 text-slate-100"
                />
              </label>
            </>
          )}

          {isMonteCarloTier && (
            <label className="space-y-1">
              <span className="text-xs text-slate-500 uppercase tracking-wide">Monte Carlo trials</span>
              <input
                type="number"
                min={100}
                step={100}
                value={hierarchyMonteCarloTrials}
                onChange={(e) => setHierarchyMonteCarloTrials(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-md bg-slate-800 border border-slate-700 text-slate-100"
              />
            </label>
          )}
        </div>

        <div className="flex items-center justify-between mt-4">
          <button
            type="button"
            onClick={runHierarchyBacktest}
            disabled={hierarchyRunning || isRunning}
            className="px-4 py-2 rounded-md bg-purple-600 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {hierarchyRunning ? 'Running backtest...' : 'Run hierarchy backtest'}
          </button>
          <div className="text-xs text-slate-500">
            Universe: {tickerLimit && tickerLimit > 0 ? `Top ${tickerLimit}` : 'All'} tickers
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          {(Object.keys(tierLabels) as BacktestTier[]).map((tier) => {
            const progress = hierarchyProgress[tier]
            const percent = progress.total > 0
              ? Math.min(100, (progress.current / progress.total) * 100)
              : (progress.status === 'done' ? 100 : 0)
            return (
              <div key={tier} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                  <span className="uppercase tracking-wider">{tierLabels[tier]}</span>
                  <span className="text-[10px] text-slate-500">
                    {progress.total > 0 ? `${progress.current}/${progress.total}` : progress.status}
                  </span>
                </div>
                <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      progress.status === 'error' ? 'bg-red-500' :
                      progress.status === 'done' ? 'bg-emerald-500' :
                      'bg-purple-500'
                    }`}
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <div className="mt-1 text-[10px] text-slate-500">
                  {progress.label}
                </div>
              </div>
            )
          })}
        </div>

        {hierarchyResult && (
          <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/40 p-4">
            <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">Results summary</div>
            {hierarchySummary && (
              <div className="mb-4 space-y-3 text-xs text-slate-300">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {hierarchySummary.train && (
                    <div className="rounded-md border border-slate-800 bg-slate-900/60 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Train</div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>Expectancy</div><div className="text-right">{formatPct(hierarchySummary.train.expectancy)}</div>
                        <div>Avg return</div><div className="text-right">{formatPct(hierarchySummary.train.avgReturn)}</div>
                        <div>Win rate</div><div className="text-right">{formatPct(hierarchySummary.train.winRate, 1)}</div>
                        <div>Profit factor</div><div className="text-right">{formatNum(hierarchySummary.train.profitFactor)}</div>
                      </div>
                    </div>
                  )}
                  {hierarchySummary.test && (
                    <div className="rounded-md border border-slate-800 bg-slate-900/60 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Test</div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>Expectancy</div><div className="text-right">{formatPct(hierarchySummary.test.expectancy)}</div>
                        <div>Avg return</div><div className="text-right">{formatPct(hierarchySummary.test.avgReturn)}</div>
                        <div>Win rate</div><div className="text-right">{formatPct(hierarchySummary.test.winRate, 1)}</div>
                        <div>Profit factor</div><div className="text-right">{formatNum(hierarchySummary.test.profitFactor)}</div>
                      </div>
                    </div>
                  )}
                  {hierarchySummary.holdout && (
                    <div className="rounded-md border border-slate-800 bg-slate-900/60 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Holdout</div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>Expectancy</div><div className="text-right">{formatPct(hierarchySummary.holdout.expectancy)}</div>
                        <div>Avg return</div><div className="text-right">{formatPct(hierarchySummary.holdout.avgReturn)}</div>
                        <div>Win rate</div><div className="text-right">{formatPct(hierarchySummary.holdout.winRate, 1)}</div>
                        <div>Profit factor</div><div className="text-right">{formatNum(hierarchySummary.holdout.profitFactor)}</div>
                      </div>
                    </div>
                  )}
                </div>

                {hierarchySummary.bestHoldingPeriod != null && (
                  <div className="text-[10px] text-slate-500">
                    Learned: most WFO windows favored holding period ≈ {hierarchySummary.bestHoldingPeriod} days.
                  </div>
                )}

                {hierarchySummary.insights.length > 0 && (
                  <div className="text-[10px] text-slate-400">
                    <span className="uppercase tracking-wider text-slate-500">Insights:</span>{' '}
                    {hierarchySummary.insights.join(' ')}
                  </div>
                )}
                {hierarchySummary.corrections.length > 0 && (
                  <div className="text-[10px] text-amber-300">
                    <span className="uppercase tracking-wider text-amber-400">Corrections:</span>{' '}
                    {hierarchySummary.corrections.join(' ')}
                  </div>
                )}
              </div>
            )}
            <pre className="text-xs text-slate-300 whitespace-pre-wrap overflow-auto max-h-64">
              {JSON.stringify(hierarchyResult, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {/* ═══ Signal agents dashboard (Momentum Scout, Base Hunter, Breakout Tracker) ═══ */}
      <div id="signal-agents" data-section="signal-agents" data-cursor-element-id="backtest-signal-agents">
        <div className="flex items-center justify-between gap-4 mb-3">
          <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wider">Signal agents</h2>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Ticker sample</label>
              <select
                value={tickerLimit}
                onChange={(e) => setTickerLimit(Number(e.target.value))}
                disabled={isRunning}
                aria-label="Select ticker universe size"
                className="px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
              >
                <option value={100}>Top 100</option>
                <option value={200}>Top 200</option>
                <option value={500}>Top 500</option>
                <option value={0}>All tickers</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-[10px] font-medium text-slate-500 uppercase tracking-wider">
              <input
                type="checkbox"
                checked={topDownFilter}
                onChange={(e) => setTopDownFilter(e.target.checked)}
                disabled={isRunning}
                className="rounded border-slate-600 bg-slate-800 text-purple-500 focus:ring-purple-500"
              />
              Top-down filter
            </label>
          </div>
        </div>
        <div className="mb-4 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 min-w-[220px]">
              <span className="block text-[10px] font-medium text-slate-500 uppercase tracking-wider">Batch run ID</span>
              <input
                type="text"
                value={batchRunId}
                readOnly
                aria-readonly="true"
                className="w-full px-3 py-1.5 rounded-md bg-slate-800/80 border border-slate-700 text-slate-300 text-xs focus:outline-none"
              />
            </label>
            <label className="space-y-1 w-28">
              <span className="block text-[10px] font-medium text-slate-500 uppercase tracking-wider">Cycles / agent</span>
              <input
                type="number"
                min={1}
                value={batchCyclesPerAgent}
                onChange={(e) => setBatchCyclesPerAgent(Number(e.target.value))}
                disabled={isRunning}
                className="w-full px-3 py-1.5 rounded-md bg-slate-800 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-400 mb-1">
              <input
                type="checkbox"
                checked={batchResume}
                onChange={(e) => setBatchResume(e.target.checked)}
                disabled={isRunning}
                className="rounded border-slate-600 bg-slate-800 text-purple-500 focus:ring-purple-500"
              />
              Resume existing run
            </label>
            <button
              type="button"
              onClick={runBatchMultiAgentPipeline}
              disabled={isRunning}
              className="px-3 py-1.5 rounded-md bg-purple-600 text-white text-xs font-medium hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRunning && activeAgentRun === 'batch' ? 'Running batch...' : 'Run Batch Loop'}
            </button>
            <button
              type="button"
              onClick={() => {
                setBatchRunId(`batch_${Date.now()}`)
                setBatchResume(false)
              }}
              disabled={isRunning}
              className="px-3 py-1.5 rounded-md border border-slate-700 bg-slate-800 text-slate-300 text-xs font-medium hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Generate Run ID
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={batchValidationEnabled}
                onChange={(e) => setBatchValidationEnabled(e.target.checked)}
                disabled={isRunning}
                className="rounded border-slate-600 bg-slate-800 text-purple-500 focus:ring-purple-500"
              />
              Scheduled hierarchy validation
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={batchValidationPromotedOnly}
                onChange={(e) => setBatchValidationPromotedOnly(e.target.checked)}
                disabled={isRunning || !batchValidationEnabled}
                className="rounded border-slate-600 bg-slate-800 text-purple-500 focus:ring-purple-500"
              />
              Promoted agents only
            </label>
            <label className="space-y-1 w-24">
              <span className="block text-[10px] font-medium text-slate-500 uppercase tracking-wider">WFO every</span>
              <input
                type="number"
                min={1}
                value={batchValidationWfoEvery}
                onChange={(e) => setBatchValidationWfoEvery(Number(e.target.value))}
                disabled={isRunning || !batchValidationEnabled}
                className="w-full px-2 py-1 rounded-md bg-slate-800 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
              />
            </label>
            <label className="space-y-1 w-28">
              <span className="block text-[10px] font-medium text-slate-500 uppercase tracking-wider">WFO+MC every</span>
              <input
                type="number"
                min={1}
                value={batchValidationWfoMcEvery}
                onChange={(e) => setBatchValidationWfoMcEvery(Number(e.target.value))}
                disabled={isRunning || !batchValidationEnabled}
                className="w-full px-2 py-1 rounded-md bg-slate-800 border border-slate-700 text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={batchValidationHoldoutFinal}
                onChange={(e) => setBatchValidationHoldoutFinal(e.target.checked)}
                disabled={isRunning || !batchValidationEnabled}
                className="rounded border-slate-600 bg-slate-800 text-purple-500 focus:ring-purple-500"
              />
              Holdout on final cycle
            </label>
          </div>
          <div className="mt-2 text-[11px] text-slate-500">
            Top-down filter is <span className={topDownFilter ? 'text-emerald-400' : 'text-amber-400'}>{topDownFilter ? 'ON' : 'OFF'}</span>.
            {batchCheckpoint?.cycle ? (
              <span className="ml-2">
                Checkpoint: cycle {batchCheckpoint.cycle}/{batchCheckpoint.cyclesPerAgent} ({batchCheckpoint.status})
              </span>
            ) : (
              <span className="ml-2">No batch checkpoint yet.</span>
            )}
            {batchValidationEnabled && (
              <span className="ml-2">
                Validation cadence: WFO/{batchValidationWfoEvery}, WFO+MC/{batchValidationWfoMcEvery}, Holdout {batchValidationHoldoutFinal ? 'final' : 'off'}.
              </span>
            )}
            {batchSharedPoolBadge && (
              <span className={`ml-2 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] ${batchSharedPoolBadge.className}`}>
                {batchSharedPoolBadge.text}
              </span>
            )}
          </div>
        </div>
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-900/20 border border-red-800/50 text-sm text-red-300 flex items-center gap-2">
            <span>⚠️</span> {error}
          </div>
        )}
        {isRunning && runningStep && (
          <div className="mb-3 text-xs text-slate-400">
            {runningStep}
          </div>
        )}
        {isRunning && activeAgentRun === 'batch' && batchProgress && (
          <div className="mb-4">
            <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
              <span>Batch progress</span>
              <div className="flex items-center gap-2">
                {batchSharedPoolBadge && (
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] ${batchSharedPoolBadge.className}`}>
                    {batchSharedPoolBadge.text}
                  </span>
                )}
                <span>
                  {Math.min(batchProgress.current, batchProgress.total)}/{batchProgress.total} cycles
                </span>
              </div>
            </div>
            <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-purple-500 transition-all duration-300 rounded-full"
                style={{
                  width: `${batchProgress.total > 0
                    ? Math.min(100, (Math.max(0, batchProgress.current) / batchProgress.total) * 100)
                    : 0}%`,
                }}
              />
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {(agentManifest.length > 0 ? agentManifest : [
            { name: 'Momentum Scout', agentType: 'momentum_scout' },
            { name: 'Base Hunter', agentType: 'base_hunter' },
            { name: 'Breakout Tracker', agentType: 'breakout_tracker' },
            { name: 'Turtle Trader', agentType: 'turtle_trader' },
            { name: '10-20 Cross Over', agentType: 'ma_crossover_10_20' },
          ]).map(agent => {
            const color = getAgentColor(agent.agentType)
            const status = agentStatuses[agent.agentType]
            const budgets = regime?.agentBudgets ?? FALLBACK_AGENT_BUDGETS
            const budget = budgets[agent.agentType] ?? 0
            const isActive = budget > 0
            const latestRun = abHistory.find(r => r.agentType === agent.agentType)
            const ap = agentProgress[agent.agentType]
            const isThisAgentRunning = activeAgentRun === agent.agentType
            const isBatchRunActive = isRunning && activeAgentRun === 'batch'
            const batchCardProgress = batchAgentProgress[agent.agentType]
            const fallbackBatchCompleted = Math.max(0, Math.min(
              batchCardProgress?.completed ?? batchProgress?.current ?? 0,
              batchCardProgress?.total ?? batchProgress?.total ?? batchCyclesPerAgent,
            ))
            const fallbackBatchTotal = Math.max(0, batchCardProgress?.total ?? batchProgress?.total ?? batchCyclesPerAgent)
            const fallbackBatchPercent = fallbackBatchTotal > 0
              ? Math.round((fallbackBatchCompleted / fallbackBatchTotal) * 100)
              : 0
            const loopProgressLabel = isBatchRunActive
              ? `Loops ${fallbackBatchCompleted}/${fallbackBatchTotal || '—'}`
              : ap
                ? `Iter ${ap.iteration}/${ap.maxIterations}`
                : isThisAgentRunning
                  ? 'Initializing...'
                  : 'Waiting...'
            const loopProgressPercent = ap?.phase === 'queued'
              ? 0
              : ap
                ? Math.round((ap.iteration / (ap.maxIterations || 1)) * 100)
                : isBatchRunActive
                  ? fallbackBatchPercent
                  : 0
            const rawFallbackExpectancy = latestRun
              ? (latestRun.promoted ? latestRun.variantExpectancy : latestRun.controlExpectancy)
              : null
            const fallbackExpectancy = typeof rawFallbackExpectancy === 'number' ? rawFallbackExpectancy : null

            // Agent metrics: prefer per-agent status, fallback to history
            const metrics = status?.latestAB?.available
              ? (status.latestAB.promoted ? status.latestAB.variant : status.latestAB.control)
              : null
            const agentBest = agentBestMetrics[agent.agentType]

            return (
              <div key={agent.agentType} className={`rounded-xl border p-4 transition-all ${color.border} ${isActive ? color.bg : 'bg-slate-900/30 opacity-60'}`}>
                {/* Header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{color.icon}</span>
                    <span className={`font-semibold ${color.text}`}>{agent.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {isBatchRunActive && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800/90 text-slate-300 border border-slate-700">
                        Loops {fallbackBatchCompleted}/{fallbackBatchTotal || '—'}
                      </span>
                    )}
                    {budget > 0 && (
                      <span className={`text-xs font-mono font-bold ${budget >= 0.5 ? 'text-emerald-400' : budget >= 0.2 ? 'text-amber-400' : 'text-slate-500'}`}>
                        {(budget * 100).toFixed(0)}%
                      </span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      isActive ? 'bg-emerald-900/40 text-emerald-400' : 'bg-slate-800 text-slate-500'
                    }`}>
                      {isActive ? 'Active' : 'Paused'}
                    </span>
                  </div>
                </div>

                {/* Batch/single loop progress near the card top for visibility */}
                {(isBatchRunActive || isRunning) && (
                  <div className="mb-3">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className={color.text}>
                        {ap?.phase === 'queued' ? 'Queued' : loopProgressLabel}
                      </span>
                      <span className="text-slate-500">
                        {ap?.phase === 'queued' ? '0%' : `${loopProgressPercent}%`}
                      </span>
                    </div>
                    <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${color.progress}`}
                        style={{
                          width: `${ap?.phase === 'queued'
                            ? 0
                            : ap
                              ? (ap.iteration / (ap.maxIterations || 1)) * 100
                              : isBatchRunActive
                                ? loopProgressPercent
                                : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Description */}
                <div className="text-xs text-slate-500 mb-3">{AGENT_DESCRIPTIONS[agent.agentType] || ''}</div>

                {/* Metrics grid */}
                {metrics ? (
                  <div className="grid grid-cols-3 gap-2 text-xs mb-3">
                    <div>
                      <div className="text-slate-500">Expectancy</div>
                      <div className={`font-mono font-bold ${(metrics.expectancy ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {metrics.expectancy != null ? `${metrics.expectancy >= 0 ? '+' : ''}${metrics.expectancy.toFixed(2)}%` : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">PF</div>
                      <div className={`font-mono font-bold ${(metrics.profitFactor ?? 0) >= 1.5 ? 'text-emerald-400' : (metrics.profitFactor ?? 0) >= 1 ? 'text-amber-400' : 'text-red-400'}`}>
                        {metrics.profitFactor != null ? metrics.profitFactor.toFixed(2) : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Max DD</div>
                      <div className={`font-mono font-bold ${
                        (metrics.maxDrawdownPct ?? 0) <= 20 ? 'text-emerald-400' :
                        (metrics.maxDrawdownPct ?? 0) <= 30 ? 'text-amber-400' : 'text-red-400'
                      }`}>
                        {metrics.maxDrawdownPct != null ? `${metrics.maxDrawdownPct.toFixed(1)}%` : '—'}
                      </div>
                    </div>
                  </div>
                ) : latestRun ? (
                  <div className="grid grid-cols-3 gap-2 text-xs mb-3">
                    <div>
                      <div className="text-slate-500">Expectancy</div>
                      <div className={`font-mono font-bold ${fallbackExpectancy == null ? 'text-slate-400' : fallbackExpectancy >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {fallbackExpectancy == null
                          ? '—'
                          : `${fallbackExpectancy >= 0 ? '+' : ''}${fallbackExpectancy.toFixed(2)}%`}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">PF</div>
                      <div className="font-mono font-bold text-slate-300">
                        {(latestRun.promoted ? latestRun.variantProfitFactor : latestRun.controlProfitFactor)?.toFixed(2) ?? '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-500">Max DD</div>
                      <div className="font-mono font-bold text-slate-400">—</div>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-slate-600 mb-3 italic">No runs yet</div>
                )}

                {/* Per-agent learning cycle */}
                <div className="flex items-center justify-between mb-3">
                  <button
                    type="button"
                    onClick={() => runMultiAgentPipeline({
                      agentTypes: [agent.agentType],
                      tickerLimitOverride: 0,
                      forceRefresh: true,
                      runLabel: agent.agentType,
                    })}
                    disabled={isRunning}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${color.border} ${color.bg} ${color.text} hover:bg-slate-800/60`}
                    aria-label={`Run learning cycle for ${agent.name}`}
                  >
                    {isRunning ? (isThisAgentRunning ? 'Learning...' : 'Busy') : 'Run Learning Cycle'}
                  </button>
                  <span className="text-[10px] text-slate-500">All tickers</span>
                </div>

                {/* Footer: weights status + runs */}
                <div className="flex items-center justify-between text-xs border-t border-slate-700/50 pt-2">
                  <div className="flex items-center gap-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${status?.weights?.source === 'optimized' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                    <span className="text-slate-500">{status?.weights?.source === 'optimized' ? 'Learned' : 'Default'} weights</span>
                  </div>
                  <div className="text-slate-500">
                    {agentBest ? `${agentBest.runs} runs · ${agentBest.promoted} promoted` : 'No history'}
                  </div>
                </div>
                {isRunning && scanPhase === 'Scanning' && progress && progress.total > 0 && (activeAgentRun === 'all' || isThisAgentRunning) && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                      <span>Scanning</span>
                      <span>
                        {progress.current}/{progress.total}
                        {progress.ticker ? ` (${progress.ticker})` : ''}
                      </span>
                    </div>
                    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${color.progress}`}
                        style={{ width: `${Math.min(100, (progress.current / progress.total) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ═══ Batch Run Summary ═══ */}
      {batchResult && (
        <div className="rounded-xl border border-indigo-800/50 bg-indigo-900/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
            <h3 className="text-sm font-semibold text-indigo-300">Batch run summary</h3>
            <div className="text-xs text-slate-400">
              Run: <span className="font-mono text-slate-300">{batchResult.runId || '—'}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="rounded-md border border-slate-800 bg-slate-900/50 p-2">
              <div className="text-slate-500">Cycles</div>
              <div className="font-mono text-slate-200">{batchResult.cyclesCompleted}/{batchResult.cyclesPlanned}</div>
            </div>
            <div className="rounded-md border border-slate-800 bg-slate-900/50 p-2">
              <div className="text-slate-500">Executions</div>
              <div className="font-mono text-slate-200">{batchResult.totalAgentExecutions ?? '—'}</div>
            </div>
            <div className="rounded-md border border-slate-800 bg-slate-900/50 p-2">
              <div className="text-slate-500">Started</div>
              <div className="font-mono text-slate-300">{batchResult.startedAt ? new Date(batchResult.startedAt).toLocaleString() : '—'}</div>
            </div>
            <div className="rounded-md border border-slate-800 bg-slate-900/50 p-2">
              <div className="text-slate-500">Completed</div>
              <div className="font-mono text-slate-300">{batchResult.completedAt ? new Date(batchResult.completedAt).toLocaleString() : '—'}</div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="rounded-md border border-slate-800 bg-slate-900/50 p-2">
              <div className="text-slate-500">Validation enabled</div>
              <div className={`font-mono ${batchResult.validationSummary?.enabled ? 'text-emerald-400' : 'text-slate-400'}`}>
                {batchResult.validationSummary?.enabled ? 'Yes' : 'No'}
              </div>
            </div>
            <div className="rounded-md border border-slate-800 bg-slate-900/50 p-2">
              <div className="text-slate-500">Validations run</div>
              <div className="font-mono text-slate-200">{batchResult.validationSummary?.totalValidations ?? 0}</div>
            </div>
            <div className="rounded-md border border-slate-800 bg-slate-900/50 p-2">
              <div className="text-slate-500">Validation pass/fail</div>
              <div className="font-mono text-slate-200">
                {(batchResult.validationSummary?.passedValidations ?? 0)} / {(batchResult.validationSummary?.failedValidations ?? 0)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Multi-Agent Results (persists after run) ═══ */}
      {multiAgentResult?.agentResults && multiAgentResult.agentResults.length > 0 && (
        <div id="latest-run-results" data-section="latest-run-results" data-cursor-element-id="backtest-latest-run-results" className="rounded-xl border border-purple-800/50 bg-purple-900/10 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-purple-300">
              Latest Run Results
            </h3>
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span>{multiAgentResult.regime?.regime} regime</span>
              <span>•</span>
              <span>{multiAgentResult.signalCount} signals</span>
              <span>•</span>
              <span>{(multiAgentResult.elapsedMs / 1000).toFixed(1)}s</span>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {multiAgentResult.agentResults.map((ar: any) => {
              const color = getAgentColor(ar.agentType)
              return (
                <div key={ar.agentType} className={`rounded-lg border p-4 ${
                  ar.success
                    ? ar.abComparison?.promoted ? 'border-emerald-800/50 bg-emerald-900/10' : `${color.border} ${color.bg}`
                    : 'border-red-800/50 bg-red-900/10'
                }`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className={`font-medium ${color.text}`}>{color.icon} {ar.name}</div>
                    {ar.success ? (
                      ar.abComparison?.promoted
                        ? <span className="text-xs font-medium text-emerald-400 bg-emerald-900/30 px-2 py-0.5 rounded-full">Promoted</span>
                        : <span className="text-xs font-medium text-amber-400 bg-amber-900/30 px-2 py-0.5 rounded-full">Rejected</span>
                    ) : (
                      <span className="text-xs font-medium text-red-400 bg-red-900/30 px-2 py-0.5 rounded-full">Skipped</span>
                    )}
                  </div>
                  {ar.success ? (
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Signals</span>
                        <span className="font-mono text-slate-300">{ar.signalCount} / {ar.totalSignals}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Control</span>
                        <span className={`font-mono ${(ar.abComparison?.controlMetrics?.expectancy ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {ar.abComparison?.controlMetrics?.expectancy?.toFixed(2) ?? '?'}%
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Variant</span>
                        <span className={`font-mono ${(ar.abComparison?.variantMetrics?.expectancy ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {ar.abComparison?.variantMetrics?.expectancy?.toFixed(2) ?? '?'}%
                        </span>
                      </div>
                      <div className="flex justify-between border-t border-slate-700/50 pt-1">
                        <span className="text-slate-500 font-medium">Delta</span>
                        <span className={`font-mono font-bold ${(ar.abComparison?.delta?.expectancy ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {ar.abComparison?.delta?.expectancy != null
                            ? `${ar.abComparison.delta.expectancy >= 0 ? '+' : ''}${ar.abComparison.delta.expectancy.toFixed(2)}%`
                            : '?'}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-red-400">{ar.error || ar.reason}</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ═══ A/B Plan (Per Agent) ═══ */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-slate-100">A/B Plan (Per Agent)</h3>
          <span className="text-xs text-slate-500 uppercase tracking-wide">Objective: expectancy</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-400">
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-wider text-slate-500">Current plan</div>
            <ul className="space-y-1 list-disc list-inside">
              <li>Control = last active weights for this agent. Variant = next exploration strategy (rotates across 8 hypotheses).</li>
              <li>Walk-forward split: first 80% train, last 20% test; A/B uses the test window only (out-of-sample).</li>
              <li>Promote only if BF ≥ 10, delta ≥ +0.5% expectancy, and all risk gates pass.</li>
              <li>Risk gates: Profit Factor ≥ 1.5, Max Drawdown ≤ 20%, Sharpe ≥ 1, Sortino ≥ 1, 200+ trades.</li>
              <li>Runs are logged per agent with strategy name + promotion reason.</li>
            </ul>
          </div>
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-wider text-slate-500">Factors to improve expectancy</div>
            <ul className="space-y-1 list-disc list-inside">
              <li>Relative strength (RS 90-99+) and 10MA slope strength.</li>
              <li>VCP quality: contractions, volume dry-up, pattern confidence.</li>
              <li>Entry precision: pullback depth, proximity to 52w highs, volume confirmation.</li>
              <li>Context: industry rank + 3-month trend, recent 5-day momentum, institutional ownership, EPS growth.</li>
            </ul>
          </div>
        </div>
      </div>

      {/* ═══ A/B Test History with Agent Tabs ═══ */}
      {abHistory.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-slate-100">A/B Test History</h3>
            <div className="flex gap-1">
              <button
                onClick={() => setHistoryFilter(null)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  !historyFilter ? 'bg-purple-600/30 text-purple-300' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                All ({abHistory.length})
              </button>
              {['momentum_scout', 'base_hunter', 'breakout_tracker', 'turtle_trader', 'ma_crossover_10_20', 'default'].map(type => {
                const count = abHistory.filter(r => (r.agentType || 'default') === type).length
                if (count === 0) return null
                const color = getAgentColor(type)
                return (
                  <button
                    key={type}
                    onClick={() => setHistoryFilter(type)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      historyFilter === type ? `${color.bg} ${color.text}` : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {getAgentLabel(type).split(' ')[0]} ({count})
                  </button>
                )
              })}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[1100px]">
              <thead>
                <tr className="border-b border-slate-800 text-xs text-slate-500 uppercase">
                  <th className="px-3 py-2">Run</th>
                  <th className="px-3 py-2">Agent</th>
                  <th className="px-3 py-2">Objective</th>
                  <th className="px-3 py-2">Date & time</th>
                  <th className="px-3 py-2 text-right">Control Exp</th>
                  <th className="px-3 py-2 text-right">Variant Exp</th>
                  <th className="px-3 py-2 text-right">Delta Exp</th>
                  <th className="px-3 py-2 text-right">Win Rate</th>
                  <th className="px-3 py-2 text-right">PF</th>
                  <th className="px-3 py-2 text-right">Signals</th>
                  <th className="px-3 py-2 text-center">Result</th>
                  <th className="px-3 py-2 text-center">Note</th>
                </tr>
              </thead>
              <tbody>
                {filteredHistory.map((run, i) => {
                  const pf = run.promoted ? run.variantProfitFactor : run.controlProfitFactor
                  const color = getAgentColor(run.agentType || 'default')
                  return (
                    <tr key={`${run.runNumber}-${run.agentType}-${i}`} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                      <td className="px-3 py-2 text-slate-400 font-mono">#{run.runNumber}</td>
                      <td className={`px-3 py-2 text-xs font-medium ${color.text}`}>
                        {color.icon} {getAgentLabel(run.agentType || 'default').split(' ')[0]}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wide">
                        {run.objective || 'avgReturn'}
                      </td>
                      <td className="px-3 py-2 text-slate-400">
                        {run.completedAt
                          ? new Date(run.completedAt).toLocaleString(undefined, {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            })
                          : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        <span className={run.controlExpectancy >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                          {run.controlExpectancy != null ? `${run.controlExpectancy >= 0 ? '+' : ''}${run.controlExpectancy.toFixed(2)}%` : '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        <span className={run.variantExpectancy >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                          {run.variantExpectancy != null ? `${run.variantExpectancy >= 0 ? '+' : ''}${run.variantExpectancy.toFixed(2)}%` : '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        <span className={run.deltaExpectancy >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                          {run.deltaExpectancy != null ? `${run.deltaExpectancy >= 0 ? '+' : ''}${run.deltaExpectancy.toFixed(2)}%` : '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-300">
                        {(run.promoted ? run.variantWinRate : run.controlWinRate)?.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        <span className={(pf ?? 0) >= 1.5 ? 'text-emerald-400' : (pf ?? 0) >= 1 ? 'text-amber-400' : 'text-red-400'}>
                          {pf != null ? pf.toFixed(2) : '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-400">
                        {run.signalsEvaluated ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {run.promoted
                          ? <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 bg-emerald-900/30 px-2 py-0.5 rounded-full">Promoted</span>
                          : <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-400 bg-amber-900/30 px-2 py-0.5 rounded-full">Rejected</span>}
                      </td>
                      <td className="px-3 py-2 text-center text-xs text-slate-400">
                        {run.promotionReason ? (
                          <ClickTooltip text={run.promotionReason}>
                            <span className="underline decoration-dotted cursor-help">Reason</span>
                          </ClickTooltip>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ Pattern & Exit Analysis ═══ */}
      {(patternTypes?.length || exitTypes?.length) ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {patternTypes && patternTypes.length > 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
              <h3 className="text-lg font-semibold text-slate-200 mb-4">Performance by Pattern</h3>
              <div className="space-y-3">
                {patternTypes.slice(0, 5).map((pattern) => (
                  <div key={pattern.pattern} className="flex justify-between items-center">
                    <div>
                      <div className="font-medium text-slate-200">{pattern.pattern || 'Unknown'}</div>
                      <div className="text-sm text-slate-500">{pattern.total} signals</div>
                    </div>
                    <div className="text-right">
                      <div className={`font-bold ${pattern.winRate >= 50 ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {pattern.winRate}% win
                      </div>
                      <div className={`text-sm ${pattern.avgReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {pattern.avgReturn >= 0 ? '+' : ''}{pattern.avgReturn}% avg
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {exitTypes && exitTypes.length > 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
              <h3 className="text-lg font-semibold text-slate-200 mb-4">Exit Type Breakdown</h3>
              <div className="space-y-3">
                {exitTypes.map((exit) => (
                  <div key={exit.exitType} className="flex justify-between items-center">
                    <div>
                      <div className="font-medium text-slate-200">
                        {exit.exitType === 'STOP_LOSS' ? '🛑 Stop Loss' :
                         exit.exitType === 'BELOW_10MA' ? '📉 Below 10 MA' :
                         exit.exitType === 'MAX_HOLD' ? '⏰ Max Hold' :
                         exit.exitType}
                      </div>
                      <div className="text-sm text-slate-500">{exit.percentage}% of exits • avg {exit.avgHoldingDays}d hold</div>
                    </div>
                    <div className="text-right">
                      <div className={`font-bold ${exit.avgReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {exit.avgReturn >= 0 ? '+' : ''}{exit.avgReturn}%
                      </div>
                      <div className="text-sm text-slate-500">{exit.total} trades</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* ═══ How It Works ═══ */}
      <div className="rounded-xl border border-sky-800/50 bg-sky-900/10 p-6">
        <h3 className="text-lg font-medium text-sky-400 mb-3">How the Multi-Agent System Works</h3>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 text-sm text-slate-300">
          <div className="space-y-2">
            <div className="text-sky-400 font-medium">1. Market Pulse</div>
            <p>Classifies regime (Bull/Uncertain/Correction/Bear) using SPY/QQQ distribution days. Sets agent budgets.</p>
          </div>
          <div className="space-y-2">
            <div className="text-sky-400 font-medium">2. Scan</div>
            <p>Harry Historian fetches 5 years of OHLC data per ticker and builds a shared signal pool. Signals are cached 7–90 days.</p>
          </div>
          <div className="space-y-2">
            <div className="text-sky-400 font-medium">3. Deploy Agents</div>
            <p>Each cycle runs one strategy from the rotation on the agent's subset; repeated cycles advance through hypotheses and compound learning.</p>
          </div>
          <div className="space-y-2">
            <div className="text-sky-400 font-medium">4. A/B Test</div>
            <p>Each agent compares variant weights vs its own control. Only promotes if +0.5% expectancy improvement and risk gates pass.</p>
          </div>
          <div className="space-y-2">
            <div className="text-sky-400 font-medium">5. Compound</div>
            <p>Next run starts from promoted weights. Each agent compounds learning independently.</p>
          </div>
        </div>
      </div>

      {/* ═══ Results Modal ═══ */}
      {showReport && multiAgentResult && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowReport(false)}
        >
          <div
            className="bg-slate-900 rounded-xl border border-purple-700 max-w-3xl w-full max-h-[85vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-slate-900 border-b border-slate-700 px-6 py-4 flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-100">Multi-Agent Cycle Complete</h2>
              <button onClick={() => setShowReport(false)} className="text-slate-400 hover:text-slate-200 text-2xl leading-none">✕</button>
            </div>
            <div className="p-6">
              <pre className="text-xs text-slate-300 whitespace-pre-wrap font-mono">
                {multiAgentResult.summary}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
