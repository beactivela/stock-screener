function erf(x) {
  const sign = x < 0 ? -1 : 1
  const abs = Math.abs(x)
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911
  const t = 1 / (1 + p * abs)
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-abs * abs))
  return sign * y
}

function normalCdf(x) {
  return 0.5 * (1 + erf(x / Math.sqrt(2)))
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

export function blackScholesPut({
  spot,
  strike,
  yearsToExpiry,
  volatility,
  riskFreeRate = 0.02,
}) {
  if (!Number.isFinite(spot) || !Number.isFinite(strike) || spot <= 0 || strike <= 0) {
    return { price: null, delta: null }
  }
  if (!Number.isFinite(yearsToExpiry) || yearsToExpiry <= 0) {
    const intrinsic = Math.max(strike - spot, 0)
    return {
      price: intrinsic,
      delta: intrinsic > 0 ? -1 : 0,
    }
  }
  const sigma = Math.max(Number(volatility) || 0, 0.0001)
  const sqrtT = Math.sqrt(yearsToExpiry)
  const d1 =
    (Math.log(spot / strike) + (riskFreeRate + 0.5 * sigma * sigma) * yearsToExpiry) / (sigma * sqrtT)
  const d2 = d1 - sigma * sqrtT
  const discount = Math.exp(-riskFreeRate * yearsToExpiry)
  const price = strike * discount * normalCdf(-d2) - spot * normalCdf(-d1)
  const delta = normalCdf(d1) - 1
  return {
    price: Math.max(price, Math.max(strike - spot, 0)),
    delta,
  }
}

export function markShortPut({
  spot,
  strike,
  yearsToExpiry,
  volatility,
  riskFreeRate = 0.02,
}) {
  return blackScholesPut({ spot, strike, yearsToExpiry, volatility, riskFreeRate })
}

export function estimateOptionBidAskSpread({
  midPrice,
  yearsToExpiry,
  volatility,
  deltaAbs = 0.2,
}) {
  const safeMid = Math.max(Number(midPrice) || 0, 0)
  if (safeMid <= 0) return 0.05
  const safeYears = Math.max(Number(yearsToExpiry) || 0, 1 / 365)
  const safeVolatility = Math.max(Number(volatility) || 0.2, 0.01)
  const safeDeltaAbs = clamp(Math.abs(Number(deltaAbs) || 0.2), 0.01, 0.99)
  const minSpread = safeMid >= 3 ? 0.1 : 0.05
  const spreadPct =
    0.08 +
    Math.min(0.08, safeYears * 0.04) +
    Math.max(0, safeVolatility - 0.25) * 0.22 +
    Math.max(0, 0.3 - safeDeltaAbs) * 0.12
  return Math.max(minSpread, safeMid * spreadPct)
}

export function applySlippageToMid({
  midPrice,
  spread,
  side,
  aggressiveness = 0.85,
  floorPrice = 0,
}) {
  const safeMid = Math.max(Number(midPrice) || 0, 0)
  const safeSpread = Math.max(Number(spread) || 0, 0)
  const safeAggressiveness = clamp(Number(aggressiveness) || 0, 0, 1)
  const halfSpread = safeSpread / 2
  const offset = halfSpread * safeAggressiveness
  const adjusted =
    side === 'sell_to_open'
      ? safeMid - offset
      : side === 'buy_to_close'
        ? safeMid + offset
        : safeMid
  return Math.max(Number(floorPrice) || 0, adjusted)
}
