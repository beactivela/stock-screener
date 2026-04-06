import {
  AI_PORTFOLIO_MAX_CONCENTRATION_PCT,
  AI_PORTFOLIO_MAX_DEPLOYED_PCT,
  AI_PORTFOLIO_MAX_RISK_PER_TRADE_PCT,
  AI_PORTFOLIO_MIN_CASH_PCT,
  roundUsd,
} from './types.js'

export function sumReservedCashUsd(positions = []) {
  return roundUsd(
    positions.reduce((sum, position) => sum + (Number(position?.reservedUsd) || 0), 0),
  )
}

function sumExposureByUnderlying(positions = []) {
  /** @type {Record<string, number>} */
  const exposureByUnderlying = {}
  for (const position of positions) {
    const key = String(position?.underlying || position?.ticker || '').toUpperCase()
    if (!key) continue
    exposureByUnderlying[key] = (exposureByUnderlying[key] || 0) + (Number(position?.exposureUsd) || 0)
  }
  return exposureByUnderlying
}

function sumExposureUsd(positions = []) {
  return roundUsd(positions.reduce((sum, p) => sum + (Number(p?.exposureUsd) || 0), 0))
}

export function buildPortfolioSnapshot({
  equityUsd,
  cashUsd,
  positions = [],
}) {
  const safePositions = Array.isArray(positions) ? positions : []
  return {
    equityUsd: Number(equityUsd) || 0,
    cashUsd: Number(cashUsd) || 0,
    positions: safePositions,
    deployedUsd: sumExposureUsd(safePositions),
    reservedUsd: sumReservedCashUsd(safePositions),
    exposureByUnderlying: sumExposureByUnderlying(safePositions),
  }
}

export function evaluateEntryRules({
  portfolio,
  candidate,
}) {
  const violations = []
  const equityUsd = Number(portfolio?.equityUsd) || 0
  const cashUsd = Number(portfolio?.cashUsd) || 0
  const deployedUsd = Number(portfolio?.deployedUsd) || 0
  const reservedUsd = Number(portfolio?.reservedUsd) || 0
  const exposureByUnderlying = portfolio?.exposureByUnderlying || {}

  const underlying = String(candidate?.underlying || candidate?.ticker || '').toUpperCase()
  const exposureUsd = Number(candidate?.exposureUsd) || 0
  const maxLossUsd = Number(candidate?.maxLossUsd) || 0
  const cashRequiredUsd = Number(candidate?.cashRequiredUsd) || 0
  const reservedCashDeltaUsd = Number(candidate?.reservedCashDeltaUsd) || 0
  const isUsMarket = candidate?.isUsMarket !== false
  const isLongOnly = candidate?.isLongOnly !== false

  const maxConcentrationUsd = equityUsd * (AI_PORTFOLIO_MAX_CONCENTRATION_PCT / 100)
  const maxRiskUsd = equityUsd * (AI_PORTFOLIO_MAX_RISK_PER_TRADE_PCT / 100)
  const maxDeployedUsd = equityUsd * (AI_PORTFOLIO_MAX_DEPLOYED_PCT / 100)
  const minCashUsd = equityUsd * (AI_PORTFOLIO_MIN_CASH_PCT / 100)
  const sameUnderlyingBefore = Number(exposureByUnderlying[underlying]) || 0
  const sameUnderlyingAfter = sameUnderlyingBefore + exposureUsd
  const deployedAfter = deployedUsd + exposureUsd
  const cashAfter = cashUsd - cashRequiredUsd
  const reservedAfter = reservedUsd + reservedCashDeltaUsd
  const availableCashAfter = cashAfter - reservedAfter

  if (!isUsMarket) violations.push({ code: 'US_ONLY', message: 'Only US-listed securities are allowed.' })
  if (!isLongOnly) violations.push({ code: 'LONG_ONLY', message: 'Only long exposure is allowed.' })
  if (sameUnderlyingAfter > maxConcentrationUsd) {
    violations.push({
      code: 'MAX_CONCENTRATION_10',
      message: `Max 10% concentration exceeded for ${underlying}.`,
    })
  }
  if (maxLossUsd > maxRiskUsd) {
    violations.push({
      code: 'MAX_RISK_2',
      message: 'Max 2% risk per trade exceeded.',
    })
  }
  if (deployedAfter > maxDeployedUsd) {
    violations.push({
      code: 'MAX_DEPLOYED_80',
      message: 'Max 80% deployed capital exceeded.',
    })
  }
  if (availableCashAfter < minCashUsd) {
    violations.push({
      code: 'MIN_CASH_20',
      message: 'Minimum 20% cash reserve would be breached.',
    })
  }

  return {
    ok: violations.length === 0,
    violations,
    metrics: {
      equityUsd: roundUsd(equityUsd),
      deployedAfterUsd: roundUsd(deployedAfter),
      availableCashAfterUsd: roundUsd(availableCashAfter),
      sameUnderlyingAfterUsd: roundUsd(sameUnderlyingAfter),
      maxRiskUsd: roundUsd(maxRiskUsd),
      maxLossUsd: roundUsd(maxLossUsd),
    },
  }
}

