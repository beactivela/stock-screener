/**
 * Consensus among top-K StockCircle experts: buy/sell tallies, optional performance/action weighting,
 * and a composite conviction score (0–100) with cross-source reinforcement.
 * Pure helpers — safe to unit test without React or API.
 */

export interface ExpertWeightLike {
  investorSlug: string
  firmName: string
  displayName: string
  performance1yPct: number | null
  /** Cumulative % from StockCircle performance page when synced. */
  performance3yPct?: number | null
  performance5yPct?: number | null
  performance10yPct?: number | null
  /** Estimated position notional (USD) for this ticker when synced. */
  positionValueUsd?: number | null
  /** StockCircle-reported % of portfolio for this holding when available. */
  pctOfPortfolio?: number | null
  actionType: string
}

export interface PopularRowLike {
  ticker: string
}

export interface ExpertLeaderboardRow {
  investorSlug: string
  firmName: string
  displayName: string
  performance1yPct: number | null
  performance3yPct: number | null
  performance5yPct: number | null
  performance10yPct: number | null
}

/** Breakdown of the composite conviction score (each component 0–100 before weighting). */
export interface ConvictionFactors {
  /** max(buy,sell votes) / effectiveTopK → scaled to 0–100 */
  overlapBreadth: number
  /** Avg % of portfolio on dominant side, mapped to 0–100 */
  positionConviction: number
  /** Avg blended trailing performance of experts on dominant side (capped 0–100) */
  performanceSignal: number
  /** Avg action-strength multiplier on dominant side / 1.5 → 0–100 */
  actionStrength: number
}

export interface ConsensusExpertRef {
  investorSlug: string
  firmName: string
  displayName: string
  positionValueUsd: number | null
  pctOfPortfolio: number | null
  /** StockCircle action for this chip (e.g. new_holding, increased). */
  actionType?: string
  /** True when this holding equals the expert’s max % of portfolio across the synced book. */
  isTopHolding?: boolean
}

export interface ConsensusTickerRow {
  ticker: string
  buyVotes: number
  sellVotes: number
  /** Unweighted: buyVotes - sellVotes */
  net: number
  /** When weightByPerformance: sum of performance weights on buy-side; else same as buyVotes (unless action strength) */
  weightedBuy: number
  weightedSell: number
  /** weightedBuy - weightedSell */
  weightedNet: number
  buyers: ConsensusExpertRef[]
  sellers: ConsensusExpertRef[]
  /** Number of experts in the voting panel for this run (min(topK, universe size)). */
  effectiveTopK: number
  /** Average % of portfolio among buy-side experts in the panel (null if no buyers). */
  avgBuyerPctOfPortfolio: number | null
  /** Average % of portfolio among sell-side experts in the panel (null if no sellers). */
  avgSellerPctOfPortfolio: number | null
  /** Composite 0–100 after cross-source multipliers (same as beforeCrossSource if no flags). */
  convictionScore: number
  /** Composite before WhaleWisdom / Congress multipliers. */
  convictionScoreBeforeCrossSource: number
  convictionFactors: ConvictionFactors
  crossSourceWhalewisdom: boolean
  crossSourceCongress: boolean
}

/** UI column keys for client-side consensus table sorting (`ConsensusTable`). */
export type ConsensusSortKey =
  | 'ticker'
  | 'conviction'
  | 'buyVotes'
  | 'sellVotes'
  | 'net'
  /** Net buy USD minus sell USD among the row’s expert chips */
  | 'dollarNet'
  | 'bulls'
  | 'bears'

export interface ExpertConsensusOptions {
  /** Max experts in the voting panel; effective = min(this, universe size). Default 15. */
  topK: number
  /** Require max(buyVotes, sellVotes) >= minVotes to include a row in buy/sell lists (default 1). */
  minVotes: number
  /** If true, weight each vote by performance (blended or 1Y — see useBlendedPerformanceForVoteWeight). */
  weightByPerformance: boolean
  /** If true (default), use 0.5·1Y + 0.3·3Y + 0.2·5Y when those fields exist; else fall back to 1Y-only. */
  useBlendedPerformanceForVoteWeight: boolean
  /** If true (default), rank experts for the panel by blended performance instead of 1Y-only. */
  sortExpertsByBlendedPerformance: boolean
  /** Scale weighted tallies by action type (new 1.5×, add 1.0×, trim 1.0×, sold 1.5×). Default true. */
  useActionStrengthInWeightedTallies: boolean
  /** Optional per-ticker flags from API: overlap with WhaleWisdom 13F book and/or Congress disclosures. */
  crossSourceByTicker?: Record<string, { whalewisdom: boolean; congress: boolean }>
}

