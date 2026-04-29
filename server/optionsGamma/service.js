import YahooFinance from 'yahoo-finance2'

const DEFAULT_RISK_FREE_RATE = 0.02
const DEFAULT_MIN_DTE = 7
const DEFAULT_MAX_DTE = 180
const DEFAULT_TOP_LEVELS = 5
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const CONTRACT_MULTIPLIER = 100
const NO_USEFUL_GAMMA_DATA = 'No useful gamma data'

function normalizeTicker(ticker) {
  return String(ticker || '').trim().toUpperCase()
}

function toFiniteNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function roundStrikeKey(strike) {
  const n = toFiniteNumber(strike)
  if (n == null || n <= 0) return null
  return Number(n.toFixed(4))
}

function normalPdf(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)
}

export function blackScholesGamma({
  spot,
  strike,
  yearsToExpiry,
  volatility,
  riskFreeRate = DEFAULT_RISK_FREE_RATE,
}) {
  const s = toFiniteNumber(spot)
  const k = toFiniteNumber(strike)
  const t = toFiniteNumber(yearsToExpiry)
  const sigma = toFiniteNumber(volatility)
  const rate = toFiniteNumber(riskFreeRate) ?? DEFAULT_RISK_FREE_RATE
  if (s == null || k == null || t == null || sigma == null) return null
  if (s <= 0 || k <= 0 || t <= 0 || sigma <= 0) return null
  const sqrtT = Math.sqrt(t)
  const d1 = (Math.log(s / k) + (rate + 0.5 * sigma * sigma) * t) / (sigma * sqrtT)
  const gamma = normalPdf(d1) / (s * sigma * sqrtT)
  return Number.isFinite(gamma) && gamma > 0 ? gamma : null
}

export function practicalGammaExposureUsd({
  gamma,
  openInterest,
  spot,
  optionType,
}) {
  const g = toFiniteNumber(gamma)
  const oi = toFiniteNumber(openInterest)
  const s = toFiniteNumber(spot)
  if (g == null || oi == null || s == null || g <= 0 || oi <= 0 || s <= 0) return null
  const sign = optionType === 'put' ? -1 : 1
  const value = sign * g * oi * CONTRACT_MULTIPLIER * s * s * 0.01
  return Number.isFinite(value) ? value : null
}

function parseExpirationDate(value) {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d
}

function dateKey(date) {
  const d = parseExpirationDate(date)
  return d ? d.toISOString().slice(0, 10) : null
}

function utcDayDiff(from, to) {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate())
  return Math.round((b - a) / (24 * 60 * 60 * 1000))
}

