/**
 * Regime (HMM) page: separate SPY and QQQ analysis, forward predictions, 5-year data/plot, and backtest.
 * Data from GET /api/regime, GET /api/regime/backtest, GET /api/regime/bars/:ticker.
 */

import { useEffect, useState, useRef, useMemo } from 'react'
import { createChart, ColorType } from 'lightweight-charts'
import { API_BASE } from '../utils/api'

interface Bar5y {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

interface BacktestMetrics {
  whenBull: { count: number; avgForward1dPct: number | null; avgForward5dPct: number | null; avgForward21dPct: number | null }
  whenBear: { count: number; avgForward1dPct: number | null; avgForward5dPct: number | null; avgForward21dPct: number | null }
  correlation1d: number | null
  correlation5d: number | null
  correlation21d: number | null
  totalDays: number
}

interface BacktestTicker {
  ticker: string
  updatedAt: string
  fullHistory: Array<{ date: string; regime: string; state: number }>
  metrics: BacktestMetrics
}

interface BacktestApiResponse {
  spy: BacktestTicker | null
  qqq: BacktestTicker | null
}

interface RegimeStageHistoryItem {
  date: string
  regime: string
}

interface RegimeLeaderboardRow {
  runs: number
  promotions: number
  avgDeltaExpectancy: number
  promotionRate: number
  bestDeltaExpectancy: number | null
  worstDeltaExpectancy: number | null
}

interface RegimeProfileRow {
  cycles: number
  avgInputSignals: number
  avgOutputSignals: number
  avgSurvivalRatePct: number
  avgRemovedBySector: number
  avgRemovedByVcp: number
  avgRemovedByRs: number
  avgRemovedByPattern: number
  avgRemovedByContractions: number
}

interface TopDownProfileConfig {
  maxSectorRankPct: number
  minRelativeStrength: number
  minPatternConfidence: number
  minContractions: number
  requireVcpValid: boolean
}

interface HarryRegimeApiResponse {
  latestBatchRun: {
    runId: string
    status: string
    updatedAt: string
    cyclesCompleted: number
    cyclesPlanned: number
  } | null
  leaderboardByRegime: Record<string, Record<string, RegimeLeaderboardRow>>
  profileByRegime: Record<string, RegimeProfileRow>
  topDownProfileByRegime: Record<string, TopDownProfileConfig>
  stageHistorySource: string
  stageHistory: RegimeStageHistoryItem[]
  sectorRsRankings: Array<{
    ticker: string
    industry: string | null
    sectorRankPct: number | null
    sectorRsPercentile: number | null
  }>
}

interface RegimeHistoryItem {
  date: string
  regime: string
}

interface RegimePrediction {
  bull: number
  bear: number
  mostLikely: string
}

interface PredictionBlock {
  nextDay?: RegimePrediction
  day5?: RegimePrediction
  day14?: RegimePrediction
}

interface TickerRegime {
  ticker: string
  regime: string
  regimeIndex: number
  updatedAt: string
  history: RegimeHistoryItem[]
  prediction?: PredictionBlock
}

interface RegimeApiResponse {
  spy: TickerRegime | null
  qqq: TickerRegime | null
}

const REGIME_STAGE_INDEX: Record<string, number> = {
  BEAR: 0,
  CORRECTION: 1,
  UNCERTAIN: 2,
  BULL: 3,
}

const REGIME_STAGE_ORDER = ['BULL', 'UNCERTAIN', 'CORRECTION', 'BEAR'] as const

function stageFromHmmRegime(regime: string | undefined): number {
  return regime === 'bull' ? REGIME_STAGE_INDEX.BULL : REGIME_STAGE_INDEX.BEAR
}

function TickerSection({ label, data }: { label: string; data: TickerRegime }) {
  const isBull = data.regime === 'bull'
  const historyReversed = [...(data.history || [])].reverse()
  const pred = data.prediction

  return (
    <section className="space-y-4 rounded-lg border border-slate-700 bg-slate-800/30 p-6">
      <h2 className="text-xl font-semibold text-slate-100">{label}</h2>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className={`rounded border p-3 ${isBull ? 'border-emerald-700/60 bg-emerald-950/20' : 'border-rose-700/60 bg-rose-950/20'}`}>
          <div className="text-xs text-slate-400">Current regime</div>
          <div className={`font-semibold capitalize ${isBull ? 'text-emerald-300' : 'text-rose-300'}`}>{data.regime}</div>
        </div>
        <div className="rounded border border-slate-600 p-3">
          <div className="text-xs text-slate-400">State</div>
          <div className="text-slate-200">{data.regimeIndex}</div>
        </div>
        <div className="rounded border border-slate-600 p-3">
          <div className="text-xs text-slate-400">Updated</div>
          <div className="text-slate-200 text-sm">{new Date(data.updatedAt).toLocaleDateString()}</div>
        </div>
      </div>

      {pred && (pred.nextDay || pred.day5 || pred.day14) && (
        <div>
          <h3 className="text-sm font-medium text-slate-300 mb-2">Regime outlook (probability)</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {pred.nextDay && (
              <div className="rounded border border-slate-600 p-3 bg-slate-800/50">
                <div className="text-xs text-slate-400">Next trading day</div>
                <div className="mt-1 text-sm">
                  <span className="text-emerald-400">Bull {Math.round(pred.nextDay.bull * 100)}%</span>
                  <span className="text-slate-500 mx-1">/</span>
                  <span className="text-rose-400">Bear {Math.round(pred.nextDay.bear * 100)}%</span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5">Most likely: {pred.nextDay.mostLikely}</div>
              </div>
            )}
            {pred.day5 && (
              <div className="rounded border border-slate-600 p-3 bg-slate-800/50">
                <div className="text-xs text-slate-400">In 5 days</div>
                <div className="mt-1 text-sm">
                  <span className="text-emerald-400">Bull {Math.round(pred.day5.bull * 100)}%</span>
                  <span className="text-slate-500 mx-1">/</span>
                  <span className="text-rose-400">Bear {Math.round(pred.day5.bear * 100)}%</span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5">Most likely: {pred.day5.mostLikely}</div>
              </div>
            )}
            {pred.day14 && (
              <div className="rounded border border-slate-600 p-3 bg-slate-800/50">
                <div className="text-xs text-slate-400">In ~2 weeks (14 days)</div>
                <div className="mt-1 text-sm">
                  <span className="text-emerald-400">Bull {Math.round(pred.day14.bull * 100)}%</span>
                  <span className="text-slate-500 mx-1">/</span>
                  <span className="text-rose-400">Bear {Math.round(pred.day14.bear * 100)}%</span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5">Most likely: {pred.day14.mostLikely}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {historyReversed.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-slate-300 mb-2">Recent history</h3>
          <div className="rounded border border-slate-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-800/70">
                  <th className="text-left py-2 px-3 text-slate-400 font-medium">Date</th>
                  <th className="text-left py-2 px-3 text-slate-400 font-medium">Regime</th>
                </tr>
              </thead>
              <tbody>
                {historyReversed.slice(0, 15).map(({ date, regime }) => (
                  <tr key={date} className="border-b border-slate-800 hover:bg-slate-800/50">
                    <td className="py-1.5 px-3 text-slate-300">{date}</td>
                    <td className="py-1.5 px-3">
                      <span className={`capitalize ${regime === 'bull' ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {regime}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}

/** 5-year price + regime chart (lightweight-charts) */
function Regime5yChart({
  label,
  bars,
  fullHistory,
  stageHistory,
}: {
  label: string
  bars: Bar5y[]
  fullHistory: Array<{ date: string; regime: string; state: number }>
  stageHistory: RegimeStageHistoryItem[]
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null)

  const { priceData, regimeData, stageData } = useMemo(() => {
    if (bars.length === 0) return { priceData: [], regimeData: [], stageData: [] }
    const sorted = [...bars].sort((a, b) => a.t - b.t)
    const historySorted = [...fullHistory].sort((a, b) => a.date.localeCompare(b.date))
    const stageSorted = [...(stageHistory || [])].sort((a, b) => a.date.localeCompare(b.date))
    const toTime = (t: number) => Math.floor(t / 1000) as any
    const priceData = sorted.map((b) => ({ time: toTime(b.t), value: Number(b.c) }))
    let j = 0
    let k = 0
    let currentState = 0
    let currentHmmRegime = 'bear'
    let currentStage: number | null = null
    const regimeData: { time: number; value: number }[] = []
    const stageData: { time: number; value: number }[] = []
    for (const b of sorted) {
      const dateStr = new Date(b.t).toISOString().slice(0, 10)
      while (j < historySorted.length && historySorted[j].date <= dateStr) {
        currentState = historySorted[j].state
        currentHmmRegime = historySorted[j].regime
        j++
      }
      while (k < stageSorted.length && stageSorted[k].date <= dateStr) {
        const normalized = String(stageSorted[k].regime || '').toUpperCase()
        const mapped = REGIME_STAGE_INDEX[normalized]
        if (mapped != null) currentStage = mapped
        k++
      }
      const stageValue = currentStage ?? stageFromHmmRegime(currentHmmRegime)
      regimeData.push({ time: toTime(b.t), value: currentState })
      stageData.push({ time: toTime(b.t), value: stageValue })
    }
    return { priceData, regimeData, stageData }
  }, [bars, fullHistory, stageHistory])

  useEffect(() => {
    if (!containerRef.current || priceData.length === 0) return
    if (chartRef.current) {
      chartRef.current.remove()
      chartRef.current = null
    }
    const w = containerRef.current.clientWidth ?? 0
    if (w <= 0) return
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: '#0f172a' }, textColor: '#94a3b8' },
      grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
      timeScale: { timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: '#334155', scaleMargins: { top: 0.2, bottom: 0.2 } },
      width: w,
      height: 320,
    })
    const priceSeries = chart.addLineSeries({
      color: '#38bdf8',
      lineWidth: 2,
    })
    priceSeries.priceScale().applyOptions({ scaleMargins: { top: 0.2, bottom: 0.4 } })
    priceSeries.setData(priceData as any)
    const regimeSeries = chart.addLineSeries({
      color: '#22c55e',
      lineWidth: 1,
      priceScaleId: 'left',
    })
    const stageSeries = chart.addLineSeries({
      color: '#f59e0b',
      lineWidth: 1,
      priceScaleId: 'left',
    })
    chart.priceScale('left').applyOptions({
      scaleMargins: { top: 0.55, bottom: 0.08 },
      borderVisible: true,
    })
    regimeSeries.setData(regimeData as any)
    stageSeries.setData(stageData as any)
    chart.timeScale().fitContent()
    chartRef.current = chart
    const ro = new ResizeObserver(() => {
      const w = containerRef.current?.clientWidth ?? 0
      if (w > 0 && chartRef.current) chartRef.current.applyOptions({ width: w })
    })
    ro.observe(containerRef.current)
    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
    }
  }, [priceData, regimeData, stageData])

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/50 overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-700 text-slate-300 text-sm font-medium">
        {label} — 5Y price (blue), HMM state 0/1 (green), stage index 0-3 (orange)
      </div>
      <div ref={containerRef} className="h-80" />
    </div>
  )
}

function BacktestSection({ label, backtest }: { label: string; backtest: BacktestTicker }) {
  const m = backtest.metrics
  return (
    <section className="rounded-lg border border-slate-600 bg-slate-800/20 p-5">
      <h3 className="text-lg font-medium text-slate-200 mb-3">{label} — 5-year backtest</h3>
      <p className="text-slate-500 text-xs mb-3">
        Correlation: regime (bull=1, bear=0) vs actual forward return. Positive = model aligns with realized returns.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-600 text-slate-400">
              <th className="text-left py-2 pr-4">Metric</th>
              <th className="text-right py-2">Value</th>
            </tr>
          </thead>
          <tbody className="text-slate-300">
            <tr className="border-b border-slate-700"><td className="py-1.5 pr-4">Total days</td><td className="text-right">{m.totalDays}</td></tr>
            <tr className="border-b border-slate-700"><td className="py-1.5 pr-4">Days model said Bull</td><td className="text-right text-emerald-400">{m.whenBull.count}</td></tr>
            <tr className="border-b border-slate-700"><td className="py-1.5 pr-4">Days model said Bear</td><td className="text-right text-rose-400">{m.whenBear.count}</td></tr>
            <tr className="border-b border-slate-700"><td className="py-1.5 pr-4">When Bull: avg 1d fwd return</td><td className="text-right">{m.whenBull.avgForward1dPct != null ? `${m.whenBull.avgForward1dPct}%` : '—'}</td></tr>
            <tr className="border-b border-slate-700"><td className="py-1.5 pr-4">When Bull: avg 5d fwd return</td><td className="text-right">{m.whenBull.avgForward5dPct != null ? `${m.whenBull.avgForward5dPct}%` : '—'}</td></tr>
            <tr className="border-b border-slate-700"><td className="py-1.5 pr-4">When Bull: avg 21d fwd return</td><td className="text-right">{m.whenBull.avgForward21dPct != null ? `${m.whenBull.avgForward21dPct}%` : '—'}</td></tr>
            <tr className="border-b border-slate-700"><td className="py-1.5 pr-4">When Bear: avg 1d fwd return</td><td className="text-right">{m.whenBear.avgForward1dPct != null ? `${m.whenBear.avgForward1dPct}%` : '—'}</td></tr>
            <tr className="border-b border-slate-700"><td className="py-1.5 pr-4">When Bear: avg 5d fwd return</td><td className="text-right">{m.whenBear.avgForward5dPct != null ? `${m.whenBear.avgForward5dPct}%` : '—'}</td></tr>
            <tr className="border-b border-slate-700"><td className="py-1.5 pr-4">When Bear: avg 21d fwd return</td><td className="text-right">{m.whenBear.avgForward21dPct != null ? `${m.whenBear.avgForward21dPct}%` : '—'}</td></tr>
            <tr className="border-b border-slate-700"><td className="py-1.5 pr-4">Correlation (regime vs 1d fwd)</td><td className="text-right font-mono">{m.correlation1d != null ? m.correlation1d : '—'}</td></tr>
            <tr className="border-b border-slate-700"><td className="py-1.5 pr-4">Correlation (regime vs 5d fwd)</td><td className="text-right font-mono">{m.correlation5d != null ? m.correlation5d : '—'}</td></tr>
            <tr className="border-b border-slate-700"><td className="py-1.5 pr-4">Correlation (regime vs 21d fwd)</td><td className="text-right font-mono">{m.correlation21d != null ? m.correlation21d : '—'}</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default function Regime() {
  const [data, setData] = useState<RegimeApiResponse | null>(null)
  const [backtest, setBacktest] = useState<BacktestApiResponse | null>(null)
  const [harryData, setHarryData] = useState<HarryRegimeApiResponse | null>(null)
  const [bars5y, setBars5y] = useState<{ spy: Bar5y[]; qqq: Bar5y[] }>({ spy: [], qqq: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const didLoadInitialRef = useRef(false)
  const lastBarsLoadKeyRef = useRef<string>('')

  useEffect(() => {
    // Prevent repeated initial fetches in React StrictMode/dev remount cycles.
    if (didLoadInitialRef.current) return
    didLoadInitialRef.current = true

    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      fetch(`${API_BASE}/api/regime`, { cache: 'no-store' }).then((r) => {
        if (!r.ok) return r.json().then((e) => { throw new Error(e.error || r.statusText) })
        return r.json()
      }),
      fetch(`${API_BASE}/api/regime/backtest`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { spy: null, qqq: null })),
      fetch(`${API_BASE}/api/regime/harry`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([regimeData, backtestData, harry]: [RegimeApiResponse, BacktestApiResponse, HarryRegimeApiResponse | null]) => {
        if (cancelled) return
        setData(regimeData)
        setBacktest(backtestData)
        setHarryData(harry)
      })
      .catch((e: Error) => {
        if (cancelled) return
        setError(e.message)
        setData(null)
        setBacktest(null)
        setHarryData(null)
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const leaderboardRows = useMemo(() => {
    const rows: Array<{
      regime: string
      agentType: string
      row: RegimeLeaderboardRow
    }> = []
    const lb = harryData?.leaderboardByRegime || {}
    for (const [regime, byAgent] of Object.entries(lb)) {
      for (const [agentType, row] of Object.entries(byAgent || {})) {
        rows.push({ regime, agentType, row })
      }
    }
    const regimeRank: Record<string, number> = { BULL: 0, UNCERTAIN: 1, CORRECTION: 2, BEAR: 3 }
    rows.sort((a, b) => {
      const ra = regimeRank[a.regime] ?? 99
      const rb = regimeRank[b.regime] ?? 99
      if (ra !== rb) return ra - rb
      return (b.row.avgDeltaExpectancy ?? -Infinity) - (a.row.avgDeltaExpectancy ?? -Infinity)
    })
    return rows
  }, [harryData])

  const profileRows = useMemo(() => {
    return REGIME_STAGE_ORDER
      .map((regime) => {
        const profile = harryData?.profileByRegime?.[regime]
        const config = harryData?.topDownProfileByRegime?.[regime]
        if (!profile && !config) return null
        return { regime, profile, config }
      })
      .filter(Boolean) as Array<{ regime: string; profile?: RegimeProfileRow; config?: TopDownProfileConfig }>
  }, [harryData])

  useEffect(() => {
    if (!backtest?.spy && !backtest?.qqq) return
    const barsLoadKey = [
      backtest?.spy?.updatedAt || 'none',
      backtest?.qqq?.updatedAt || 'none',
    ].join('|')
    if (lastBarsLoadKeyRef.current === barsLoadKey) return
    lastBarsLoadKeyRef.current = barsLoadKey

    let cancelled = false
    Promise.all([
      fetch(`${API_BASE}/api/regime/bars/SPY`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { results: [] })),
      fetch(`${API_BASE}/api/regime/bars/QQQ`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { results: [] })),
    ])
      .then(([spyRes, qqqRes]) => {
        if (cancelled) return
        setBars5y({
          spy: (spyRes.results || []) as Bar5y[],
          qqq: (qqqRes.results || []) as Bar5y[],
        })
      })
      .catch(() => {
        if (cancelled) return
        setBars5y({ spy: [], qqq: [] })
      })

    return () => {
      cancelled = true
    }
  }, [backtest])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-slate-400">Loading regime…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-slate-100">Market Regime (HMM)</h1>
        <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 p-4 text-amber-200">
          <p className="font-medium">Regime data not available</p>
          <p className="mt-1 text-sm text-amber-200/80">{error}</p>
          <p className="mt-2 text-sm text-slate-400">
            Train the model: <code className="rounded bg-slate-800 px-1.5 py-0.5">npm run fetch-regime-data</code> then <code className="rounded bg-slate-800 px-1.5 py-0.5">npm run regime:train</code>.
          </p>
        </div>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold text-slate-100">Market Regime (HMM)</h1>
      <p className="text-slate-400 text-sm">
        Separate HMMs for SPY and QQQ (5y data, returns + volatility). Outlook uses the transition matrix for the next 1, 5, and 14 days.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {data.spy && <TickerSection label="SPY" data={data.spy} />}
        {data.qqq && <TickerSection label="QQQ" data={data.qqq} />}
      </div>

      {!data.spy && !data.qqq && (
        <div className="text-slate-500">No regime data loaded.</div>
      )}

      {/* 5-year data and regime plot */}
      {(backtest?.spy || backtest?.qqq) && (bars5y.spy.length > 0 || bars5y.qqq.length > 0) && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-slate-100">5-year data & regime plot</h2>
          <p className="text-slate-400 text-sm">
            Price (blue) and HMM regime state 0 = Bear / 1 = Bull (green) over the full 5-year training window.
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {backtest.spy && bars5y.spy.length > 0 && (
              <Regime5yChart
                label="SPY"
                bars={bars5y.spy}
                fullHistory={backtest.spy.fullHistory}
                stageHistory={harryData?.stageHistory || []}
              />
            )}
            {backtest.qqq && bars5y.qqq.length > 0 && (
              <Regime5yChart
                label="QQQ"
                bars={bars5y.qqq}
                fullHistory={backtest.qqq.fullHistory}
                stageHistory={harryData?.stageHistory || []}
              />
            )}
          </div>
          {harryData?.stageHistorySource && (
            <div className="text-xs text-slate-500">
              Regime stages source: {harryData.stageHistorySource === 'market_conditions' ? 'historical Market Pulse logs' : 'HMM fallback mapping'}.
            </div>
          )}
        </div>
      )}

      {harryData && (
        <div className="space-y-6">
          <h2 className="text-xl font-semibold text-slate-100">Harry Historian regime profile</h2>
          <p className="text-slate-400 text-sm">
            Profile by regime, sector RS percentile ranking by ticker, and a regime leaderboard from Harry batch learning cycles.
          </p>
          {harryData.latestBatchRun && (
            <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-3 text-sm text-slate-300">
              Last batch run: <span className="font-mono">{harryData.latestBatchRun.runId}</span> • cycles {harryData.latestBatchRun.cyclesCompleted}/{harryData.latestBatchRun.cyclesPlanned} • updated {new Date(harryData.latestBatchRun.updatedAt).toLocaleString()}
            </div>
          )}

          {profileRows.length > 0 && (
            <div className="rounded-lg border border-slate-700 overflow-hidden">
              <div className="px-4 py-2 bg-slate-800/70 border-b border-slate-700 text-sm font-medium text-slate-200">Profile by regime</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[980px]">
                  <thead>
                    <tr className="border-b border-slate-700 bg-slate-900/60 text-slate-400">
                      <th className="text-left py-2 px-3">Regime</th>
                      <th className="text-right py-2 px-3">Cycles</th>
                      <th className="text-right py-2 px-3">Avg in</th>
                      <th className="text-right py-2 px-3">Avg out</th>
                      <th className="text-right py-2 px-3">Survival</th>
                      <th className="text-right py-2 px-3">Sector cut</th>
                      <th className="text-right py-2 px-3">RS cut</th>
                      <th className="text-right py-2 px-3">VCP cut</th>
                      <th className="text-right py-2 px-3">Gate (max sector rank%)</th>
                      <th className="text-right py-2 px-3">Gate (min RS)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profileRows.map(({ regime, profile, config }) => (
                      <tr key={regime} className="border-b border-slate-800 hover:bg-slate-800/40">
                        <td className="py-2 px-3 font-medium text-slate-200">{regime}</td>
                        <td className="py-2 px-3 text-right text-slate-300">{profile?.cycles ?? '—'}</td>
                        <td className="py-2 px-3 text-right text-slate-300">{profile?.avgInputSignals ?? '—'}</td>
                        <td className="py-2 px-3 text-right text-slate-300">{profile?.avgOutputSignals ?? '—'}</td>
                        <td className="py-2 px-3 text-right text-slate-300">{profile?.avgSurvivalRatePct != null ? `${profile.avgSurvivalRatePct}%` : '—'}</td>
                        <td className="py-2 px-3 text-right text-slate-300">{profile?.avgRemovedBySector ?? '—'}</td>
                        <td className="py-2 px-3 text-right text-slate-300">{profile?.avgRemovedByRs ?? '—'}</td>
                        <td className="py-2 px-3 text-right text-slate-300">{profile?.avgRemovedByVcp ?? '—'}</td>
                        <td className="py-2 px-3 text-right text-slate-300">{config?.maxSectorRankPct ?? '—'}</td>
                        <td className="py-2 px-3 text-right text-slate-300">{config?.minRelativeStrength ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="rounded-lg border border-slate-700 overflow-hidden">
            <div className="px-4 py-2 bg-slate-800/70 border-b border-slate-700 text-sm font-medium text-slate-200">Regime leaderboard</div>
            {leaderboardRows.length === 0 ? (
              <div className="px-4 py-3 text-sm text-slate-400">
                No completed batch cycles yet. Run a Harry batch loop to populate leaderboard rows.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[860px]">
                  <thead>
                    <tr className="border-b border-slate-700 bg-slate-900/60 text-slate-400">
                      <th className="text-left py-2 px-3">Regime</th>
                      <th className="text-left py-2 px-3">Agent</th>
                      <th className="text-right py-2 px-3">Runs</th>
                      <th className="text-right py-2 px-3">Promotions</th>
                      <th className="text-right py-2 px-3">Promotion rate</th>
                      <th className="text-right py-2 px-3">Avg delta exp</th>
                      <th className="text-right py-2 px-3">Best</th>
                      <th className="text-right py-2 px-3">Worst</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboardRows.map(({ regime, agentType, row }) => (
                      <tr key={`${regime}-${agentType}`} className="border-b border-slate-800 hover:bg-slate-800/40">
                        <td className="py-2 px-3 text-slate-200">{regime}</td>
                        <td className="py-2 px-3 text-slate-300">{agentType}</td>
                        <td className="py-2 px-3 text-right text-slate-300">{row.runs}</td>
                        <td className="py-2 px-3 text-right text-slate-300">{row.promotions}</td>
                        <td className="py-2 px-3 text-right text-slate-300">{row.promotionRate}%</td>
                        <td className={`py-2 px-3 text-right font-mono ${(row.avgDeltaExpectancy ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {row.avgDeltaExpectancy >= 0 ? '+' : ''}{row.avgDeltaExpectancy}%
                        </td>
                        <td className="py-2 px-3 text-right text-slate-300">{row.bestDeltaExpectancy != null ? `${row.bestDeltaExpectancy >= 0 ? '+' : ''}${row.bestDeltaExpectancy}%` : '—'}</td>
                        <td className="py-2 px-3 text-right text-slate-300">{row.worstDeltaExpectancy != null ? `${row.worstDeltaExpectancy >= 0 ? '+' : ''}${row.worstDeltaExpectancy}%` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {harryData.sectorRsRankings?.length > 0 && (
            <div className="rounded-lg border border-slate-700 overflow-hidden">
              <div className="px-4 py-2 bg-slate-800/70 border-b border-slate-700 text-sm font-medium text-slate-200">
                Sector RS percentile ranking by ticker (top 30)
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[700px]">
                  <thead>
                    <tr className="border-b border-slate-700 bg-slate-900/60 text-slate-400">
                      <th className="text-left py-2 px-3">Ticker</th>
                      <th className="text-left py-2 px-3">Industry</th>
                      <th className="text-right py-2 px-3">Sector rank %</th>
                      <th className="text-right py-2 px-3">Sector RS percentile</th>
                    </tr>
                  </thead>
                  <tbody>
                    {harryData.sectorRsRankings.slice(0, 30).map((row) => (
                      <tr key={row.ticker} className="border-b border-slate-800 hover:bg-slate-800/40">
                        <td className="py-2 px-3 font-medium text-slate-200">{row.ticker}</td>
                        <td className="py-2 px-3 text-slate-300">{row.industry || '—'}</td>
                        <td className="py-2 px-3 text-right text-slate-300">{row.sectorRankPct != null ? `${row.sectorRankPct}%` : '—'}</td>
                        <td className="py-2 px-3 text-right text-emerald-400 font-mono">{row.sectorRsPercentile != null ? `${row.sectorRsPercentile}%` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 5-year backtest: prediction vs actual forward returns */}
      {(backtest?.spy || backtest?.qqq) && (
        <div className="space-y-6">
          <h2 className="text-xl font-semibold text-slate-100">5-year backtest: prediction vs actual returns</h2>
          <p className="text-slate-400 text-sm">
            For each day in the past 5 years, the model assigned a regime (bull/bear). This table compares that to what actually happened (forward 1d, 5d, 21d returns). Correlation measures how well the regime label lines up with realized returns.
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {backtest.spy && <BacktestSection label="SPY" backtest={backtest.spy} />}
            {backtest.qqq && <BacktestSection label="QQQ" backtest={backtest.qqq} />}
          </div>
        </div>
      )}
    </div>
  )
}
