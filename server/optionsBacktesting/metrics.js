function safeNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function round2(value) {
  return Math.round(safeNumber(value) * 100) / 100
}

export function computeMaxDrawdownPct(equityCurve = []) {
  let peak = null
  let maxDrawdown = 0
  for (const point of equityCurve) {
    const equity = safeNumber(point?.equity, null)
    if (!Number.isFinite(equity)) continue
    if (peak == null || equity > peak) peak = equity
    if (peak > 0) {
      const drawdown = ((peak - equity) / peak) * 100
      if (drawdown > maxDrawdown) maxDrawdown = drawdown
    }
  }
  return Math.round(maxDrawdown * 100) / 100
}

export function computeSharpeFromEquityCurve(equityCurve = []) {
  if (!Array.isArray(equityCurve) || equityCurve.length < 3) return 0
  const returns = []
  for (let i = 1; i < equityCurve.length; i += 1) {
    const prev = safeNumber(equityCurve[i - 1]?.equity, null)
    const current = safeNumber(equityCurve[i]?.equity, null)
    if (!Number.isFinite(prev) || !Number.isFinite(current) || prev <= 0) continue
    returns.push((current - prev) / prev)
  }
  if (returns.length < 2) return 0
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, returns.length - 1)
  const stdev = Math.sqrt(Math.max(variance, 0))
  if (stdev === 0) return 0
  return Math.round(((mean / stdev) * Math.sqrt(252)) * 100) / 100
}

export function computeCagrPct(equityCurve = []) {
  if (!Array.isArray(equityCurve) || equityCurve.length < 2) return 0
  const firstPoint = equityCurve[0]
  const lastPoint = equityCurve[equityCurve.length - 1]
  const startEquity = safeNumber(firstPoint?.equity, null)
  const endEquity = safeNumber(lastPoint?.equity, null)
  if (!Number.isFinite(startEquity) || !Number.isFinite(endEquity) || startEquity <= 0 || endEquity <= 0) return 0
  const startMs = Date.parse(`${firstPoint?.time}T12:00:00Z`)
  const endMs = Date.parse(`${lastPoint?.time}T12:00:00Z`)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0
  const years = (endMs - startMs) / (365.2425 * 24 * 60 * 60 * 1000)
  if (!Number.isFinite(years) || years <= 0) return 0
  return round2((Math.pow(endEquity / startEquity, 1 / years) - 1) * 100)
}

export function computeSetupMetrics({
  trades = [],
  equityCurve = [],
  initialCapital = 100000,
}) {
  const totalProfitUsd = trades.reduce((sum, trade) => sum + safeNumber(trade?.pnlUsd), 0)
  const winTrades = trades.filter((trade) => safeNumber(trade?.pnlUsd) > 0)
  const avgDaysHeld =
    trades.length > 0
      ? trades.reduce((sum, trade) => sum + safeNumber(trade?.daysHeld), 0) / trades.length
      : 0
  const avgTradeAnnualizedRoyPct =
    trades.length > 0
      ? trades.reduce((sum, trade) => sum + safeNumber(trade?.annualizedRoyPct), 0) / trades.length
      : 0
  const cagrPct = computeCagrPct(equityCurve)
  const sharpe = computeSharpeFromEquityCurve(equityCurve)

  return {
    totalProfitUsd: round2(totalProfitUsd),
    totalReturnPct: round2((totalProfitUsd / initialCapital) * 100),
    annualizedRoyPct: round2(avgTradeAnnualizedRoyPct),
    avgTradeAnnualizedRoyPct: round2(avgTradeAnnualizedRoyPct),
    cagrPct,
    maxDrawdownPct: computeMaxDrawdownPct(equityCurve),
    sharpe,
    sharpeDailyRf0: sharpe,
    winRatePct: trades.length > 0 ? round2((winTrades.length / trades.length) * 100) : 0,
    tradeCount: trades.length,
    avgDaysHeld: round2(avgDaysHeld),
  }
}
