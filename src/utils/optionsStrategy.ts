/** Options strategies supported by the stock-detail visualizer */
export type VisualizerStrategyId =
  | 'put_credit_spread'
  | 'bear_put_spread'
  | 'bear_call_spread'
  | 'long_call'
  | 'cash_secured_put'

/** @deprecated use VisualizerStrategyId */
export type OptionsStrategyType = 'put_credit_spread'

export interface OptionQuoteInput {
  strike?: number | null
  bid?: number | null
  ask?: number | null
  lastPrice?: number | null
  impliedVolatility?: number | null
}

export interface PutCreditSpreadMetrics {
  strategy: 'put_credit_spread'
  contractMultiplier: number
  shortStrike: number
  longStrike: number
  shortPremium: number
  longPremium: number
  netCredit: number
  maxProfit: number
  maxLoss: number
  estimatedMargin: number
  breakEven: number
  width: number
}

export interface LongCallMetrics {
  strategy: 'long_call'
  contractMultiplier: number
  strike: number
  premium: number
  maxLoss: number
  /** P&L at `diagramPriceHigh` (diagram cap, not unlimited upside). */
  maxProfitAtCap: number
  breakEven: number
  diagramPriceLow: number
  diagramPriceHigh: number
}

/** Sell lower put, buy higher put (debit). longStrike > shortStrike. */
export interface BearPutSpreadMetrics {
  strategy: 'bear_put_spread'
  contractMultiplier: number
  shortStrike: number
  longStrike: number
  shortPremium: number
  longPremium: number
  netDebit: number
  maxLoss: number
  maxProfit: number
  breakEven: number
  width: number
}

/** Sell lower call, buy higher call (credit). longStrike > shortStrike. */
export interface BearCallSpreadMetrics {
  strategy: 'bear_call_spread'
  contractMultiplier: number
  shortStrike: number
  longStrike: number
  shortPremium: number
  longPremium: number
  netCredit: number
  maxProfit: number
  maxLoss: number
  estimatedMargin: number
  breakEven: number
  width: number
}

/** Short put only (cash-secured). */
export interface CashSecuredPutMetrics {
  strategy: 'cash_secured_put'
  contractMultiplier: number
  strike: number
  premium: number
  maxProfit: number
  maxLossAtLow: number
  breakEven: number
  estimatedMargin: number
  diagramPriceLow: number
  diagramPriceHigh: number
}

export type StrategyMetrics =
  | PutCreditSpreadMetrics
  | BearPutSpreadMetrics
  | BearCallSpreadMetrics
  | LongCallMetrics
  | CashSecuredPutMetrics

export interface PayoffPoint {
  price: number
  profitLoss: number
}

export interface PayoffCurveSegments {
  loss: PayoffPoint[]
  profit: PayoffPoint[]
}

const CONTRACT_MULTIPLIER = 100

function toFiniteNumber(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function normalCdf(value: number): number {
  const sign = value < 0 ? -1 : 1
  const x = Math.abs(value) / Math.sqrt(2)
  const t = 1 / (1 + 0.3275911 * x)
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const erf = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x))
  return 0.5 * (1 + sign * erf)
}

export function pickOptionMid(quote: OptionQuoteInput): number | null {
  const bid = toFiniteNumber(quote.bid)
  const ask = toFiniteNumber(quote.ask)
  if (bid != null && ask != null && bid > 0 && ask > 0) return roundCurrency((bid + ask) / 2)
  const last = toFiniteNumber(quote.lastPrice)
  return last != null && last > 0 ? roundCurrency(last) : null
}

export function calculatePutCreditSpreadMetrics({
  shortPut,
  longPut,
}: {
  shortPut: OptionQuoteInput
  longPut: OptionQuoteInput
}): PutCreditSpreadMetrics | null {
  const shortStrike = toFiniteNumber(shortPut.strike)
  const longStrike = toFiniteNumber(longPut.strike)
  const shortPremium = pickOptionMid(shortPut)
  const longPremium = pickOptionMid(longPut)
  if (shortStrike == null || longStrike == null || shortPremium == null || longPremium == null) return null
  if (shortStrike <= longStrike) return null

  const width = roundCurrency(shortStrike - longStrike)
  const netCredit = roundCurrency(shortPremium - longPremium)
  if (netCredit <= 0 || netCredit >= width) return null

  const maxProfit = roundCurrency(netCredit * CONTRACT_MULTIPLIER)
  const maxLoss = roundCurrency((width - netCredit) * CONTRACT_MULTIPLIER)

  return {
    strategy: 'put_credit_spread',
    contractMultiplier: CONTRACT_MULTIPLIER,
    shortStrike,
    longStrike,
    shortPremium,
    longPremium,
    netCredit,
    maxProfit,
    maxLoss,
    estimatedMargin: maxLoss,
    breakEven: roundCurrency(shortStrike - netCredit),
    width,
  }
}

