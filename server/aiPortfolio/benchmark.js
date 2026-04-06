import { AI_PORTFOLIO_TARGET_OUTPERFORMANCE_PCT, roundUsd } from './types.js'

export function computeReturnPct({ startValue, currentValue }) {
  const start = Number(startValue) || 0
  const current = Number(currentValue) || 0
  if (start <= 0) return 0
  return Math.round(((current - start) / start) * 10000) / 100
}

export function computeOutperformancePct({ managerReturnPct, spyReturnPct }) {
  const diff = (Number(managerReturnPct) || 0) - (Number(spyReturnPct) || 0)
  return Math.round(diff * 100) / 100
}

export function isOutperformanceTargetMet({
  outperformancePct,
  targetPct = AI_PORTFOLIO_TARGET_OUTPERFORMANCE_PCT,
}) {
  return (Number(outperformancePct) || 0) >= (Number(targetPct) || 0)
}

export function summarizeBenchmarkProgress({
  startingCapitalUsd,
  currentEquityUsd,
  spyStartPrice,
  spyCurrentPrice,
  targetOutperformancePct = AI_PORTFOLIO_TARGET_OUTPERFORMANCE_PCT,
}) {
  const managerReturnPct = computeReturnPct({
    startValue: startingCapitalUsd,
    currentValue: currentEquityUsd,
  })
  const spyReturnPct = computeReturnPct({
    startValue: spyStartPrice,
    currentValue: spyCurrentPrice,
  })
  const outperformancePct = computeOutperformancePct({ managerReturnPct, spyReturnPct })
  return {
    managerReturnPct,
    spyReturnPct,
    outperformancePct,
    targetOutperformancePct,
    targetMet: isOutperformanceTargetMet({
      outperformancePct,
      targetPct: targetOutperformancePct,
    }),
    equityUsd: roundUsd(currentEquityUsd),
  }
}

