import {
  AI_PORTFOLIO_BENCHMARK_TICKER,
  AI_PORTFOLIO_MANAGER_IDS,
  AI_PORTFOLIO_STARTING_CAPITAL_USD,
  roundUsd,
} from './types.js'
import { summarizeBenchmarkProgress } from './benchmark.js'
import { buildPortfolioSnapshot, evaluateEntryRules, sumReservedCashUsd } from './riskRules.js'

function isoNow() {
  return new Date().toISOString()
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function defaultManagerState(managerId) {
  return {
    managerId,
    cashUsd: AI_PORTFOLIO_STARTING_CAPITAL_USD,
    availableCashUsd: AI_PORTFOLIO_STARTING_CAPITAL_USD,
    realizedPnlUsd: 0,
    unrealizedPnlUsd: 0,
    runningPnlUsd: 0,
    equityUsd: AI_PORTFOLIO_STARTING_CAPITAL_USD,
    deployedUsd: 0,
    positions: [],
    recentTrades: [],
    rejectedTrades: [],
    /** @type {null | Record<string, unknown>} */
    lastLlmInsight: null,
  }
}

/**
 * @param {unknown} result
 * @returns {{ suggestion: object, llm: object | null, usage: object | null }}
 */
export function normalizeSuggestPayload(result) {
  if (result && typeof result === 'object' && result.suggestion && typeof result.suggestion === 'object') {
    return {
      suggestion: result.suggestion,
      llm: result.llm && typeof result.llm === 'object' ? result.llm : null,
      usage: result.usage && typeof result.usage === 'object' ? result.usage : null,
    }
  }
  return {
    suggestion: result && typeof result === 'object' ? result : { action: 'no_trade', reason: 'invalid' },
    llm: null,
    usage: null,
  }
}

/** Merge this run's OpenRouter spend into `state.openRouterDailyCosts` (by calendar date, sums multiple runs/day). */
function mergeOpenRouterDailyCost(state, date, addedTotalUsd, addedByManager) {
  const add = Number(addedTotalUsd) || 0
  const keys = Object.keys(addedByManager || {}).filter((k) => (Number(addedByManager[k]) || 0) > 0)
  if (add <= 0 && keys.length === 0) return

  const arr = Array.isArray(state.openRouterDailyCosts) ? [...state.openRouterDailyCosts] : []
  const i = arr.findIndex((x) => x && x.date === date)
  const prev = i >= 0 ? arr[i] : null
  const prevBy =
    prev?.byManager && typeof prev.byManager === 'object' && !Array.isArray(prev.byManager)
      ? { ...prev.byManager }
      : {}
  for (const [k, v] of Object.entries(addedByManager || {})) {
    const n = Number(v) || 0
    if (n <= 0) continue
    prevBy[k] = roundUsd((Number(prevBy[k]) || 0) + n)
  }
  const newTotal = roundUsd((prev ? Number(prev.costUsd) || 0 : 0) + add)
  const row = { date, costUsd: newTotal, byManager: prevBy }
  if (i >= 0) arr[i] = row
  else arr.push(row)
  arr.sort((a, b) => String(a.date).localeCompare(String(b.date)))
  while (arr.length > 420) arr.shift()
  state.openRouterDailyCosts = arr
}

export function createInitialAiPortfolioState({ asOfDate }) {
  /** @type {Record<string, any>} */
  const managers = {}
  for (const managerId of AI_PORTFOLIO_MANAGER_IDS) {
    managers[managerId] = defaultManagerState(managerId)
  }
  return {
    createdAt: isoNow(),
    updatedAt: isoNow(),
    lastRunDate: asOfDate || null,
    benchmark: {
      ticker: AI_PORTFOLIO_BENCHMARK_TICKER,
      startPrice: null,
      currentPrice: null,
      asOf: null,
    },
    managers,
    equityDaily: [],
    runs: [],
    /** @type {Array<{ date: string, costUsd: number, byManager: Record<string, number> }>} */
    openRouterDailyCosts: [],
  }
}

function updatePortfolioMarks({
  portfolio,
  stockMarksByTicker,
  optionMarksByContract,
}) {
  let unrealized = 0
  let deployed = 0
  for (const position of portfolio.positions) {
    let mark = 0
    if (position.instrumentType === 'option') {
      // Never value options off the underlying stock mark: keep prior/entry premium
      // when a fresh contract quote is unavailable.
      mark = Number(position.markUsd) || Number(position.entryPriceUsd) || 0
      if (position.contractSymbol) {
        const optionMark = Number(optionMarksByContract[position.contractSymbol])
        if (Number.isFinite(optionMark) && optionMark > 0) mark = optionMark
      }
    } else {
      mark = Number(stockMarksByTicker[position.ticker]) || Number(position.entryPriceUsd) || 0
    }
    position.markUsd = roundUsd(mark)
    if (position.instrumentType === 'stock') {
      position.unrealizedPnlUsd = roundUsd((mark - position.entryPriceUsd) * position.quantity)
      position.exposureUsd = roundUsd(mark * position.quantity)
    } else {
      const contracts = Number(position.quantity) || 0
      const entryCredit = Number(position.entryCreditUsd) || 0
      if (position.strategy === 'cash_secured_put') {
        position.unrealizedPnlUsd = roundUsd((entryCredit - mark) * contracts * 100)
        position.exposureUsd = roundUsd(Number(position.reservedUsd) || 0)
      } else if (position.strategy === 'bull_put_spread') {
        position.unrealizedPnlUsd = roundUsd((entryCredit - mark) * contracts * 100)
        position.exposureUsd = roundUsd(Number(position.reservedUsd) || 0)
      } else {
        position.unrealizedPnlUsd = roundUsd((mark - position.entryPriceUsd) * contracts * 100)
        position.exposureUsd = roundUsd(mark * contracts * 100)
      }
    }
    unrealized += Number(position.unrealizedPnlUsd) || 0
    deployed += Number(position.exposureUsd) || 0
  }
  const reservedUsd = sumReservedCashUsd(portfolio.positions)
  portfolio.unrealizedPnlUsd = roundUsd(unrealized)
  portfolio.runningPnlUsd = roundUsd((portfolio.realizedPnlUsd || 0) + portfolio.unrealizedPnlUsd)
  portfolio.equityUsd = roundUsd(AI_PORTFOLIO_STARTING_CAPITAL_USD + portfolio.runningPnlUsd)
  portfolio.deployedUsd = roundUsd(deployed)
  portfolio.availableCashUsd = roundUsd((portfolio.cashUsd || 0) - reservedUsd)
}

function computeEntryNotionalUsd(candidate, markUsd) {
  const qty = Number(candidate?.quantity) || 0
  const mark = Number(markUsd) || 0
  const instrumentType = String(candidate?.instrumentType || 'stock').toLowerCase()
  const strategy = String(candidate?.strategy || '').toLowerCase()
  if (instrumentType === 'stock') return roundUsd(qty * mark)
  if (strategy === 'cash_secured_put' || strategy === 'bull_put_spread') {
    const credit = Number(candidate?.entryCreditUsd || mark) || 0
    return roundUsd(qty * credit * 100)
  }
  return roundUsd(qty * mark * 100)
}

function computeExitNotionalUsd(position, markUsd) {
  const qty = Number(position?.quantity) || 0
  const mark = Number(markUsd) || 0
  const instrumentType = String(position?.instrumentType || 'stock').toLowerCase()
  if (instrumentType === 'stock') return roundUsd(qty * mark)
  return roundUsd(qty * mark * 100)
}

function buildStockCandidate({
  suggestion,
  managerState,
  markUsd,
}) {
  const equityUsd = Number(managerState.equityUsd) || AI_PORTFOLIO_STARTING_CAPITAL_USD
  const stopLossPct = Math.max(0.01, Number(suggestion.stopLossPct) || 0.08)
  const maxExposureUsd = equityUsd * 0.1
  const maxRiskUsd = equityUsd * 0.02
  const availableForTradeUsd = Math.max(0, Number(managerState.availableCashUsd) - equityUsd * 0.2)
  const deployBudgetUsd = Math.max(0, Math.min(maxExposureUsd, availableForTradeUsd))

  let quantity = Number(suggestion.quantity) || 0
  if (!Number.isFinite(quantity) || quantity <= 0) {
    const byExposure = Math.floor(deployBudgetUsd / markUsd)
    const byRisk = Math.floor(maxRiskUsd / (markUsd * stopLossPct))
    quantity = Math.max(0, Math.min(byExposure, byRisk))
  }
  const exposureUsd = roundUsd(quantity * markUsd)
  const maxLossUsd = roundUsd(exposureUsd * stopLossPct)
  return {
    quantity,
    ticker: String(suggestion.ticker || '').toUpperCase(),
    underlying: String(suggestion.ticker || '').toUpperCase(),
    instrumentType: 'stock',
    strategy: 'stock',
    exposureUsd,
    cashRequiredUsd: exposureUsd,
    reservedCashDeltaUsd: 0,
    maxLossUsd,
    stopLossPct,
    isUsMarket: true,
    isLongOnly: true,
  }
}

function buildOptionCandidate({
  suggestion,
  managerState,
  markUsd,
}) {
  const strategy = String(suggestion.strategy || '').toLowerCase()
  const equityUsd = Number(managerState.equityUsd) || AI_PORTFOLIO_STARTING_CAPITAL_USD
  const maxExposureUsd = equityUsd * 0.1
  const maxRiskUsd = equityUsd * 0.02
  const availableForTradeUsd = Math.max(0, Number(managerState.availableCashUsd) - equityUsd * 0.2)
  const ticker = String(suggestion.ticker || '').toUpperCase()

  if (strategy === 'long_call' || strategy === 'leap_call') {
    const debitPerContract = roundUsd(markUsd * 100)
    let contracts = Number(suggestion.quantity) || 0
    if (!contracts) {
      const byExposure = Math.floor(maxExposureUsd / debitPerContract)
      const byRisk = Math.floor(maxRiskUsd / debitPerContract)
      const byCash = Math.floor(availableForTradeUsd / debitPerContract)
      contracts = Math.max(0, Math.min(byExposure, byRisk, byCash))
    }
    const totalDebit = roundUsd(debitPerContract * contracts)
    return {
      quantity: contracts,
      ticker,
      underlying: ticker,
      instrumentType: 'option',
      strategy,
      contractSymbol: suggestion.contractSymbol,
      exposureUsd: totalDebit,
      cashRequiredUsd: totalDebit,
      reservedCashDeltaUsd: 0,
      maxLossUsd: totalDebit,
      isUsMarket: true,
      isLongOnly: true,
    }
  }

  if (strategy === 'cash_secured_put') {
    const strike = Number(suggestion.strike) || 0
    const creditPerContract = roundUsd(markUsd * 100)
    if (!strike || strike <= 0) return null
    let contracts = Number(suggestion.quantity) || 0
    const collateralPerContract = roundUsd(strike * 100)
    const maxLossPerContract = roundUsd(Math.max(0, collateralPerContract - creditPerContract))
    if (!contracts) {
      const byConcentration = Math.floor(maxExposureUsd / collateralPerContract)
      const byRisk = Math.floor(maxRiskUsd / Math.max(1, maxLossPerContract))
      contracts = Math.max(0, Math.min(byConcentration, byRisk))
    }
    const collateral = roundUsd(collateralPerContract * contracts)
    const credit = roundUsd(creditPerContract * contracts)
    const maxLoss = roundUsd(maxLossPerContract * contracts)
    return {
      quantity: contracts,
      ticker,
      underlying: ticker,
      instrumentType: 'option',
      strategy,
      contractSymbol: suggestion.contractSymbol,
      exposureUsd: collateral,
      cashRequiredUsd: roundUsd(-credit),
      reservedCashDeltaUsd: collateral,
      maxLossUsd: maxLoss,
      entryCreditUsd: markUsd,
      isUsMarket: true,
      isLongOnly: true,
    }
  }

  if (strategy === 'bull_put_spread') {
    const shortStrike = Number(suggestion.shortStrike) || 0
    const longStrike = Number(suggestion.longStrike) || 0
    const width = shortStrike - longStrike
    if (width <= 0) return null
    const netCreditPerContract = roundUsd((Number(suggestion.netCreditUsd) || markUsd) * 100)
    const maxLossPerContract = roundUsd(Math.max(0, width * 100 - netCreditPerContract))
    let contracts = Number(suggestion.quantity) || 0
    if (!contracts) {
      const byConcentration = Math.floor(maxExposureUsd / Math.max(1, maxLossPerContract))
      const byRisk = Math.floor(maxRiskUsd / Math.max(1, maxLossPerContract))
      contracts = Math.max(0, Math.min(byConcentration, byRisk))
    }
    const reserved = roundUsd(maxLossPerContract * contracts)
    const credit = roundUsd(netCreditPerContract * contracts)
    return {
      quantity: contracts,
      ticker,
      underlying: ticker,
      instrumentType: 'option',
      strategy,
      contractSymbol: suggestion.contractSymbol,
      exposureUsd: reserved,
      cashRequiredUsd: roundUsd(-credit),
      reservedCashDeltaUsd: reserved,
      maxLossUsd: reserved,
      entryCreditUsd: roundUsd(netCreditPerContract / 100),
      isUsMarket: true,
      isLongOnly: true,
    }
  }
  return null
}

function recordRejectedTrade(managerState, candidate, evaluation) {
  managerState.rejectedTrades.unshift({
    at: isoNow(),
    ticker: candidate?.ticker || null,
    strategy: candidate?.strategy || null,
    violations: evaluation.violations,
    metrics: evaluation.metrics,
  })
  managerState.rejectedTrades = managerState.rejectedTrades.slice(0, 50)
}

function recordAcceptedTrade(managerState, candidate, markUsd, asOfDate) {
  const positionId = `${candidate.strategy}-${candidate.ticker}-${Date.now()}`
  managerState.positions.push({
    id: positionId,
    ticker: candidate.ticker,
    underlying: candidate.underlying,
    instrumentType: candidate.instrumentType,
    strategy: candidate.strategy,
    quantity: candidate.quantity,
    entryPriceUsd: roundUsd(markUsd),
    entryCreditUsd: roundUsd(candidate.entryCreditUsd || 0),
    contractSymbol: candidate.contractSymbol || null,
    markUsd: roundUsd(markUsd),
    exposureUsd: roundUsd(candidate.exposureUsd),
    maxLossUsd: roundUsd(candidate.maxLossUsd),
    reservedUsd: roundUsd(candidate.reservedCashDeltaUsd || 0),
    openedAt: asOfDate,
    pricingMode: 'live',
    dataFreshness: 'live',
    unrealizedPnlUsd: 0,
  })
  managerState.cashUsd = roundUsd((managerState.cashUsd || 0) - (candidate.cashRequiredUsd || 0))
  managerState.recentTrades.unshift({
    at: isoNow(),
    entryAt: asOfDate || null,
    exitAt: null,
    positionId,
    ticker: candidate.ticker,
    strategy: candidate.strategy,
    instrumentType: candidate.instrumentType || 'stock',
    side: 'buy',
    quantity: candidate.quantity,
    markUsd: roundUsd(markUsd),
    notionalUsd: computeEntryNotionalUsd(candidate, markUsd),
    realizedPnlUsd: 0,
    status: 'filled',
  })
  managerState.recentTrades = managerState.recentTrades.slice(0, 100)
}

function findPositionForExit(managerState, suggestion) {
  const positions = Array.isArray(managerState.positions) ? managerState.positions : []
  if (suggestion.exitPositionId) {
    return positions.find((p) => p.id === suggestion.exitPositionId) || null
  }
  const t = String(suggestion.exitTicker || '').toUpperCase()
  if (!t) return null
  const matches = positions.filter((p) => String(p.ticker || '').toUpperCase() === t)
  if (matches.length === 0) return null
  if (matches.length === 1) return matches[0]
  const sym = suggestion.exitContractSymbol ? String(suggestion.exitContractSymbol).trim() : ''
  if (!sym) return null
  return matches.find((p) => String(p.contractSymbol || '') === sym) || null
}

/**
 * Close one position at `markUsd` (per-share for stock; per-contract premium for options).
 * Call only after `updatePortfolioMarks` so `unrealizedPnlUsd` is current.
 */
function applyPositionExit(managerState, pos, markUsd) {
  const mark = roundUsd(Number(markUsd) || 0)
  const qty = Number(pos.quantity) || 0
  const strategy = String(pos.strategy || '').toLowerCase()
  const inst = String(pos.instrumentType || '').toLowerCase()
  const realizedDelta = roundUsd(Number(pos.unrealizedPnlUsd) || 0)
  const exitAt = isoNow()

  if (inst === 'stock') {
    managerState.cashUsd = roundUsd((managerState.cashUsd || 0) + qty * mark)
  } else if (strategy === 'long_call' || strategy === 'leap_call') {
    managerState.cashUsd = roundUsd((managerState.cashUsd || 0) + qty * mark * 100)
  } else if (strategy === 'cash_secured_put' || strategy === 'bull_put_spread') {
    const buyback = roundUsd(qty * mark * 100)
    managerState.cashUsd = roundUsd((managerState.cashUsd || 0) - buyback + (Number(pos.reservedUsd) || 0))
  } else {
    return { ok: false, message: `unsupported strategy for exit: ${strategy}` }
  }

  managerState.realizedPnlUsd = roundUsd((managerState.realizedPnlUsd || 0) + realizedDelta)
  const idx = managerState.positions.indexOf(pos)
  if (idx >= 0) managerState.positions.splice(idx, 1)
  managerState.recentTrades.unshift({
    at: exitAt,
    entryAt: pos.openedAt || null,
    exitAt,
    positionId: pos.id || null,
    ticker: pos.ticker,
    strategy: pos.strategy,
    instrumentType: pos.instrumentType || 'stock',
    side: 'sell',
    quantity: qty,
    markUsd: mark,
    notionalUsd: computeExitNotionalUsd(pos, mark),
    realizedPnlUsd: realizedDelta,
    status: 'closed',
  })
  managerState.recentTrades = managerState.recentTrades.slice(0, 100)
  return { ok: true }
}

function managerSummaryRow(managerState, benchmark) {
  return {
    equityUsd: managerState.equityUsd,
    runningPnlUsd: managerState.runningPnlUsd,
    deployedUsd: managerState.deployedUsd,
    /** Ledger cash (includes collateral pools; see availableCashUsd for deployable). */
    cashUsd: managerState.cashUsd,
    availableCashUsd: managerState.availableCashUsd,
    positions: managerState.positions,
    recentTrades: managerState.recentTrades,
    rejectedTrades: managerState.rejectedTrades,
    lastLlmInsight: managerState.lastLlmInsight || null,
    benchmark,
  }
}

export async function runAiPortfolioDailyCycle({
  state,
  asOfDate,
  suggestEntry,
  getStockMark,
  getOptionMark,
  /** @type {(p: { managerId: string }) => void | Promise<void>} */
  onManagerLlmStart,
  /** @type {(p: { managerId: string, suggestion: object, llm: object | null }) => void | Promise<void>} */
  onManagerLlmComplete,
  /** @type {(p: { managerId: string, insight: Record<string, unknown> }) => void | Promise<void>} */
  onManagerIterationEnd,
}) {
  const next = clone(state || createInitialAiPortfolioState({ asOfDate }))
  if (!Array.isArray(next.openRouterDailyCosts)) next.openRouterDailyCosts = []
  const currentDate = asOfDate || new Date().toISOString().slice(0, 10)
  const runId = `ai_portfolio_${Date.now()}`

  const stockMarksByTicker = {}
  const spyMarkResult = await getStockMark(AI_PORTFOLIO_BENCHMARK_TICKER)
  if (spyMarkResult?.ok) {
    next.benchmark.currentPrice = Number(spyMarkResult.mark)
    next.benchmark.asOf = spyMarkResult.asOf || isoNow()
    if (next.benchmark.startPrice == null) {
      next.benchmark.startPrice = Number(spyMarkResult.mark)
    }
  }

  let runOpenRouterUsd = 0
  /** @type {Record<string, number>} */
  const runOpenRouterByManager = {}

  for (const managerId of AI_PORTFOLIO_MANAGER_IDS) {
    const managerState = next.managers[managerId] || defaultManagerState(managerId)
    next.managers[managerId] = managerState

    // Mark existing positions first so sizing uses the latest equity.
    for (const pos of managerState.positions) {
      if (!stockMarksByTicker[pos.ticker]) {
        const mark = await getStockMark(pos.ticker)
        if (mark?.ok) stockMarksByTicker[pos.ticker] = Number(mark.mark)
      }
    }
    const optionMarksByContract = {}
    for (const pos of managerState.positions) {
      if (pos.instrumentType !== 'option' || !pos.contractSymbol) continue
      const optMark = await getOptionMark({
        ticker: pos.ticker,
        contractSymbol: pos.contractSymbol,
      })
      if (optMark?.ok) optionMarksByContract[pos.contractSymbol] = Number(optMark.mark)
    }
    updatePortfolioMarks({ portfolio: managerState, stockMarksByTicker, optionMarksByContract })

    await onManagerLlmStart?.({ managerId })
    const suggestRaw = await suggestEntry({
      managerId,
      asOfDate: currentDate,
      managerState: clone(managerState),
    })
    const { suggestion: suggestionIn, llm, usage } = normalizeSuggestPayload(suggestRaw)
    const suggestion = { ...suggestionIn }
    if (suggestion._hold) delete suggestion._hold

    const callCost = usage?.costUsd != null && Number.isFinite(Number(usage.costUsd)) ? Number(usage.costUsd) : null
    if (callCost != null && callCost > 0) {
      runOpenRouterUsd += callCost
      runOpenRouterByManager[managerId] = (runOpenRouterByManager[managerId] || 0) + callCost
    }

    await onManagerLlmComplete?.({ managerId, suggestion, llm })

    let openedNewPosition = false
    let executionNote = ''

    if (!suggestion || suggestion.action === 'no_trade') {
      executionNote =
        llm?.actionIntent === 'hold'
          ? 'Model chose hold — no new entry; existing positions unchanged by this run.'
          : llm?.actionIntent === 'error'
            ? `Model call failed or returned invalid JSON. ${llm?.errorMessage || ''}`.trim()
            : llm?.actionIntent === 'exit_invalid'
              ? 'Model chose exit but the payload was incomplete (use exitPositionId or exitTicker; for options add exitContractSymbol if several lines share a ticker).'
              : suggestion?.reason === 'exit_missing_target'
                ? 'Model chose exit but did not specify which line to close.'
                : 'Model passed on a new entry for today (no_trade / risk off).'
      managerState.lastLlmInsight = {
        asOfDate: currentDate,
        thesis: llm?.thesis || '',
        portfolioReview: llm?.portfolioReview || '',
        entryThesis: llm?.entryThesis || '',
        entryConviction: llm?.entryConviction || '',
        rawText: llm?.rawText || '',
        positionStance: llm?.positionStance || '',
        actionIntent: llm?.actionIntent || 'pass',
        model: llm?.model || '',
        parseOk: llm?.parseOk !== false,
        openedNewPosition: false,
        executionNote,
        errorMessage: llm?.errorMessage || null,
        costUsd: llm?.costUsd ?? null,
      }
      await onManagerIterationEnd?.({ managerId, insight: managerState.lastLlmInsight })
      continue
    }

    if (suggestion.action === 'exit') {
      const pos = findPositionForExit(managerState, suggestion)
      if (!pos) {
        executionNote =
          'Rejected: exit — no matching open position for exitPositionId / exitTicker (for options use exitContractSymbol when multiple lines share a ticker).'
        managerState.lastLlmInsight = {
          asOfDate: currentDate,
          thesis: llm?.thesis || '',
          portfolioReview: llm?.portfolioReview || '',
          entryThesis: llm?.entryThesis || '',
          entryConviction: llm?.entryConviction || '',
          rawText: llm?.rawText || '',
          positionStance: llm?.positionStance || '',
          actionIntent: llm?.actionIntent || 'exit',
          model: llm?.model || '',
          parseOk: llm?.parseOk !== false,
          openedNewPosition: false,
          executionNote,
          errorMessage: llm?.errorMessage || null,
          costUsd: llm?.costUsd ?? null,
        }
        await onManagerIterationEnd?.({ managerId, insight: managerState.lastLlmInsight })
        continue
      }

      let exitMark = null
      if (pos.instrumentType === 'option' && pos.contractSymbol) {
        const om = await getOptionMark({ ticker: pos.ticker, contractSymbol: pos.contractSymbol })
        exitMark = om?.ok ? Number(om.mark) : null
      } else {
        const sm = await getStockMark(pos.ticker)
        exitMark = sm?.ok ? Number(sm.mark) : null
      }
      if (!exitMark || exitMark <= 0) {
        executionNote = 'Rejected: could not load a live mark to close the position.'
        managerState.lastLlmInsight = {
          asOfDate: currentDate,
          thesis: llm?.thesis || '',
          portfolioReview: llm?.portfolioReview || '',
          entryThesis: llm?.entryThesis || '',
          entryConviction: llm?.entryConviction || '',
          rawText: llm?.rawText || '',
          positionStance: llm?.positionStance || '',
          actionIntent: llm?.actionIntent || 'exit',
          model: llm?.model || '',
          parseOk: llm?.parseOk !== false,
          openedNewPosition: false,
          executionNote,
          errorMessage: llm?.errorMessage || null,
          costUsd: llm?.costUsd ?? null,
        }
        await onManagerIterationEnd?.({ managerId, insight: managerState.lastLlmInsight })
        continue
      }

      const exitRes = applyPositionExit(managerState, pos, exitMark)
      if (!exitRes.ok) {
        executionNote = `Rejected: ${exitRes.message || 'could not close position'}.`
        managerState.lastLlmInsight = {
          asOfDate: currentDate,
          thesis: llm?.thesis || '',
          portfolioReview: llm?.portfolioReview || '',
          entryThesis: llm?.entryThesis || '',
          entryConviction: llm?.entryConviction || '',
          rawText: llm?.rawText || '',
          positionStance: llm?.positionStance || '',
          actionIntent: llm?.actionIntent || 'exit',
          model: llm?.model || '',
          parseOk: llm?.parseOk !== false,
          openedNewPosition: false,
          executionNote,
          errorMessage: llm?.errorMessage || null,
          costUsd: llm?.costUsd ?? null,
        }
        await onManagerIterationEnd?.({ managerId, insight: managerState.lastLlmInsight })
        continue
      }

      if (pos.instrumentType === 'option' && pos.contractSymbol) {
        delete optionMarksByContract[pos.contractSymbol]
      }
      updatePortfolioMarks({ portfolio: managerState, stockMarksByTicker, optionMarksByContract })
      executionNote = `Closed ${pos.ticker} (${pos.strategy}) at modeled mark.`
      managerState.lastLlmInsight = {
        asOfDate: currentDate,
        thesis: llm?.thesis || '',
        portfolioReview: llm?.portfolioReview || '',
        entryThesis: llm?.entryThesis || '',
        entryConviction: llm?.entryConviction || '',
        rawText: llm?.rawText || '',
        positionStance: llm?.positionStance || '',
        actionIntent: llm?.actionIntent || 'exit',
        model: llm?.model || '',
        parseOk: llm?.parseOk !== false,
        openedNewPosition: false,
        executionNote,
        errorMessage: llm?.errorMessage || null,
        costUsd: llm?.costUsd ?? null,
      }
      await onManagerIterationEnd?.({ managerId, insight: managerState.lastLlmInsight })
      continue
    }

    const ticker = String(suggestion.ticker || '').toUpperCase()
    if (!ticker) {
      executionNote = 'Rejected: model returned enter without a valid ticker.'
      managerState.lastLlmInsight = {
        asOfDate: currentDate,
        thesis: llm?.thesis || '',
        portfolioReview: llm?.portfolioReview || '',
        entryThesis: llm?.entryThesis || '',
        entryConviction: llm?.entryConviction || '',
        rawText: llm?.rawText || '',
        positionStance: llm?.positionStance || '',
        actionIntent: llm?.actionIntent || 'enter',
        model: llm?.model || '',
        parseOk: llm?.parseOk !== false,
        openedNewPosition: false,
        executionNote,
        costUsd: llm?.costUsd ?? null,
      }
      await onManagerIterationEnd?.({ managerId, insight: managerState.lastLlmInsight })
      continue
    }
    const stockMark = await getStockMark(ticker)
    if (!stockMark?.ok || !Number.isFinite(stockMark.mark) || Number(stockMark.mark) <= 0) {
      executionNote = 'Rejected: could not load a live Yahoo mark for the proposed ticker.'
      managerState.rejectedTrades.unshift({
        at: isoNow(),
        ticker,
        strategy: 'stock',
        violations: [{ code: 'NO_MARK', message: 'Could not resolve live mark for ticker.' }],
      })
      managerState.rejectedTrades = managerState.rejectedTrades.slice(0, 50)
      managerState.lastLlmInsight = {
        asOfDate: currentDate,
        thesis: llm?.thesis || '',
        portfolioReview: llm?.portfolioReview || '',
        entryThesis: llm?.entryThesis || '',
        entryConviction: llm?.entryConviction || '',
        rawText: llm?.rawText || '',
        positionStance: llm?.positionStance || '',
        actionIntent: llm?.actionIntent || 'enter',
        model: llm?.model || '',
        parseOk: llm?.parseOk !== false,
        openedNewPosition: false,
        executionNote,
        costUsd: llm?.costUsd ?? null,
      }
      await onManagerIterationEnd?.({ managerId, insight: managerState.lastLlmInsight })
      continue
    }

    stockMarksByTicker[ticker] = Number(stockMark.mark)
    let candidate = null
    let fillMarkUsd = Number(stockMark.mark)
    const instrumentType = String(suggestion.instrumentType || 'stock').toLowerCase()
    if (instrumentType === 'stock') {
      candidate = buildStockCandidate({
        suggestion,
        managerState,
        markUsd: Number(stockMark.mark),
      })
    } else {
      const optionMark = await getOptionMark({
        ticker,
        contractSymbol: suggestion.contractSymbol,
      })
      const inferredMark = optionMark?.ok ? Number(optionMark.mark) : Number(suggestion.premiumUsd || suggestion.netCreditUsd || 0)
      fillMarkUsd = inferredMark
      candidate = buildOptionCandidate({
        suggestion,
        managerState,
        markUsd: inferredMark,
      })
      if (candidate && optionMark?.ok && candidate.contractSymbol) {
        optionMarksByContract[candidate.contractSymbol] = Number(optionMark.mark)
      }
    }
    if (!candidate || !candidate.quantity || candidate.quantity <= 0) {
      executionNote = !candidate
        ? 'Rejected: could not build a stock/option candidate from the model fields (check strategy & marks).'
        : 'Rejected: position size computed to zero under 10% / 2% / cash rules.'
      managerState.rejectedTrades.unshift({
        at: isoNow(),
        ticker,
        strategy: 'stock',
        violations: [{ code: 'SIZE_ZERO', message: 'No valid position size under risk rules.' }],
      })
      managerState.rejectedTrades = managerState.rejectedTrades.slice(0, 50)
      managerState.lastLlmInsight = {
        asOfDate: currentDate,
        thesis: llm?.thesis || '',
        portfolioReview: llm?.portfolioReview || '',
        entryThesis: llm?.entryThesis || '',
        entryConviction: llm?.entryConviction || '',
        rawText: llm?.rawText || '',
        positionStance: llm?.positionStance || '',
        actionIntent: llm?.actionIntent || 'enter',
        model: llm?.model || '',
        parseOk: llm?.parseOk !== false,
        openedNewPosition: false,
        executionNote,
        costUsd: llm?.costUsd ?? null,
      }
      await onManagerIterationEnd?.({ managerId, insight: managerState.lastLlmInsight })
      continue
    }

    const snapshot = buildPortfolioSnapshot({
      equityUsd: managerState.equityUsd,
      cashUsd: managerState.cashUsd,
      positions: managerState.positions,
    })
    const evaluation = evaluateEntryRules({ portfolio: snapshot, candidate })
    if (!evaluation.ok) {
      recordRejectedTrade(managerState, candidate, evaluation)
      const v0 = evaluation.violations?.[0]
      executionNote = `Rejected by risk engine: ${v0 ? `${v0.code} — ${v0.message}` : 'rule violation'}`
      managerState.lastLlmInsight = {
        asOfDate: currentDate,
        thesis: llm?.thesis || '',
        portfolioReview: llm?.portfolioReview || '',
        entryThesis: llm?.entryThesis || '',
        entryConviction: llm?.entryConviction || '',
        rawText: llm?.rawText || '',
        positionStance: llm?.positionStance || '',
        actionIntent: llm?.actionIntent || 'enter',
        model: llm?.model || '',
        parseOk: llm?.parseOk !== false,
        openedNewPosition: false,
        executionNote,
        costUsd: llm?.costUsd ?? null,
      }
      await onManagerIterationEnd?.({ managerId, insight: managerState.lastLlmInsight })
      continue
    }

    recordAcceptedTrade(managerState, candidate, fillMarkUsd, currentDate)
    openedNewPosition = true
    executionNote = `Filled new ${candidate.instrumentType} ${candidate.strategy} on ${ticker} (qty ${candidate.quantity}).`
    updatePortfolioMarks({ portfolio: managerState, stockMarksByTicker, optionMarksByContract })
    managerState.lastLlmInsight = {
      asOfDate: currentDate,
      thesis: llm?.thesis || '',
      portfolioReview: llm?.portfolioReview || '',
      entryThesis: llm?.entryThesis || '',
      entryConviction: llm?.entryConviction || '',
      rawText: llm?.rawText || '',
      positionStance: llm?.positionStance || '',
      actionIntent: llm?.actionIntent || 'enter',
      model: llm?.model || '',
      parseOk: llm?.parseOk !== false,
      openedNewPosition,
      executionNote,
      costUsd: llm?.costUsd ?? null,
    }
    await onManagerIterationEnd?.({ managerId, insight: managerState.lastLlmInsight })
  }

  mergeOpenRouterDailyCost(next, currentDate, runOpenRouterUsd, runOpenRouterByManager)

  const summaryManagers = {}
  for (const managerId of AI_PORTFOLIO_MANAGER_IDS) {
    const managerState = next.managers[managerId]
    const benchmark = summarizeBenchmarkProgress({
      startingCapitalUsd: AI_PORTFOLIO_STARTING_CAPITAL_USD,
      currentEquityUsd: managerState.equityUsd,
      spyStartPrice: next.benchmark.startPrice || next.benchmark.currentPrice || 1,
      spyCurrentPrice: next.benchmark.currentPrice || next.benchmark.startPrice || 1,
    })
    summaryManagers[managerId] = managerSummaryRow(managerState, benchmark)
    next.equityDaily.push({
      date: currentDate,
      managerId,
      equityUsd: managerState.equityUsd,
      runningPnlUsd: managerState.runningPnlUsd,
      spyReturnPct: benchmark.spyReturnPct,
      outperformancePct: benchmark.outperformancePct,
    })
  }

  next.lastRunDate = currentDate
  next.updatedAt = isoNow()
  next.runs.unshift({
    id: runId,
    asOfDate: currentDate,
    completedAt: isoNow(),
    status: 'completed',
  })
  next.runs = next.runs.slice(0, 200)

  return {
    runId,
    state: next,
    summary: {
      ok: true,
      asOfDate: currentDate,
      benchmark: next.benchmark,
      managers: summaryManagers,
      openRouterDailyCosts: next.openRouterDailyCosts || [],
    },
  }
}

export function buildAiPortfolioSummary(state) {
  const safe = state || createInitialAiPortfolioState({ asOfDate: null })
  const managers = {}
  for (const managerId of AI_PORTFOLIO_MANAGER_IDS) {
    const managerState = safe.managers?.[managerId] || defaultManagerState(managerId)
    const benchmark = summarizeBenchmarkProgress({
      startingCapitalUsd: AI_PORTFOLIO_STARTING_CAPITAL_USD,
      currentEquityUsd: managerState.equityUsd,
      spyStartPrice: safe.benchmark?.startPrice || safe.benchmark?.currentPrice || 1,
      spyCurrentPrice: safe.benchmark?.currentPrice || safe.benchmark?.startPrice || 1,
    })
    managers[managerId] = managerSummaryRow(managerState, benchmark)
  }
  return {
    ok: true,
    asOfDate: safe.lastRunDate,
    benchmark: safe.benchmark,
    managers,
    equityDaily: safe.equityDaily || [],
    openRouterDailyCosts: safe.openRouterDailyCosts || [],
  }
}