/** @deprecated use calculatePutCreditSpreadMetrics */
export const calculateBullPutSpreadMetrics = calculatePutCreditSpreadMetrics

function longCallProfitLossContract(S: number, strike: number, premiumPerShare: number): number {
  const intrinsic = Math.max(S - strike, 0)
  return roundCurrency((intrinsic - premiumPerShare) * CONTRACT_MULTIPLIER)
}

export function calculateLongCallMetrics({
  call,
  priceMin,
  priceMax,
}: {
  call: OptionQuoteInput
  priceMin: number | null
  priceMax: number | null
}): LongCallMetrics | null {
  const strike = toFiniteNumber(call.strike)
  const premium = pickOptionMid(call)
  if (strike == null || premium == null || premium <= 0) return null

  const maxLoss = roundCurrency(premium * CONTRACT_MULTIPLIER)
  const breakEven = roundCurrency(strike + premium)

  let diagramLow = priceMin != null ? Math.min(priceMin, strike * 0.92) : strike * 0.88
  let diagramHigh = priceMax != null ? Math.max(priceMax, breakEven * 1.04) : Math.max(strike * 1.18, breakEven * 1.08)
  diagramLow = Math.min(diagramLow, strike - 0.01)
  diagramHigh = Math.max(diagramHigh, breakEven + 0.05)

  let maxProfitAtCap = longCallProfitLossContract(diagramHigh, strike, premium)
  if (maxProfitAtCap <= 0) {
    diagramHigh = Math.max(breakEven + 1, strike + 5)
    maxProfitAtCap = longCallProfitLossContract(diagramHigh, strike, premium)
  }
  if (maxProfitAtCap <= 0) return null

  return {
    strategy: 'long_call',
    contractMultiplier: CONTRACT_MULTIPLIER,
    strike,
    premium,
    maxLoss,
    maxProfitAtCap,
    breakEven,
    diagramPriceLow: roundCurrency(diagramLow),
    diagramPriceHigh: roundCurrency(diagramHigh),
  }
}

/** Bear put: sell lower-strike put, buy higher-strike put; net debit; longStrike > shortStrike. */
export function calculateBearPutSpreadMetrics({
  shortPut,
  longPut,
}: {
  shortPut: OptionQuoteInput
  longPut: OptionQuoteInput
}): BearPutSpreadMetrics | null {
  const shortStrike = toFiniteNumber(shortPut.strike)
  const longStrike = toFiniteNumber(longPut.strike)
  const shortPremium = pickOptionMid(shortPut)
  const longPremium = pickOptionMid(longPut)
  if (shortStrike == null || longStrike == null || shortPremium == null || longPremium == null) return null
  if (longStrike <= shortStrike) return null

  const width = roundCurrency(longStrike - shortStrike)
  const netDebit = roundCurrency(longPremium - shortPremium)
  if (netDebit <= 0 || netDebit >= width) return null

  const maxLoss = roundCurrency(netDebit * CONTRACT_MULTIPLIER)
  const maxProfit = roundCurrency((width - netDebit) * CONTRACT_MULTIPLIER)
  const breakEven = roundCurrency(longStrike - netDebit)

  return {
    strategy: 'bear_put_spread',
    contractMultiplier: CONTRACT_MULTIPLIER,
    shortStrike,
    longStrike,
    shortPremium,
    longPremium,
    netDebit,
    maxLoss,
    maxProfit,
    breakEven,
    width,
  }
}