/** Default max panel size (plan: up to 15 elite experts). */
export const DEFAULT_CONSENSUS_TOP_K_CAP = 15

/** Weights for additive composite (cross-source applied separately). Must sum to 1. */
export const CONVICTION_WEIGHTS = {
  overlapBreadth: 0.25,
  positionConviction: 0.3,
  performanceSignal: 0.2,
  actionStrength: 0.15,
} as const

export const CROSS_SOURCE_WHALE_MULTIPLIER = 1.2
export const CROSS_SOURCE_CONGRESS_MULTIPLIER = 1.1

/** Minimum position USD (inclusive) to highlight a buy-side expert chip in the consensus UI. */
export const CONSENSUS_LARGE_BUY_USD = 50_000_000

export function isConsensusLargeBuyChip(
  variant: 'buy' | 'sell',
  positionValueUsd: number | null | undefined
): boolean {
  return (
    variant === 'buy' &&
    positionValueUsd != null &&
    Number.isFinite(positionValueUsd) &&
    positionValueUsd >= CONSENSUS_LARGE_BUY_USD
  )
}

const BUY_ACTIONS = new Set(['new_holding', 'increased'])
const SELL_ACTIONS = new Set(['decreased', 'sold'])

function normTicker(t: string): string {
  return String(t || '')
    .trim()
    .toUpperCase()
}

/**
 * Blended trailing performance: 0.5·1Y + 0.3·3Y + 0.2·5Y with fallbacks when some horizons are missing.
 * Exported for tests and UI tooltips.
 */
export function blendedPerformanceMetric(w: ExpertWeightLike): number | null {
  const p1 = w.performance1yPct
  const p3 = w.performance3yPct
  const p5 = w.performance5yPct
  const ok = (p: unknown): p is number => p != null && Number.isFinite(Number(p))
  const n1 = ok(p1) ? Number(p1) : null
  const n3 = ok(p3) ? Number(p3) : null
  const n5 = ok(p5) ? Number(p5) : null
  if (n1 != null && n3 != null && n5 != null) return 0.5 * n1 + 0.3 * n3 + 0.2 * n5
  if (n1 != null && n3 != null) return 0.625 * n1 + 0.375 * n3
  if (n1 != null && n5 != null) return (5 / 7) * n1 + (2 / 7) * n5
  if (n3 != null && n5 != null) return 0.6 * n3 + 0.4 * n5
  if (n1 != null) return n1
  if (n3 != null) return n3
  if (n5 != null) return n5
  return null
}

/** Sort key for expert panel: blended perf desc, then 1Y, nulls last, firm name tie-break. */
function expertSortKey(
  w: ExpertWeightLike,
  sortByBlended: boolean
): { primary: number; secondary: number; firm: string } {
  const blended = sortByBlended ? blendedPerformanceMetric(w) : null
  const y1 = w.performance1yPct
  const primary =
    sortByBlended && blended != null && Number.isFinite(blended)
      ? blended
      : y1 != null && Number.isFinite(y1)
        ? y1
        : Number.NEGATIVE_INFINITY
  const secondary = y1 != null && Number.isFinite(y1) ? y1 : Number.NEGATIVE_INFINITY
  return { primary, secondary, firm: w.firmName || '' }
}

/**
 * Per-expert max % of portfolio across all tickers (for “top holding” flag).
 */
export function buildExpertMaxPctByPortfolio(
  expertWeightsByTicker: Record<string, ExpertWeightLike[]>
): Map<string, number> {
  const m = new Map<string, number>()
  for (const tk of Object.keys(expertWeightsByTicker)) {
    for (const w of expertWeightsByTicker[tk] ?? []) {
      const slug = w.investorSlug
      const pct = w.pctOfPortfolio
      if (pct == null || !Number.isFinite(pct)) continue
      const cur = m.get(slug)
      if (cur == null || pct > cur) m.set(slug, pct)
    }
  }
  return m
}

/**
 * Unique experts appearing on popular tickers, sorted for the consensus panel.
 */
