/**
 * Turtle signal helpers (Donchian breakout + ATR risk).
 * Long-only per system configuration.
 */

export function computeATR(bars, period = 20) {
  if (!Array.isArray(bars) || bars.length === 0) return []

  const trueRanges = bars.map((bar, i) => {
    if (i === 0) return (bar.h ?? 0) - (bar.l ?? 0)
    const prevClose = bars[i - 1]?.c ?? bar.c ?? 0
    const high = bar.h ?? bar.c ?? 0
    const low = bar.l ?? bar.c ?? 0
    return Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    )
  })

  const atr = new Array(bars.length).fill(null)
  if (bars.length < period) return atr

  const first = trueRanges.slice(0, period).reduce((sum, v) => sum + v, 0) / period
  atr[period - 1] = round2(first)

  for (let i = period; i < trueRanges.length; i++) {
    const prev = atr[i - 1] ?? first
    const next = ((prev * (period - 1)) + trueRanges[i]) / period
    atr[i] = round2(next)
  }

  return atr
}

export function donchianHigh(bars, period, index) {
  if (index == null || index < period) return null
  let max = -Infinity
  for (let i = index - period; i < index; i++) {
    const h = bars[i]?.h ?? bars[i]?.c ?? -Infinity
    if (h > max) max = h
  }
  return max === -Infinity ? null : max
}

export function donchianLow(bars, period, index) {
  if (index == null || index < period) return null
  let min = Infinity
  for (let i = index - period; i < index; i++) {
    const l = bars[i]?.l ?? bars[i]?.c ?? Infinity
    if (l < min) min = l
  }
  return min === Infinity ? null : min
}

export function detectBreakout(bars, index, period) {
  const priorHigh = donchianHigh(bars, period, index)
  if (priorHigh == null) return false
  const high = bars[index]?.h ?? bars[index]?.c ?? null
  return high != null && high > priorHigh
}

export function simulateTurtleTrade({
  bars,
  entryIndex,
  system = 'S1',
  atrPeriod = 20,
  stopMultiple = 2,
  exitLookback = system === 'S2' ? 20 : 10,
  maxHoldDays = 120,
}) {
  if (!bars || bars.length === 0 || entryIndex == null) {
    return { exitType: 'NO_DATA', returnPct: 0, holdingDays: 0 }
  }
  if (entryIndex >= bars.length - 1) {
    return { exitType: 'NO_DATA', returnPct: 0, holdingDays: 0 }
  }

  const atr = computeATR(bars, atrPeriod)
  const n = atr[entryIndex]
  if (n == null || n <= 0) {
    return { exitType: 'NO_DATA', returnPct: 0, holdingDays: 0 }
  }

  const entryBar = bars[entryIndex]
  const entryPrice = entryBar?.c ?? entryBar?.o ?? 0
  const stopPrice = entryPrice - stopMultiple * n

  let maxGain = 0
  let maxDrawdown = 0

  const lastIdx = Math.min(bars.length - 1, entryIndex + maxHoldDays)
  for (let i = entryIndex + 1; i <= lastIdx; i++) {
    const bar = bars[i]
    const close = bar?.c ?? entryPrice
    const low = bar?.l ?? close
    const high = bar?.h ?? close

    const currentReturn = ((close - entryPrice) / entryPrice) * 100
    const highReturn = ((high - entryPrice) / entryPrice) * 100
    maxGain = Math.max(maxGain, highReturn, currentReturn)
    maxDrawdown = Math.min(maxDrawdown, currentReturn)

    if (low <= stopPrice) {
      return buildResult({
        entryPrice,
        exitPrice: round2(stopPrice),
        exitType: 'TURTLE_STOP',
        bar,
        holdingDays: i - entryIndex,
        maxGain,
        maxDrawdown,
      })
    }

    const priorLow = donchianLow(bars, exitLookback, i)
    if (priorLow != null && low < priorLow) {
      return buildResult({
        entryPrice,
        exitPrice: close,
        exitType: 'TURTLE_EXIT_LOW',
        bar,
        holdingDays: i - entryIndex,
        maxGain,
        maxDrawdown,
      })
    }
  }

  const finalBar = bars[lastIdx]
  return buildResult({
    entryPrice,
    exitPrice: finalBar?.c ?? entryPrice,
    exitType: 'TURTLE_MAX_HOLD',
    bar: finalBar,
    holdingDays: lastIdx - entryIndex,
    maxGain,
    maxDrawdown,
  })
}

function buildResult({ entryPrice, exitPrice, exitType, bar, holdingDays, maxGain, maxDrawdown }) {
  const returnPct = entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 : 0
  return {
    exitDate: bar?.t ? new Date(bar.t).toISOString().slice(0, 10) : null,
    exitPrice: round2(exitPrice),
    exitType,
    returnPct: round2(returnPct),
    holdingDays,
    maxGain: round2(maxGain),
    maxDrawdown: round2(maxDrawdown),
  }
}

function round2(val) {
  return val != null ? Math.round(val * 100) / 100 : null
}
