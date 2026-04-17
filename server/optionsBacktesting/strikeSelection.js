import { blackScholesPut } from './pricing.js'

function roundStrike(value) {
  if (value >= 200) return Math.round(value / 5) * 5
  if (value >= 50) return Math.round(value)
  return Math.round(value * 2) / 2
}

export function buildStrikeCandidates(spot, steps = 40) {
  const out = []
  for (let i = -steps; i <= steps; i += 1) {
    const pct = i * 0.025
    const strike = roundStrike(spot * (1 + pct))
    if (strike > 0) out.push(strike)
  }
  return [...new Set(out)].sort((a, b) => a - b)
}

export function selectStrikeForTargetDelta({
  spot,
  targetDelta,
  entryDte,
  volatility,
  riskFreeRate = 0.02,
}) {
  const yearsToExpiry = Math.max(entryDte, 1) / 365
  const candidates = buildStrikeCandidates(spot)
  let best = null
  for (const strike of candidates) {
    const modeled = blackScholesPut({ spot, strike, yearsToExpiry, volatility, riskFreeRate })
    if (!Number.isFinite(modeled?.price) || !Number.isFinite(modeled?.delta)) continue
    const deltaAbs = Math.abs(modeled.delta)
    const distance = Math.abs(deltaAbs - targetDelta)
    if (!best || distance < best.distance) {
      best = {
        strike,
        premium: modeled.price,
        delta: modeled.delta,
        distance,
      }
    }
  }
  if (!best) throw new Error(`Could not model a strike for target delta ${targetDelta}`)
  return best
}