export function buildSortedExpertUniverse(
  popular: PopularRowLike[],
  expertWeightsByTicker: Record<string, ExpertWeightLike[]>,
  opts: { sortByBlendedPerformance?: boolean } = {}
): ExpertLeaderboardRow[] {
  const sortByBlended = opts.sortByBlendedPerformance !== false
  const m = new Map<string, ExpertLeaderboardRow & { _sort: ReturnType<typeof expertSortKey> }>()
  for (const row of popular) {
    const tk = normTicker(row.ticker)
    const list = expertWeightsByTicker[tk] ?? expertWeightsByTicker[row.ticker] ?? []
    for (const w of list) {
      if (!m.has(w.investorSlug)) {
        m.set(w.investorSlug, {
          investorSlug: w.investorSlug,
          firmName: w.firmName,
          displayName: w.displayName,
          performance1yPct: w.performance1yPct,
          performance3yPct: w.performance3yPct ?? null,
          performance5yPct: w.performance5yPct ?? null,
          performance10yPct: w.performance10yPct ?? null,
          _sort: expertSortKey(w, sortByBlended),
        })
      }
    }
  }
  return [...m.entries()]
    .sort((a, b) => {
      const sa = a[1]._sort
      const sb = b[1]._sort
      if (sb.primary !== sa.primary) return sb.primary - sa.primary
      if (sb.secondary !== sa.secondary) return sb.secondary - sa.secondary
      return sa.firm.localeCompare(sb.firm, undefined, { sensitivity: 'base' })
    })
    .map(([, meta]) => {
      const { _sort: _, ...rest } = meta
      return rest
    })
}

function classifyAction(actionType: string): 'buy' | 'sell' | 'none' {
  if (BUY_ACTIONS.has(actionType)) return 'buy'
  if (SELL_ACTIONS.has(actionType)) return 'sell'
  return 'none'
}

/**
 * Buy: new_holding 1.5, increased 1.0. Sell: decreased 1.0, sold 1.5 (magnitude on sell side).
 */
export function actionStrengthMultiplier(actionType: string, side: 'buy' | 'sell'): number {
  const a = String(actionType || '')
  if (side === 'buy') {
    if (a === 'new_holding') return 1.5
    if (a === 'increased') return 1.0
    return 1.0
  }
  if (a === 'sold') return 1.5
  if (a === 'decreased') return 1.0
  return 1.0
}

function voteWeight(
  w: ExpertWeightLike,
  weightByPerformance: boolean,
  useBlended: boolean
): number {
  if (!weightByPerformance) return 1
  const p = useBlended ? blendedPerformanceMetric(w) : w.performance1yPct
  if (p == null || !Number.isFinite(p)) return 0
  return Math.max(0, p)
}

function refFromWeight(
  w: ExpertWeightLike,
  maxPctBySlug: Map<string, number>
): ConsensusExpertRef {
  const slug = w.investorSlug
  const pct = w.pctOfPortfolio
  const maxP = maxPctBySlug.get(slug)
  const isTop =
    pct != null &&
    Number.isFinite(pct) &&
    maxP != null &&
    Number.isFinite(maxP) &&
    Math.abs(pct - maxP) < 1e-6
  return {
    investorSlug: slug,
    firmName: w.firmName,
    displayName: w.displayName,
    positionValueUsd: w.positionValueUsd ?? null,
    pctOfPortfolio: w.pctOfPortfolio ?? null,
    actionType: w.actionType,
    isTopHolding: isTop,
  }
}

/**
 * Effective panel size: never larger than universe.
 */
export function computeEffectiveTopK(universeLength: number, requestedTopK: number): number {
  if (universeLength <= 0) return 0
  return Math.min(Math.max(1, requestedTopK), universeLength)
}

/**
 * Map avg % of portfolio on dominant side to 0–100 (20% avg → ~100).
 */
export function positionConvictionNormalized(avgPct: number | null): number {
  if (avgPct == null || !Number.isFinite(avgPct) || avgPct <= 0) return 0
  return Math.min(100, (avgPct / 20) * 100)
}

/**
 * Composite conviction before cross-source multipliers.
 */
