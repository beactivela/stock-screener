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
  }
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
    let mark = Number(stockMarksByTicker[position.ticker]) || Number(position.entryPriceUsd) || 0
    if (position.instrumentType === 'option' && position.contractSymbol) {
      const optionMark = Number(optionMarksByContract[position.contractSymbol])
      if (Number.isFinite(optionMark) && optionMark > 0) mark = optionMark
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
  managerState.positions.push({
    id: `${candidate.strategy}-${candidate.ticker}-${Date.now()}`,
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
    ticker: candidate.ticker,
    strategy: candidate.strategy,
    quantity: candidate.quantity,
    markUsd: roundUsd(markUsd),
    status: 'filled',
  })
  managerState.recentTrades = managerState.recentTrades.slice(0, 100)
}

function managerSummaryRow(managerState, benchmark) {
  return {
    equityUsd: managerState.equityUsd,
    runningPnlUsd: managerState.runningPnlUsd,
    deployedUsd: managerState.deployedUsd,
    availableCashUsd: managerState.availableCashUsd,
    positions: managerState.positions,
    recentTrades: managerState.recentTrades,
    rejectedTrades: managerState.rejectedTrades,
    benchmark,
  }
}

export async function runAiPortfolioDailyCycle({
  state,
  asOfDate,
  suggestEntry,
  getStockMark,
  getOptionMark,
}) {
  const next = clone(state || createInitialAiPortfolioState({ asOfDate }))
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

    const suggestion = await suggestEntry({
      managerId,
      asOfDate: currentDate,
      managerState: clone(managerState),
    })
    if (!suggestion || suggestion.action === 'no_trade') continue

    const ticker = String(suggestion.ticker || '').toUpperCase()
    if (!ticker) continue
    const stockMark = await getStockMark(ticker)
    if (!stockMark?.ok || !Number.isFinite(stockMark.mark) || Number(stockMark.mark) <= 0) {
      managerState.rejectedTrades.unshift({
        at: isoNow(),
        ticker,
        strategy: 'stock',
        violations: [{ code: 'NO_MARK', message: 'Could not resolve live mark for ticker.' }],
      })
      managerState.rejectedTrades = managerState.rejectedTrades.slice(0, 50)
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
    if (!candidate.quantity || candidate.quantity <= 0) {
      managerState.rejectedTrades.unshift({
        at: isoNow(),
        ticker,
        strategy: 'stock',
        violations: [{ code: 'SIZE_ZERO', message: 'No valid position size under risk rules.' }],
      })
      managerState.rejectedTrades = managerState.rejectedTrades.slice(0, 50)
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
      continue
    }

    recordAcceptedTrade(managerState, candidate, fillMarkUsd, currentDate)
    updatePortfolioMarks({ portfolio: managerState, stockMarksByTicker, optionMarksByContract })
  }

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
  }
}