export function isStandardMonthlyExpiration(dateLike) {
  const d = parseExpirationDate(dateLike)
  if (!d) return false
  if (d.getUTCDay() !== 5) return false
  const day = d.getUTCDate()
  return day >= 15 && day <= 21
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

function emptyPayload(ticker, message = NO_USEFUL_GAMMA_DATA) {
  return {
    ok: false,
    ticker,
    spot: null,
    asOf: new Date().toISOString(),
    source: 'yahoo_options_black_scholes',
    netGammaUsd: null,
    regime: 'neutral',
    topLevels: [],
    allLevels: [],
    monthlyOnly: false,
    message,
  }
}

function addContractToMaps({
  byStrike,
  expirationDate,
  contract,
  optionType,
  spot,
  asOf,
  riskFreeRate,
}) {
  if (contract?.contractSize && contract.contractSize !== 'REGULAR') return
  const strike = roundStrikeKey(contract?.strike)
  const openInterest = toFiniteNumber(contract?.openInterest)
  const iv = toFiniteNumber(contract?.impliedVolatility)
  if (strike == null || openInterest == null || iv == null || openInterest <= 0 || iv <= 0) return

  const dte = utcDayDiff(asOf, expirationDate)
  const yearsToExpiry = Math.max(dte, 1) / 365
  const gamma = blackScholesGamma({ spot, strike, yearsToExpiry, volatility: iv, riskFreeRate })
  const gexUsd = practicalGammaExposureUsd({ gamma, openInterest, spot, optionType })
  if (gexUsd == null) return

  const key = String(strike)
  const monthly = isStandardMonthlyExpiration(expirationDate)
  const row =
    byStrike.get(key) ||
    {
      strike,
      netGammaUsd: 0,
      absGammaUsd: 0,
      callGammaUsd: 0,
      putGammaUsd: 0,
      openInterest: 0,
      contractCount: 0,
      monthlyNetGammaUsd: 0,
      monthlyAbsGammaUsd: 0,
      monthlyContractCount: 0,
      expirations: [],
    }

  row.netGammaUsd += gexUsd
  row.absGammaUsd += Math.abs(gexUsd)
  if (optionType === 'put') row.putGammaUsd += gexUsd
  else row.callGammaUsd += gexUsd
  row.openInterest += openInterest
  row.contractCount += 1
  if (monthly) {
    row.monthlyNetGammaUsd += gexUsd
    row.monthlyAbsGammaUsd += Math.abs(gexUsd)
    row.monthlyContractCount += 1
  }
  const expKey = dateKey(expirationDate)
  if (expKey && !row.expirations.includes(expKey)) row.expirations.push(expKey)
  byStrike.set(key, row)
}

export function buildGammaPayload({
  ticker,
  spot,
  chains,
  asOf = new Date(),
  riskFreeRate = DEFAULT_RISK_FREE_RATE,
  topLevelCount = DEFAULT_TOP_LEVELS,
}) {
  const symbol = normalizeTicker(ticker)
  const safeSpot = toFiniteNumber(spot)
  if (!symbol || safeSpot == null || safeSpot <= 0) return emptyPayload(symbol)

  const byStrike = new Map()
  for (const chain of chains || []) {
    for (const expiration of chain?.options || []) {
      const expirationDate = parseExpirationDate(expiration?.expirationDate)
      if (!expirationDate) continue
      for (const call of expiration.calls || []) {
        addContractToMaps({
          byStrike,
          expirationDate,
          contract: call,
          optionType: 'call',
          spot: safeSpot,
          asOf,
          riskFreeRate,
        })
      }
      for (const put of expiration.puts || []) {
        addContractToMaps({
          byStrike,
          expirationDate,
          contract: put,
          optionType: 'put',
          spot: safeSpot,
          asOf,
          riskFreeRate,
        })
      }
    }
  }

  const allLevels = [...byStrike.values()]
    .filter((row) => row.contractCount > 0)
    .map((row) => ({
      strike: row.strike,
      netGammaUsd: row.netGammaUsd,
      absGammaUsd: row.absGammaUsd,
      callGammaUsd: row.callGammaUsd,
      putGammaUsd: row.putGammaUsd,
      openInterest: row.openInterest,
      contractCount: row.contractCount,
      monthlyNetGammaUsd: row.monthlyNetGammaUsd,
      monthlyAbsGammaUsd: row.monthlyAbsGammaUsd,
      monthlyContractCount: row.monthlyContractCount,
      expirations: row.expirations.sort(),
    }))
    .sort((a, b) => b.absGammaUsd - a.absGammaUsd)

  if (allLevels.length < 2) return emptyPayload(symbol)

  const monthlyCandidates = allLevels
    .filter((row) => row.monthlyContractCount > 0 && row.monthlyAbsGammaUsd > 0)
    .map((row) => ({
      ...row,
      netGammaUsd: row.monthlyNetGammaUsd,
      absGammaUsd: row.monthlyAbsGammaUsd,
    }))
    .sort((a, b) => b.absGammaUsd - a.absGammaUsd)

  const useMonthly = monthlyCandidates.length >= 2
  const topLevels = (useMonthly ? monthlyCandidates : allLevels)
    .slice(0, topLevelCount)
    .map((row) => ({
      strike: row.strike,
      netGammaUsd: row.netGammaUsd,
      absGammaUsd: row.absGammaUsd,
      callGammaUsd: row.callGammaUsd,
      putGammaUsd: row.putGammaUsd,
      openInterest: row.openInterest,
      contractCount: row.contractCount,
      expirations: row.expirations,
    }))

  const netGammaUsd = allLevels.reduce((sum, row) => sum + row.netGammaUsd, 0)
  const grossGammaUsd = allLevels.reduce((sum, row) => sum + row.absGammaUsd, 0)
  const neutralThreshold = Math.max(1, grossGammaUsd * 0.05)
  const regime =
    netGammaUsd > neutralThreshold ? 'long_gamma' : netGammaUsd < -neutralThreshold ? 'short_gamma' : 'neutral'

  return {
    ok: true,
    ticker: symbol,
    spot: safeSpot,
    asOf: new Date(asOf).toISOString(),
    source: 'yahoo_options_black_scholes',
    netGammaUsd,
    regime,
    topLevels,
    allLevels,
    monthlyOnly: useMonthly,
    message: null,
  }
}

async function fetchFilteredChains({
  client,
  ticker,
  asOf,
  minDte,
  maxDte,
}) {
  const initial = await client.options(ticker)
  const spot = getSpotFromChain(initial)
  const availableDates = (initial?.expirationDates || [])
    .map(parseExpirationDate)
    .filter(Boolean)
    .filter((date) => {
      const dte = utcDayDiff(asOf, date)
      return dte >= minDte && dte <= maxDte
    })

  const initialByDate = new Map()
  for (const expiration of initial?.options || []) {
    const key = dateKey(expiration?.expirationDate)
    if (key) initialByDate.set(key, expiration)
  }

  const chains = []
  for (const expirationDate of availableDates) {
    const key = dateKey(expirationDate)
    if (key && initialByDate.has(key)) {
      chains.push({ ...initial, options: [initialByDate.get(key)] })
      continue
    }
    try {
      const chain = await client.options(ticker, { date: expirationDate })
      if (chain?.options?.length) chains.push(chain)
    } catch {
      // A missing individual expiration should not poison the whole ticker.
    }
  }

  return { spot, chains }
}

export function createOptionsGammaService({
  client = null,
  now = () => new Date(),
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  minDte = DEFAULT_MIN_DTE,
  maxDte = DEFAULT_MAX_DTE,
  riskFreeRate = DEFAULT_RISK_FREE_RATE,
  topLevelCount = DEFAULT_TOP_LEVELS,
} = {}) {
  const resolvedClient = client || new YahooFinance({ suppressNotices: ['yahooSurvey'] })
  const cache = new Map()

  return {
    async getGamma(ticker) {
      const symbol = normalizeTicker(ticker)
      if (!symbol) return emptyPayload(symbol, 'Ticker required.')
      const cached = cache.get(symbol)
      if (cached && Date.now() - cached.at <= cacheTtlMs) return cached.value

      const asOf = now()
      try {
        const { spot, chains } = await fetchFilteredChains({
          client: resolvedClient,
          ticker: symbol,
          asOf,
          minDte,
          maxDte,
        })
        const payload = buildGammaPayload({
          ticker: symbol,
          spot,
          chains,
          asOf,
          riskFreeRate,
          topLevelCount,
        })
        cache.set(symbol, { at: Date.now(), value: payload })
        return payload
      } catch (error) {
        const payload = emptyPayload(symbol, error?.message || NO_USEFUL_GAMMA_DATA)
        cache.set(symbol, { at: Date.now(), value: payload })
        return payload
      }
    },
    clearCache() {
      cache.clear()
    },
  }
}