/** Bear call (credit): sell lower call, buy higher call; longStrike > shortStrike. */
export function calculateBearCallSpreadMetrics({
  shortCall,
  longCall,
}: {
  shortCall: OptionQuoteInput
  longCall: OptionQuoteInput
}): BearCallSpreadMetrics | null {
  const shortStrike = toFiniteNumber(shortCall.strike)
  const longStrike = toFiniteNumber(longCall.strike)
  const shortPremium = pickOptionMid(shortCall)
  const longPremium = pickOptionMid(longCall)
  if (shortStrike == null || longStrike == null || shortPremium == null || longPremium == null) return null
  if (longStrike <= shortStrike) return null

  const width = roundCurrency(longStrike - shortStrike)
  const netCredit = roundCurrency(shortPremium - longPremium)
  if (netCredit <= 0 || netCredit >= width) return null

  const maxProfit = roundCurrency(netCredit * CONTRACT_MULTIPLIER)
  const maxLoss = roundCurrency((width - netCredit) * CONTRACT_MULTIPLIER)

  return {
    strategy: 'bear_call_spread',
    contractMultiplier: CONTRACT_MULTIPLIER,
    shortStrike,
    longStrike,
    shortPremium,
    longPremium,
    netCredit,
    maxProfit,
    maxLoss,
    estimatedMargin: maxLoss,
    breakEven: roundCurrency(shortStrike + netCredit),
    width,
  }
}

function shortPutProfitLossContract(S: number, strike: number, premiumPerShare: number): number {
  const intrinsic = Math.max(strike - S, 0)
  return roundCurrency((premiumPerShare - intrinsic) * CONTRACT_MULTIPLIER)
}

/** Short put (cash-secured): single leg; diagram caps intrinsic loss at priceMin. */
export function calculateCashSecuredPutMetrics({
  shortPut,
  priceMin,
  priceMax,
}: {
  shortPut: OptionQuoteInput
  priceMin: number | null
  priceMax: number | null
}): CashSecuredPutMetrics | null {
  const strike = toFiniteNumber(shortPut.strike)
  const premium = pickOptionMid(shortPut)
  if (strike == null || premium == null || premium <= 0) return null

  const maxProfit = roundCurrency(premium * CONTRACT_MULTIPLIER)
  const breakEven = roundCurrency(strike - premium)
  const estimatedMargin = roundCurrency(strike * CONTRACT_MULTIPLIER)

  let diagramLow = priceMin != null ? Math.min(priceMin, strike * 0.88) : strike * 0.85
  let diagramHigh = priceMax != null ? Math.max(priceMax, strike * 1.06) : Math.max(strike * 1.12, breakEven + 1)
  diagramLow = Math.min(diagramLow, breakEven - 0.05, strike - 0.25)
  diagramHigh = Math.max(diagramHigh, strike + 0.05)

  const maxLossAtLow = shortPutProfitLossContract(diagramLow, strike, premium)
  if (maxLossAtLow >= -1e-6) {
    diagramLow = Math.min(diagramLow, strike * 0.75, breakEven - 1)
    const retry = shortPutProfitLossContract(diagramLow, strike, premium)
    if (retry >= -1e-6) return null
  }

  return {
    strategy: 'cash_secured_put',
    contractMultiplier: CONTRACT_MULTIPLIER,
    strike,
    premium,
    maxProfit,
    maxLossAtLow: roundCurrency(maxLossAtLow),
    breakEven,
    estimatedMargin,
    diagramPriceLow: roundCurrency(diagramLow),
    diagramPriceHigh: roundCurrency(diagramHigh),
  }
}

/** Sloped leg of bear put between strikes: max profit at lower strike → breakeven → max loss at higher strike. */
export function buildBearPutSpreadSlopedSegmentKnots({
  shortStrike,
  longStrike,
  breakEven,
  maxLoss,
  maxProfit,
}: {
  shortStrike: number
  longStrike: number
  breakEven: number
  maxLoss: number
  maxProfit: number
}): PayoffPoint[] {
  return [
    { price: shortStrike, profitLoss: maxProfit },
    { price: breakEven, profitLoss: 0 },
    { price: longStrike, profitLoss: -maxLoss },
  ]
}

/** Bear call sloped segment (same geometry as bull put credit in price space). */
export function buildBearCallSpreadSlopedSegmentKnots({
  shortStrike,
  longStrike,
  breakEven,
  maxLoss,
  maxProfit,
}: {
  shortStrike: number
  longStrike: number
  breakEven: number
  maxLoss: number
  maxProfit: number
}): PayoffPoint[] {
  return [
    { price: shortStrike, profitLoss: maxProfit },
    { price: breakEven, profitLoss: 0 },
    { price: longStrike, profitLoss: -maxLoss },
  ]
}

