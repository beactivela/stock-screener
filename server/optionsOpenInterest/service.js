import YahooFinance from 'yahoo-finance2'
import { getCachedBars } from '../db/bars.js'
import { computeHistoricalVolatility } from '../optionsBacktesting/volatility.js'
import { createOptionsOpenInterestStore } from './store.js'

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000
const NO_USEFUL_OPEN_INTEREST_DATA = 'No useful open interest data'
const VOLATILITY_LOOKBACK_CALENDAR_DAYS = 120
const MIN_VOLATILITY_BARS = 21

function normalizeTicker(ticker) {
  return String(ticker || '').trim().toUpperCase()
}

function toFiniteNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function parseExpirationDate(value) {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function dateKey(value) {
  const d = parseExpirationDate(value)
  return d ? d.toISOString().slice(0, 10) : null
}

function utcDayDiff(from, to) {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate())
  return Math.round((b - a) / (24 * 60 * 60 * 1000))
}

function addUtcDays(date, days) {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

function formatExpirationLabel(date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

function getSpotFromChain(chain) {
  return toFiniteNumber(
    chain?.quote?.regularMarketPrice ??
      chain?.quote?.postMarketPrice ??
      chain?.quote?.preMarketPrice ??
      chain?.quote?.bid ??
      chain?.quote?.ask,
  )
}

function collectExpirationDates({ expirationDates = [], chain }) {
  const byKey = new Map()
  for (const value of expirationDates || []) {
    const parsed = parseExpirationDate(value)
    const key = dateKey(parsed)
    if (key && parsed) byKey.set(key, parsed)
  }
  for (const expiration of chain?.options || []) {
    const parsed = parseExpirationDate(expiration?.expirationDate)
    const key = dateKey(parsed)
    if (key && parsed) byKey.set(key, parsed)
  }
  return [...byKey.values()].sort((a, b) => a.getTime() - b.getTime())
}

function buildExpirations({ expirationDates, chain, asOf }) {
  return collectExpirationDates({ expirationDates, chain }).map((date) => ({
    date: dateKey(date),
    label: formatExpirationLabel(date),
    dte: utcDayDiff(asOf, date),
  }))
}

function isStandardMonthlyExpiration(dateLike) {
  const d = parseExpirationDate(dateLike)
  if (!d) return false
  if (d.getUTCDay() !== 5) return false
  const day = d.getUTCDate()
  return day >= 15 && day <= 21
}

function pickSelectedExpiration({ selectedExpiration, expirations }) {
  const requested = dateKey(selectedExpiration)
  if (requested && expirations.some((item) => item.date === requested)) return requested
  return expirations.find((item) => isStandardMonthlyExpiration(item.date))?.date ?? expirations[0]?.date ?? null
}

function isUsableCachedPayload(payload, cacheKey) {
  if (payload?.quotesIncluded !== true) return false
  if (cacheKey !== 'default') return true

  const monthlyDefault = (payload.expirations || []).find((item) => isStandardMonthlyExpiration(item?.date))?.date
  return !monthlyDefault || payload.selectedExpiration === monthlyDefault
}

function emptyPayload({
  ticker,
  spot = null,
  asOf = new Date(),
  selectedExpiration = null,
  expirations = [],
  strikeBand = null,
  message = NO_USEFUL_OPEN_INTEREST_DATA,
}) {
  return {
    ok: false,
    ticker,
    spot,
    asOf: new Date(asOf).toISOString(),
    source: 'yahoo_options_open_interest',
    quotesIncluded: true,
    selectedExpiration,
    expirations,
    strikeBand,
    strikes: [],
    message,
  }
}

function roundStrikeKey(strike) {
  const n = toFiniteNumber(strike)
  if (n == null || n <= 0) return null
  return Number(n.toFixed(4))
}

function roundPrice(value) {
  if (value == null || value === '') return null
  const n = toFiniteNumber(value)
  return n == null ? null : Math.round(n * 100) / 100
}

function pickMid({ bid, ask, lastPrice }) {
  const b = toFiniteNumber(bid)
  const a = toFiniteNumber(ask)
  if (b != null && a != null && b > 0 && a > 0) return roundPrice((b + a) / 2)
  const last = toFiniteNumber(lastPrice)
  return last != null && last > 0 ? roundPrice(last) : null
}

function quoteNumber(value) {
  if (value == null || value === '') return null
  return toFiniteNumber(value)
}

function buildOptionQuote(contract) {
  const quote = {
    contractSymbol: contract?.contractSymbol || null,
    bid: roundPrice(contract?.bid),
    ask: roundPrice(contract?.ask),
    lastPrice: roundPrice(contract?.lastPrice),
    mid: pickMid(contract || {}),
    impliedVolatility: quoteNumber(contract?.impliedVolatility),
    delta: quoteNumber(contract?.delta),
    gamma: quoteNumber(contract?.gamma),
    theta: quoteNumber(contract?.theta),
    vega: quoteNumber(contract?.vega),
  }
  const hasUsefulQuote = Object.entries(quote).some(([key, value]) => {
    if (key === 'contractSymbol') return false
    return value != null
  })
  return hasUsefulQuote ? quote : null
}

function getOptionBucket(chain, selectedExpiration) {
  const fromOptions = (chain?.options || []).find(
    (expiration) => dateKey(expiration?.expirationDate) === selectedExpiration,
  )
  if (fromOptions) return fromOptions
  if ((chain?.calls || []).length || (chain?.puts || []).length) {
    return {
      expirationDate: selectedExpiration ? new Date(`${selectedExpiration}T12:00:00Z`) : null,
      calls: chain.calls || [],
      puts: chain.puts || [],
    }
  }
  return null
}

function addContract({ byStrike, contract, optionType }) {
  if (contract?.contractSize && contract.contractSize !== 'REGULAR') return
  const strike = roundStrikeKey(contract?.strike)
  const openInterest = toFiniteNumber(contract?.openInterest)
  if (strike == null || openInterest == null || openInterest <= 0) return

  const key = String(strike)
  const row =
    byStrike.get(key) ||
    {
      strike,
      callOpenInterest: 0,
      putOpenInterest: 0,
      totalOpenInterest: 0,
      callContractSymbol: null,
      putContractSymbol: null,
    }

  if (optionType === 'call') {
    row.callOpenInterest += openInterest
    if (!row.callContractSymbol) row.callContractSymbol = contract?.contractSymbol || null
    const quote = buildOptionQuote(contract)
    if (quote) row.callQuote = quote
  } else {
    row.putOpenInterest += openInterest
    if (!row.putContractSymbol) row.putContractSymbol = contract?.contractSymbol || null
    const quote = buildOptionQuote(contract)
    if (quote) row.putQuote = quote
  }
  row.totalOpenInterest = row.callOpenInterest + row.putOpenInterest
  byStrike.set(key, row)
}

export function buildStandardDeviationStrikeBand({
  spot,
  selectedExpiration,
  asOf = new Date(),
  bars = [],
  sigmaMultiplier = 2,
}) {
  const safeSpot = toFiniteNumber(spot)
  const expirationDate = parseExpirationDate(selectedExpiration)
  const safeAsOf = parseExpirationDate(asOf) || new Date()
  const dte = expirationDate ? utcDayDiff(safeAsOf, expirationDate) : null
  if (safeSpot == null || safeSpot <= 0 || dte == null || dte <= 0) return null
  if (!Array.isArray(bars) || bars.length < MIN_VOLATILITY_BARS) return null

  const closes = bars
    .map((bar) => toFiniteNumber(bar?.c ?? bar?.close))
    .filter((close) => close != null && close > 0)
    .slice(-64)
  if (closes.length < MIN_VOLATILITY_BARS) return null

  const volatility = computeHistoricalVolatility(closes)
  const multiplier = toFiniteNumber(sigmaMultiplier)
  if (volatility == null || volatility <= 0 || multiplier == null || multiplier <= 0) return null

  const expectedMove = multiplier * safeSpot * volatility * Math.sqrt(dte / 252)
  if (!Number.isFinite(expectedMove) || expectedMove <= 0) return null

  return {
    lower: safeSpot - expectedMove,
    upper: safeSpot + expectedMove,
    volatility,
    sigmaMultiplier: multiplier,
    dte,
    source: 'supabase_bars_realized_volatility',
  }
}

export function buildOpenInterestPayload({
  ticker,
  spot,
  chain,
  expirationDates = chain?.expirationDates || [],
  selectedExpiration = null,
  strikeBand = null,
  asOf = new Date(),
}) {
  const symbol = normalizeTicker(ticker)
  const safeSpot = toFiniteNumber(spot ?? getSpotFromChain(chain))
  const safeAsOf = parseExpirationDate(asOf) || new Date()
  const expirations = buildExpirations({ expirationDates, chain, asOf: safeAsOf })
  const selected = pickSelectedExpiration({ selectedExpiration, expirations })

  if (!symbol || safeSpot == null || safeSpot <= 0 || !selected) {
    return emptyPayload({
      ticker: symbol,
      spot: safeSpot,
      asOf: safeAsOf,
      selectedExpiration: selected,
      expirations,
    })
  }

  const bucket = getOptionBucket(chain, selected)
  const byStrike = new Map()
  for (const call of bucket?.calls || []) addContract({ byStrike, contract: call, optionType: 'call' })
  for (const put of bucket?.puts || []) addContract({ byStrike, contract: put, optionType: 'put' })

  const strikes = [...byStrike.values()]
    .filter((row) => row.totalOpenInterest > 0)
    .filter((row) => {
      if (!strikeBand) return true
      return row.strike >= strikeBand.lower && row.strike <= strikeBand.upper
    })
    .sort((a, b) => a.strike - b.strike)

  if (!strikes.length) {
    return emptyPayload({
      ticker: symbol,
      spot: safeSpot,
      asOf: safeAsOf,
      selectedExpiration: selected,
      expirations,
      strikeBand,
    })
  }

  return {
    ok: true,
    ticker: symbol,
    spot: safeSpot,
    asOf: new Date(safeAsOf).toISOString(),
    source: 'yahoo_options_open_interest',
    quotesIncluded: true,
    selectedExpiration: selected,
    expirations,
    strikeBand,
    strikes,
    message: null,
  }
}

export function createOptionsOpenInterestService({
  client = null,
  store = undefined,
  getBars = getCachedBars,
  now = () => new Date(),
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
} = {}) {
  const resolvedClient = client || new YahooFinance({ suppressNotices: ['yahooSurvey'] })
  const resolvedStore = store === null ? null : store || createOptionsOpenInterestStore()
  const cache = new Map()

  return {
    async getOpenInterest(ticker, opts = {}) {
      const symbol = normalizeTicker(ticker)
      if (!symbol) return emptyPayload({ ticker: symbol, message: 'Ticker required.' })

      const requestedExpiration = dateKey(opts.expiration)
      const cacheKey = requestedExpiration || 'default'
      const memoryCacheKey = `${symbol}:${cacheKey}`
      const cached = cache.get(memoryCacheKey)
      if (cached && Date.now() - cached.at <= cacheTtlMs) return cached.value

      const asOf = now()
      if (resolvedStore) {
        try {
          const storedPayload = await resolvedStore.getCachedPayload(symbol, cacheKey, cacheTtlMs)
          if (isUsableCachedPayload(storedPayload, cacheKey)) {
            cache.set(memoryCacheKey, { at: Date.now(), value: storedPayload })
            return storedPayload
          }
        } catch {
          // Supabase is a cache for this feature; Yahoo remains the source of truth on cache errors.
        }
      }

      try {
        const initial = await resolvedClient.options(symbol)
        const expirationDates = collectExpirationDates({
          expirationDates: initial?.expirationDates || [],
          chain: initial,
        })
        const expirations = buildExpirations({ expirationDates, chain: initial, asOf })
        const selectedExpiration = pickSelectedExpiration({
          selectedExpiration: requestedExpiration,
          expirations,
        })

        let selectedChain = initial
        if (selectedExpiration) {
          selectedChain = await resolvedClient.options(symbol, {
            date: new Date(`${selectedExpiration}T00:00:00.000Z`),
          })
        }

        const spot = getSpotFromChain(selectedChain) ?? getSpotFromChain(initial)
        let strikeBand = null
        try {
          const to = asOf.toISOString().slice(0, 10)
          const from = addUtcDays(asOf, -VOLATILITY_LOOKBACK_CALENDAR_DAYS).toISOString().slice(0, 10)
          const bars = await getBars(symbol, from, to, '1d')
          strikeBand = buildStandardDeviationStrikeBand({
            spot,
            selectedExpiration,
            asOf,
            bars,
          })
        } catch {
          // Open interest remains usable when Supabase bars are missing or temporarily unavailable.
        }

        const payload = buildOpenInterestPayload({
          ticker: symbol,
          spot,
          asOf,
          expirationDates,
          selectedExpiration,
          strikeBand,
          chain: selectedChain,
        })
        if (resolvedStore) {
          try {
            await resolvedStore.savePayload(payload, cacheKey)
          } catch {
            // Keep the request usable even if persistence is temporarily unavailable.
          }
        }
        cache.set(memoryCacheKey, { at: Date.now(), value: payload })
        return payload
      } catch (error) {
        const payload = emptyPayload({
          ticker: symbol,
          asOf,
          message: error?.message || NO_USEFUL_OPEN_INTEREST_DATA,
        })
        cache.set(memoryCacheKey, { at: Date.now(), value: payload })
        return payload
      }
    },
    clearCache() {
      cache.clear()
    },
  }
}