export function computeConvictionComposite(input: {
  buyVotes: number
  sellVotes: number
  effectiveTopK: number
  avgBuyerPct: number | null
  avgSellerPct: number | null
  buyerPerfAvg: number | null
  sellerPerfAvg: number | null
  buyerActionAvg: number | null
  sellerActionAvg: number | null
}): { score: number; factors: ConvictionFactors } {
  const {
    buyVotes,
    sellVotes,
    effectiveTopK,
    avgBuyerPct,
    avgSellerPct,
    buyerPerfAvg,
    sellerPerfAvg,
    buyerActionAvg,
    sellerActionAvg,
  } = input

  const dominantIsBuy = buyVotes >= sellVotes
  const maxVotes = Math.max(buyVotes, sellVotes)
  const overlapBreadth =
    effectiveTopK > 0 ? Math.min(100, (maxVotes / effectiveTopK) * 100) : 0

  const avgPct = dominantIsBuy ? avgBuyerPct : avgSellerPct
  const positionConviction = positionConvictionNormalized(avgPct)

  const perfAvg = dominantIsBuy ? buyerPerfAvg : sellerPerfAvg
  let performanceSignal = 0
  if (perfAvg != null && Number.isFinite(perfAvg)) {
    performanceSignal = Math.min(100, Math.max(0, perfAvg))
  }

  const actionAvg = dominantIsBuy ? buyerActionAvg : sellerActionAvg
  let actionStrength = 0
  if (actionAvg != null && Number.isFinite(actionAvg) && actionAvg > 0) {
    actionStrength = Math.min(100, (actionAvg / 1.5) * 100)
  }

  const { overlapBreadth: w1, positionConviction: w2, performanceSignal: w3, actionStrength: w4 } =
    CONVICTION_WEIGHTS
  const score =
    w1 * overlapBreadth + w2 * positionConviction + w3 * performanceSignal + w4 * actionStrength

  return {
    score,
    factors: {
      overlapBreadth,
      positionConviction,
      performanceSignal,
      actionStrength,
    },
  }
}

function applyCrossSource(score: number, ww: boolean, congress: boolean): number {
  let s = score
  if (ww) s *= CROSS_SOURCE_WHALE_MULTIPLIER
  if (congress) s *= CROSS_SOURCE_CONGRESS_MULTIPLIER
  return Math.min(100, s)
}

const defaultOptions: ExpertConsensusOptions = {
  topK: DEFAULT_CONSENSUS_TOP_K_CAP,
  minVotes: 1,
  weightByPerformance: true,
  useBlendedPerformanceForVoteWeight: true,
  sortExpertsByBlendedPerformance: true,
  useActionStrengthInWeightedTallies: true,
  crossSourceByTicker: undefined,
}

/**
 * Per-ticker consensus among the top-K experts (by buildSortedExpertUniverse order).
 */