/** Short put payoff: flat max profit for S ≥ K, linear to capped loss at diagram low. */
export function buildCashSecuredPutPayoffKnots(metrics: CashSecuredPutMetrics): PayoffPoint[] {
  const { strike, maxProfit, breakEven, maxLossAtLow, diagramPriceLow: lowRaw, diagramPriceHigh: highRaw } = metrics
  const low = Math.min(lowRaw, breakEven - 1e-6)
  const high = Math.max(highRaw, strike + 1e-6)
  return [
    { price: low, profitLoss: maxLossAtLow },
    { price: breakEven, profitLoss: 0 },
    { price: strike, profitLoss: maxProfit },
    { price: high, profitLoss: maxProfit },
  ]
}

/** Expiry payoff knots for the long-call diagram (flat max loss ≤K, then kinked to cap). */
export function buildLongCallPayoffKnots(metrics: LongCallMetrics): PayoffPoint[] {
  const { strike, premium, maxLoss, breakEven, diagramPriceLow: lowRaw, diagramPriceHigh: highRaw } = metrics
  const low = Math.min(lowRaw, strike - 1e-6)
  const high = Math.max(highRaw, breakEven + 1e-6)
  const pts: PayoffPoint[] = [
    { price: roundCurrency(low), profitLoss: longCallProfitLossContract(low, strike, premium) },
    { price: strike, profitLoss: -maxLoss },
    { price: breakEven, profitLoss: 0 },
    { price: roundCurrency(high), profitLoss: longCallProfitLossContract(high, strike, premium) },
  ]
  return [...pts].sort((a, b) => a.price - b.price)
}

export function buildBullPutSpreadPayoffCurve({
  shortStrike,
  longStrike,
  netCredit,
  pricePoints,
}: {
  shortStrike: number
  longStrike: number
  netCredit: number
  pricePoints: number[]
}): PayoffPoint[] {
  return [...pricePoints]
    .filter((price) => Number.isFinite(price))
    .sort((a, b) => a - b)
    .map((price) => {
      const shortPutValue = Math.max(shortStrike - price, 0)
      const longPutValue = Math.max(longStrike - price, 0)
      const perShareProfitLoss = netCredit - shortPutValue + longPutValue
      return {
        price: roundCurrency(price),
        profitLoss: roundCurrency(perShareProfitLoss * CONTRACT_MULTIPLIER),
      }
    })
}

function interpolateZeroCrossing(a: PayoffPoint, b: PayoffPoint): PayoffPoint | null {
  const delta = b.profitLoss - a.profitLoss
  if (delta === 0) return null
  const t = (0 - a.profitLoss) / delta
  if (t <= 0 || t >= 1) return null
  return {
    price: roundCurrency(a.price + (b.price - a.price) * t),
    profitLoss: 0,
  }
}

function pushUnique(points: PayoffPoint[], point: PayoffPoint) {
  const last = points[points.length - 1]
  if (last && last.price === point.price && last.profitLoss === point.profitLoss) return
  points.push(point)
}

export function splitPayoffCurveByProfit(curve: PayoffPoint[]): PayoffCurveSegments {
  const sorted = [...curve]
    .filter((point) => Number.isFinite(point.price) && Number.isFinite(point.profitLoss))
    .sort((a, b) => a.price - b.price)
  const segments: PayoffCurveSegments = { loss: [], profit: [] }

  for (let index = 0; index < sorted.length; index += 1) {
    const point = sorted[index]
    if (point.profitLoss <= 0) pushUnique(segments.loss, point)
    if (point.profitLoss >= 0) pushUnique(segments.profit, point)

    const next = sorted[index + 1]
    if (!next) continue
    const crossesZero = point.profitLoss * next.profitLoss < 0
    if (!crossesZero) continue

    const zero = interpolateZeroCrossing(point, next)
    if (!zero) continue
    pushUnique(segments.loss, zero)
    pushUnique(segments.profit, zero)
  }

  return segments
}

export function filterBullPutSpreadSlopeCurve(
  curve: PayoffPoint[],
  {
    longStrike,
    shortStrike,
  }: {
    longStrike: number
    shortStrike: number
  },
): PayoffPoint[] {
  const low = Math.min(longStrike, shortStrike)
  const high = Math.max(longStrike, shortStrike)
  return [...curve]
    .filter((point) => point.price >= low && point.price <= high)
    .sort((a, b) => a.price - b.price)
}

