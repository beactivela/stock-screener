import type { VisualizerStrategyId } from './optionsStrategy'

export type Stock2Interval = '1d' | '1wk' | '1mo'

export interface ParsedTrades {
  shortStrike: number
  longStrike: number
}

export const DEFAULT_EMA_PERIOD_1 = 63
export const DEFAULT_EMA_PERIOD_2 = 79
export const MIN_EMA_PERIOD = 2
export const MAX_EMA_PERIOD = 500

export interface Stock2UrlState {
  expiration: string | null
  strategy: VisualizerStrategyId
  interval: Stock2Interval
  indicators: boolean
  ema1: number
  ema2: number
  emaDistance: boolean
  trades: ParsedTrades | null
  axisOverlay: string | null
  commission: string | null
}

/** Parse editable EMA lookback from URL; invalid or missing values fall back to default. */
export function parseEmaPeriod(raw: string | null | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < MIN_EMA_PERIOD || parsed > MAX_EMA_PERIOD) return fallback
  return parsed
}

const STRATEGY_FROM_URL: Record<string, VisualizerStrategyId> = {
  'bull-put-spread': 'put_credit_spread',
  'put-credit-spread': 'put_credit_spread',
  put_credit_spread: 'put_credit_spread',
  'bear-put-spread': 'bear_put_spread',
  bear_put_spread: 'bear_put_spread',
  'bear-call-spread': 'bear_call_spread',
  bear_call_spread: 'bear_call_spread',
  'long-call': 'long_call',
  long_call: 'long_call',
  'cash-secured-put': 'cash_secured_put',
  cash_secured_put: 'cash_secured_put',
}

const STRATEGY_TO_URL: Partial<Record<VisualizerStrategyId, string>> = {
  put_credit_spread: 'bull-put-spread',
  bear_put_spread: 'bear-put-spread',
  bear_call_spread: 'bear-call-spread',
  long_call: 'long-call',
  cash_secured_put: 'cash-secured-put',
}

export function parseInterval(raw: string | null | undefined): Stock2Interval {
  const key = (raw || '1D').toUpperCase()
  if (key === '1W' || key === '1WK') return '1wk'
  if (key === '1M' || key === '1MO') return '1mo'
  return '1d'
}

export function serializeInterval(interval: Stock2Interval): string {
  if (interval === '1wk') return '1W'
  if (interval === '1mo') return '1M'
  return '1D'
}

export function parseStrategy(raw: string | null | undefined): VisualizerStrategyId {
  if (!raw) return 'put_credit_spread'
  return STRATEGY_FROM_URL[raw] ?? STRATEGY_FROM_URL[raw.toLowerCase()] ?? 'put_credit_spread'
}

export function serializeStrategy(strategy: VisualizerStrategyId): string {
  return STRATEGY_TO_URL[strategy] ?? strategy
}

/** TradeVision trades token: PB = buy put (long leg), PS = sell put (short leg). */
export function parseTrades(raw: string | null | undefined): ParsedTrades | null {
  if (!raw?.trim()) return null
  let shortStrike: number | null = null
  let longStrike: number | null = null
  const legPattern = /(\d+(?:\.\d+)?)(PB|PS)\d+/gi
  let match: RegExpExecArray | null
  while ((match = legPattern.exec(raw)) !== null) {
    const strike = Number(match[1])
    if (!Number.isFinite(strike)) continue
    if (match[2].toUpperCase() === 'PS') shortStrike = strike
    if (match[2].toUpperCase() === 'PB') longStrike = strike
  }
  if (shortStrike == null || longStrike == null) return null
  return { shortStrike, longStrike }
}

export function serializeTrades(
  shortStrike: number | null,
  longStrike: number | null,
  strategy: VisualizerStrategyId,
): string | null {
  if (shortStrike == null || longStrike == null) return null
  if (strategy === 'put_credit_spread' || strategy === 'bear_put_spread') {
    return `${longStrike}PB1_${shortStrike}PS1`
  }
  if (strategy === 'bear_call_spread') {
    return `${shortStrike}CS1_${longStrike}CB1`
  }
  if (strategy === 'long_call') {
    return `${longStrike}CB1`
  }
  if (strategy === 'cash_secured_put') {
    return `${shortStrike}PS1`
  }
  return null
}

export function parseStock2SearchParams(params: URLSearchParams): Stock2UrlState {
  const indicatorsRaw = params.get('indicators')
  const emaDistanceRaw = params.get('emaDist')
  return {
    expiration: params.get('expiration'),
    strategy: parseStrategy(params.get('strategy')),
    interval: parseInterval(params.get('interval')),
    indicators: indicatorsRaw == null ? true : indicatorsRaw !== 'false',
    ema1: parseEmaPeriod(params.get('ema1'), DEFAULT_EMA_PERIOD_1),
    ema2: parseEmaPeriod(params.get('ema2'), DEFAULT_EMA_PERIOD_2),
    emaDistance: emaDistanceRaw == null ? true : emaDistanceRaw !== 'false',
    trades: parseTrades(params.get('trades')),
    axisOverlay: params.get('axisOverlay'),
    commission: params.get('commission'),
  }
}

export function buildStock2SearchParams(input: {
  expiration?: string | null
  strategy?: VisualizerStrategyId
  interval?: Stock2Interval
  indicators?: boolean
  ema1?: number
  ema2?: number
  emaDistance?: boolean
  shortStrike?: number | null
  longStrike?: number | null
  axisOverlay?: string | null
  commission?: string | null
}): URLSearchParams {
  const params = new URLSearchParams()
  if (input.expiration) params.set('expiration', input.expiration)
  if (input.strategy) params.set('strategy', serializeStrategy(input.strategy))
  if (input.interval) params.set('interval', serializeInterval(input.interval))
  if (input.indicators != null) params.set('indicators', input.indicators ? 'true' : 'false')
  if (input.emaDistance === false) params.set('emaDist', 'false')
  const ema1 = input.ema1 ?? DEFAULT_EMA_PERIOD_1
  const ema2 = input.ema2 ?? DEFAULT_EMA_PERIOD_2
  if (ema1 !== DEFAULT_EMA_PERIOD_1) params.set('ema1', String(ema1))
  if (ema2 !== DEFAULT_EMA_PERIOD_2) params.set('ema2', String(ema2))
  const trades = serializeTrades(
    input.shortStrike ?? null,
    input.longStrike ?? null,
    input.strategy ?? 'put_credit_spread',
  )
  if (trades) params.set('trades', trades)
  if (input.axisOverlay) params.set('axisOverlay', input.axisOverlay)
  if (input.commission != null) params.set('commission', input.commission)
  return params
}