export function computeTickerConsensusRows(
  popular: PopularRowLike[],
  expertWeightsByTicker: Record<string, ExpertWeightLike[]>,
  opts: Partial<ExpertConsensusOptions> = {}
): ConsensusTickerRow[] {
  const {
    topK,
    minVotes,
    weightByPerformance,
    useBlendedPerformanceForVoteWeight,
    sortExpertsByBlendedPerformance,
    useActionStrengthInWeightedTallies,
    crossSourceByTicker,
  } = { ...defaultOptions, ...opts }

  const sortByBlended = sortExpertsByBlendedPerformance !== false
  const useBlended = useBlendedPerformanceForVoteWeight !== false
  const useAction = useActionStrengthInWeightedTallies !== false
  const maxPctBySlug = buildExpertMaxPctByPortfolio(expertWeightsByTicker)

  const universe = buildSortedExpertUniverse(popular, expertWeightsByTicker, {
    sortByBlendedPerformance: sortByBlended,
  })
  const effectiveTopK = computeEffectiveTopK(universe.length, topK)
  const selected = universe.slice(0, Math.max(0, effectiveTopK))
  const slugSet = new Set(selected.map((e) => e.investorSlug))

  const rows: ConsensusTickerRow[] = []

  for (const pop of popular) {
    const tk = normTicker(pop.ticker)
    const weights = expertWeightsByTicker[tk] ?? expertWeightsByTicker[pop.ticker] ?? []

    let buyVotes = 0
    let sellVotes = 0
    let weightedBuy = 0
    let weightedSell = 0
    const buyers: ConsensusExpertRef[] = []
    const sellers: ConsensusExpertRef[] = []
    /** For conviction: sums for averages on each side */
    let buyerPerfSum = 0
    let buyerPerfN = 0
    let sellerPerfSum = 0
    let sellerPerfN = 0
    let buyerActionSum = 0
    let buyerActionN = 0
    let sellerActionSum = 0
    let sellerActionN = 0

    for (const w of weights) {
      if (!slugSet.has(w.investorSlug)) continue
      const side = classifyAction(w.actionType)
      if (side === 'none') continue

      const vw = voteWeight(w, weightByPerformance, useBlended)
      const am = actionStrengthMultiplier(w.actionType, side)
      const baseW = weightByPerformance ? vw : 1
      const wMult = useAction ? baseW * am : baseW
      const r = refFromWeight(w, maxPctBySlug)
      const bp = blendedPerformanceMetric(w)

      if (side === 'buy') {
        buyVotes += 1
        weightedBuy += wMult
        buyers.push(r)
        if (bp != null && Number.isFinite(bp)) {
          buyerPerfSum += bp
          buyerPerfN += 1
        }
        buyerActionSum += am
        buyerActionN += 1
      } else {
        sellVotes += 1
        weightedSell += wMult
        sellers.push(r)
        if (bp != null && Number.isFinite(bp)) {
          sellerPerfSum += bp
          sellerPerfN += 1
        }
        sellerActionSum += am
        sellerActionN += 1
      }
    }

    const net = buyVotes - sellVotes
    const weightedNet = weightedBuy - weightedSell

    const maxSide = Math.max(buyVotes, sellVotes)
    if (maxSide < minVotes) continue

    const avgBuyerPct =
      buyers.length > 0
        ? buyers.reduce((s, b) => s + (b.pctOfPortfolio ?? 0), 0) / buyers.length
        : null
    const avgSellerPct =
      sellers.length > 0
        ? sellers.reduce((s, x) => s + (x.pctOfPortfolio ?? 0), 0) / sellers.length
        : null

    const buyerPerfAvg = buyerPerfN > 0 ? buyerPerfSum / buyerPerfN : null
    const sellerPerfAvg = sellerPerfN > 0 ? sellerPerfSum / sellerPerfN : null
    const buyerActionAvg = buyerActionN > 0 ? buyerActionSum / buyerActionN : null
    const sellerActionAvg = sellerActionN > 0 ? sellerActionSum / sellerActionN : null

    const { score: rawComposite, factors } = computeConvictionComposite({
      buyVotes,
      sellVotes,
      effectiveTopK,
      avgBuyerPct,
      avgSellerPct,
      buyerPerfAvg,
      sellerPerfAvg,
      buyerActionAvg,
      sellerActionAvg,
    })

    const cs = crossSourceByTicker?.[tk] ?? crossSourceByTicker?.[pop.ticker]
    const crossSourceWhalewisdom = Boolean(cs?.whalewisdom)
    const crossSourceCongress = Boolean(cs?.congress)
    const convictionScore = applyCrossSource(rawComposite, crossSourceWhalewisdom, crossSourceCongress)

    rows.push({
      ticker: tk,
      buyVotes,
      sellVotes,
      net,
      weightedBuy,
      weightedSell,
      weightedNet,
      buyers,
      sellers,
      effectiveTopK,
      avgBuyerPctOfPortfolio: avgBuyerPct != null && Number.isFinite(avgBuyerPct) ? avgBuyerPct : null,
      avgSellerPctOfPortfolio: avgSellerPct != null && Number.isFinite(avgSellerPct) ? avgSellerPct : null,
      convictionScore,
      convictionScoreBeforeCrossSource: rawComposite,
      convictionFactors: factors,
      crossSourceWhalewisdom,
      crossSourceCongress,
    })
  }

  return rows
}

/**
 * Sum of reported buy-side position USD for a ticker row (null/NaN ignored).
 */
export function sumConsensusBuyerPositionUsd(row: ConsensusTickerRow): number {
  let s = 0
  for (const b of row.buyers) {
    const v = b.positionValueUsd
    if (v != null && Number.isFinite(v)) s += v
  }
  return s
}

/**
 * Sum of reported sell-side position USD (null/NaN ignored).
 */
export function sumConsensusSellerPositionUsd(row: ConsensusTickerRow): number {
  let s = 0
  for (const x of row.sellers) {
    const v = x.positionValueUsd
    if (v != null && Number.isFinite(v)) s += v
  }
  return s
}

/**
 * Buy notional minus sell notional for experts in this row (same top-K cohort as chips).
 */
export function netConsensusPositionUsd(row: ConsensusTickerRow): number {
  return sumConsensusBuyerPositionUsd(row) - sumConsensusSellerPositionUsd(row)
}

