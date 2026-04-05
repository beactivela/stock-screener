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

  const cmpBuy = (a: ConsensusTickerRow, b: ConsensusTickerRow) => {
    if (b.net !== a.net) return b.net - a.net
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
