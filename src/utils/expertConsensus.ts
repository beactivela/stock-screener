/**
 * Consensus among top-K StockCircle experts by 1Y performance: buy/sell vote tallies per ticker.
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

export interface ConsensusExpertRef {
  investorSlug: string
  firmName: string
  displayName: string
  positionValueUsd: number | null
  pctOfPortfolio: number | null
}

export interface ConsensusTickerRow {
  ticker: string
  buyVotes: number
  sellVotes: number
  /** Unweighted: buyVotes - sellVotes */
  net: number
  /** When weightByPerformance: sum of max(0, performance1yPct) on buy-side votes; else same as buyVotes */
  weightedBuy: number
  weightedSell: number
  /** weightedBuy - weightedSell */
  weightedNet: number
  buyers: ConsensusExpertRef[]
  sellers: ConsensusExpertRef[]
}

/** UI column keys for client-side consensus table sorting (`ConsensusTable`). */
export type ConsensusSortKey =
  | 'ticker'
  | 'buyVotes'
  | 'sellVotes'
  | 'net'
  /** Net buy USD minus sell USD among the row’s expert chips */
  | 'dollarNet'
  | 'bulls'
  | 'bears'

export interface ExpertConsensusOptions {
  /** Experts considered for voting: first K from performance-sorted universe (default 10). */
  topK: number
  /** Require max(buyVotes, sellVotes) >= minVotes to include a row in buy/sell lists (default 1). */
  minVotes: number
  /** If true, each vote counts by max(0, performance1yPct); experts with null/invalid perf contribute 0 in weighted tallies. */
  weightByPerformance: boolean
}

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
 * Unique experts appearing on popular tickers, sorted like StockcircleExperts `expertRows`:
 * performance1yPct descending; nulls last; tie-break firm name.
 */
export function buildSortedExpertUniverse(
  popular: PopularRowLike[],
  expertWeightsByTicker: Record<string, ExpertWeightLike[]>
): ExpertLeaderboardRow[] {
  const m = new Map<string, ExpertLeaderboardRow>()
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
        })
      }
    }
  }
  return [...m.entries()]
    .sort((a, b) => {
      const pa = a[1].performance1yPct
      const pb = b[1].performance1yPct
      const aHas = pa != null && Number.isFinite(pa)
      const bHas = pb != null && Number.isFinite(pb)
      if (aHas && bHas && pb !== pa) return (pb as number) - (pa as number)
      if (aHas !== bHas) return aHas ? -1 : 1
      return a[1].firmName.localeCompare(b[1].firmName, undefined, { sensitivity: 'base' })
    })
    .map(([, meta]) => meta)
}

function voteWeight(perf: number | null, weightByPerformance: boolean): number {
  if (!weightByPerformance) return 1
  if (perf == null || !Number.isFinite(perf)) return 0
  return Math.max(0, perf)
}

function refFromWeight(w: ExpertWeightLike): ConsensusExpertRef {
  return {
    investorSlug: w.investorSlug,
    firmName: w.firmName,
    displayName: w.displayName,
    positionValueUsd: w.positionValueUsd ?? null,
    pctOfPortfolio: w.pctOfPortfolio ?? null,
  }
}

function classifyAction(actionType: string): 'buy' | 'sell' | 'none' {
  if (BUY_ACTIONS.has(actionType)) return 'buy'
  if (SELL_ACTIONS.has(actionType)) return 'sell'
  return 'none'
}

const defaultOptions: ExpertConsensusOptions = {
  topK: 10,
  minVotes: 1,
  weightByPerformance: false,
}

/**
 * Per-ticker consensus among the top-K experts (by buildSortedExpertUniverse order).
 */
export function computeTickerConsensusRows(
  popular: PopularRowLike[],
  expertWeightsByTicker: Record<string, ExpertWeightLike[]>,
  opts: Partial<ExpertConsensusOptions> = {}
): ConsensusTickerRow[] {
  const { topK, minVotes, weightByPerformance } = { ...defaultOptions, ...opts }
  const universe = buildSortedExpertUniverse(popular, expertWeightsByTicker)
  const selected = universe.slice(0, Math.max(0, topK))
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

    for (const w of weights) {
      if (!slugSet.has(w.investorSlug)) continue
      const side = classifyAction(w.actionType)
      if (side === 'none') continue

      const vw = voteWeight(w.performance1yPct, weightByPerformance)
      const r = refFromWeight(w)

      if (side === 'buy') {
        buyVotes += 1
        weightedBuy += weightByPerformance ? vw : 1
        buyers.push(r)
      } else {
        sellVotes += 1
        weightedSell += weightByPerformance ? vw : 1
        sellers.push(r)
      }
    }

    const net = buyVotes - sellVotes
    const weightedNet = weightedBuy - weightedSell

    const maxSide = Math.max(buyVotes, sellVotes)
    if (maxSide < minVotes) continue

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
    })
  }

  return rows
}

/**
 * Sum of reported buy-side position USD for a ticker row (null/NaN ignored).
 * Used to sort consensus tables by cumulative expert dollars on the buy side.
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
 * (same top-K cohort as the chips). Use for “total notional” per ticker.
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