function consensusSortComparable(
  row: ConsensusTickerRow,
  key: ConsensusSortKey,
  weightVotesByPerformance: boolean
): string | number {
  switch (key) {
    case 'ticker':
      return row.ticker
    case 'conviction':
      return row.convictionScore
    case 'buyVotes':
      return row.buyVotes
    case 'sellVotes':
      return row.sellVotes
    case 'net':
      return weightVotesByPerformance ? row.weightedNet : row.net
    case 'dollarNet':
      return netConsensusPositionUsd(row)
    case 'bulls':
      return row.buyers.length
    case 'bears':
      return row.sellers.length
    default: {
      const _exhaustive: never = key
      return _exhaustive
    }
  }
}

/**
 * Stable client-side sort for consensus ticker rows (tie-break: ticker A–Z).
 */
export function sortConsensusTickerRows(
  rows: ConsensusTickerRow[],
  key: ConsensusSortKey,
  dir: 'asc' | 'desc',
  weightVotesByPerformance: boolean
): ConsensusTickerRow[] {
  return [...rows].sort((a, b) => {
    const va = consensusSortComparable(a, key, weightVotesByPerformance)
    const vb = consensusSortComparable(b, key, weightVotesByPerformance)
    let cmp: number
    if (typeof va === 'string' && typeof vb === 'string') {
      cmp = va.localeCompare(vb, undefined, { sensitivity: 'base' })
    } else {
      cmp = (va as number) - (vb as number)
    }
    if (cmp !== 0) return dir === 'asc' ? cmp : -cmp
    return a.ticker.localeCompare(b.ticker, undefined, { sensitivity: 'base' })
  })
}

/**
 * Total reported position USD across buy- and sell-side experts in this row
 * (same top-K cohort as the chips).
 */
export function sumConsensusTotalPositionUsd(row: ConsensusTickerRow): number {
  return sumConsensusBuyerPositionUsd(row) + sumConsensusSellerPositionUsd(row)
}

/**
 * Split into buy-leaning, sell-leaning, and neutral tickers; sort as in the plan.
 */
export function splitConsensusByNet(rows: ConsensusTickerRow[]): {
  buyLeaning: ConsensusTickerRow[]
  sellLeaning: ConsensusTickerRow[]
  mixed: ConsensusTickerRow[]
} {
  const buyLeaning: ConsensusTickerRow[] = []
  const sellLeaning: ConsensusTickerRow[] = []
  const mixed: ConsensusTickerRow[] = []

  for (const r of rows) {
    if (r.net > 0) buyLeaning.push(r)
    else if (r.net < 0) sellLeaning.push(r)
    else mixed.push(r)
  }

  /** Buy-lean: more expert buys first, then higher total buy-side $ (reported positions), then ticker. */
  const cmpBuy = (a: ConsensusTickerRow, b: ConsensusTickerRow) => {
    if (b.buyVotes !== a.buyVotes) return b.buyVotes - a.buyVotes
    const usdA = sumConsensusBuyerPositionUsd(a)
    const usdB = sumConsensusBuyerPositionUsd(b)
    if (usdB !== usdA) return usdB - usdA
    return a.ticker.localeCompare(b.ticker)
  }
  const cmpSell = (a: ConsensusTickerRow, b: ConsensusTickerRow) => {
    if (a.net !== b.net) return a.net - b.net
    return a.ticker.localeCompare(b.ticker)
  }

  buyLeaning.sort(cmpBuy)
  sellLeaning.sort(cmpSell)
  mixed.sort((a, b) => a.ticker.localeCompare(b.ticker))

  return { buyLeaning, sellLeaning, mixed }
}

/** Bucket conviction score for color classes (UI). */
export function convictionScoreBucket(score: number): 'high' | 'medium' | 'low' {
  if (score >= 80) return 'high'
  if (score >= 50) return 'medium'
  return 'low'
}

/**
 * Sync freshness: compare latest run finished_at to now.
 */
export function syncFreshnessLabel(finishedAtIso: string | null | undefined): {
  label: 'Fresh' | 'Recent' | 'Stale' | 'Unknown'
  days: number | null
} {
  if (!finishedAtIso || !String(finishedAtIso).trim()) return { label: 'Unknown', days: null }
  const t = Date.parse(finishedAtIso)
  if (!Number.isFinite(t)) return { label: 'Unknown', days: null }
  const days = (Date.now() - t) / (24 * 60 * 60 * 1000)
  if (days <= 7) return { label: 'Fresh', days }
  if (days <= 30) return { label: 'Recent', days }
  return { label: 'Stale', days }
}