/** Expiry payoff on the sloped leg is linear in S between long and short strikes — three knots are exact. */
export function buildBullPutSpreadSlopedSegmentKnots({
  longStrike,
  shortStrike,
  breakEven,
  maxLoss,
  maxProfit,
}: {
  longStrike: number
  shortStrike: number
  breakEven: number
  maxLoss: number
  maxProfit: number
}): PayoffPoint[] {
  return [
    { price: longStrike, profitLoss: -maxLoss },
    { price: breakEven, profitLoss: 0 },
    { price: shortStrike, profitLoss: maxProfit },
  ]
}

/**
 * Map P&L dollars to an x coordinate where loss uses the left half of `width`
 * and profit uses the right half, so loss/profit zones are always equal width
 * (center vertical at width/2 = $0 P&L / breakeven on the payoff line).
 */
export function xForSymmetricPayoffPnL(
  profitLoss: number,
  {
    maxLoss,
    maxProfit,
    width,
  }: {
    maxLoss: number
    maxProfit: number
    width: number
  },
): number {
  const half = width / 2
  const safeMaxLoss = Math.max(maxLoss, 1e-9)
  const safeMaxProfit = Math.max(maxProfit, 1e-9)
  if (profitLoss <= 0) {
    const t = clampNumber(profitLoss / -safeMaxLoss, 0, 1)
    return half * (1 - t)
  }
  const t = clampNumber(profitLoss / safeMaxProfit, 0, 1)
  return half + half * t
}

/** Risk-neutral-ish prob. spot finishes above `threshold` at expiry (lognormal). */
export function estimateChancePriceAboveAtExpiry({
  spot,
  threshold,
  impliedVolatility,
  dte,
}: {
  spot: number | null | undefined
  threshold: number | null | undefined
  impliedVolatility: number | null | undefined
  dte: number | null | undefined
}): number | null {
  const s = toFiniteNumber(spot)
  const k = toFiniteNumber(threshold)
  const iv = toFiniteNumber(impliedVolatility)
  const days = toFiniteNumber(dte)
  if (s == null || k == null || iv == null || days == null) return null
  if (s <= 0 || k <= 0 || iv <= 0 || days <= 0) return null

  const years = days / 365
  const sigmaT = iv * Math.sqrt(years)
  if (sigmaT <= 0) return null

  const z = (Math.log(s / k) - 0.5 * iv * iv * years) / sigmaT
  return Math.max(0, Math.min(1, normalCdf(z)))
}

export function estimateBullPutChanceOfProfit({
  spot,
  breakEven,
  impliedVolatility,
  dte,
}: {
  spot: number | null | undefined
  breakEven: number | null | undefined
  impliedVolatility: number | null | undefined
  dte: number | null | undefined
}): number | null {
  return estimateChancePriceAboveAtExpiry({ spot, threshold: breakEven, impliedVolatility, dte })
}

/** Prob. spot finishes below `threshold` at expiry (lognormal). */
export function estimateChancePriceBelowAtExpiry({
  spot,
  threshold,
  impliedVolatility,
  dte,
}: {
  spot: number | null | undefined
  threshold: number | null | undefined
  impliedVolatility: number | null | undefined
  dte: number | null | undefined
}): number | null {
  const above = estimateChancePriceAboveAtExpiry({ spot, threshold, impliedVolatility, dte })
  if (above == null) return null
  return Math.max(0, Math.min(1, 1 - above))
}

/** Bear put profits when spot ends below upper breakeven (long − debit). */
export function estimateBearPutChanceOfProfit({
  spot,
  breakEven,
  impliedVolatility,
  dte,
}: {
  spot: number | null | undefined
  breakEven: number | null | undefined
  impliedVolatility: number | null | undefined
  dte: number | null | undefined
}): number | null {
  return estimateChancePriceBelowAtExpiry({ spot, threshold: breakEven, impliedVolatility, dte })
}

/** Bear call (credit) profits when spot ends below breakeven (short + credit). */
export function estimateBearCallChanceOfProfit({
  spot,
  breakEven,
  impliedVolatility,
  dte,
}: {
  spot: number | null | undefined
  breakEven: number | null | undefined
  impliedVolatility: number | null | undefined
  dte: number | null | undefined
}): number | null {
  return estimateChancePriceBelowAtExpiry({ spot, threshold: breakEven, impliedVolatility, dte })
}

/** Cash-secured short put: same tail as PCS — profit when spot finishes above breakeven. */
export const estimateCashSecuredPutChanceOfProfit = estimateBullPutChanceOfProfit

export const estimateLongCallChanceOfProfit = estimateChancePriceAboveAtExpiry
