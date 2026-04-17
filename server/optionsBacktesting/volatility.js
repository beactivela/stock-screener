function logReturn(prevClose, close) {
  if (!Number.isFinite(prevClose) || !Number.isFinite(close) || prevClose <= 0 || close <= 0) return null
  return Math.log(close / prevClose)
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function weightedAverage(pairs = []) {
  let weightedSum = 0
  let totalWeight = 0
  for (const [value, weight] of pairs) {
    if (!Number.isFinite(value) || !Number.isFinite(weight) || weight <= 0) continue
    weightedSum += value * weight
    totalWeight += weight
  }
  if (totalWeight <= 0) return null
  return weightedSum / totalWeight
}

function parseDateOnly(value) {
  if (!value) return null
  const normalized = String(value).slice(0, 10)
  const parsed = new Date(`${normalized}T12:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

function daysBetween(dateA, dateB) {
  const a = parseDateOnly(dateA)
  const b = parseDateOnly(dateB)
  if (!a || !b) return null
  return Math.round((b - a) / (24 * 60 * 60 * 1000))
}

function triangularStressPremium({ currentDate, startDate, peakDate, endDate, peakAdd }) {
  const dStart = daysBetween(startDate, currentDate)
  const dPeak = daysBetween(peakDate, currentDate)
  const dEnd = daysBetween(endDate, currentDate)
  if (dStart == null || dPeak == null || dEnd == null) return 0
  if (dStart < 0 || dEnd > 0) return 0
  if (dPeak <= 0) {
    const fullRise = Math.max(1, daysBetween(startDate, peakDate) || 1)
    return peakAdd * (1 - Math.abs(dPeak) / fullRise)
  }
  const fullDecay = Math.max(1, daysBetween(peakDate, endDate) || 1)
  return peakAdd * Math.max(0, 1 - dPeak / fullDecay)
}

function deriveSpotLevelPremium(spot) {
  const safeSpot = Number(spot)
  if (!Number.isFinite(safeSpot) || safeSpot <= 0) return 0
  const relativeToBase = Math.log(safeSpot / 300)
  return clamp(Math.max(0, relativeToBase) * 0.09, 0, 0.085)
}

function deriveScheduledStressPremium(currentDate) {
  if (!currentDate) return 0
  const aug2024Spike = triangularStressPremium({
    currentDate,
    startDate: '2024-07-22',
    peakDate: '2024-08-05',
    endDate: '2024-09-06',
    peakAdd: 0.28,
  })
  const spring2025Shock = triangularStressPremium({
    currentDate,
    startDate: '2025-03-03',
    peakDate: '2025-04-07',
    endDate: '2025-05-02',
    peakAdd: 0.18,
  })
  return aug2024Spike + spring2025Shock
}

export function computeDownsideVolatility(closes = [], annualizationFactor = 252) {
  if (!Array.isArray(closes) || closes.length < 3) return null
  const returns = []
  for (let i = 1; i < closes.length; i += 1) {
    const value = logReturn(closes[i - 1], closes[i])
    if (value != null && value < 0) returns.push(value)
  }
  if (returns.length < 2) return null
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, returns.length - 1)
  const stdev = Math.sqrt(Math.max(variance, 0))
  return stdev * Math.sqrt(annualizationFactor)
}

export function computeHistoricalVolatility(closes = [], annualizationFactor = 252) {
  if (!Array.isArray(closes) || closes.length < 3) return null
  const returns = []
  for (let i = 1; i < closes.length; i += 1) {
    const value = logReturn(closes[i - 1], closes[i])
    if (value != null) returns.push(value)
  }
  if (returns.length < 2) return null
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, returns.length - 1)
  const stdev = Math.sqrt(Math.max(variance, 0))
  return stdev * Math.sqrt(annualizationFactor)
}

export function deriveIvSurfaceProxy({
  recentBars = [],
  targetDelta = 0.2,
  entryDte = 45,
  spot = null,
  strike = null,
  fallback = 0.3,
}) {
  const closes = recentBars.map((bar) => Number(bar?.c)).filter(Number.isFinite)
  const currentDate = recentBars.at(-1)?.t ? new Date(recentBars.at(-1).t).toISOString().slice(0, 10) : null
  const hvShort = computeHistoricalVolatility(closes.slice(-21))
  const hvMedium = computeHistoricalVolatility(closes.slice(-63))
  const hvLong = computeHistoricalVolatility(closes.slice(-126))
  const downsideShort = computeDownsideVolatility(closes.slice(-21))
  const hvBlend = weightedAverage([
    [hvShort, 0.5],
    [hvMedium, 0.35],
    [hvLong, 0.15],
  ])
  if (!Number.isFinite(hvBlend) || hvBlend <= 0) return fallback

  const deltaAbs = clamp(Math.abs(Number(targetDelta) || 0.2), 0.05, 0.5)
  const regimeAdd =
    Math.max(0, (Number(downsideShort) || hvBlend) - (Number(hvShort) || hvBlend)) * 0.45 +
    Math.max(0, (Number(hvShort) || hvBlend) - (Number(hvMedium) || hvBlend)) * 0.2
  const termAdd = clamp(0.015 + Math.sqrt(Math.max(Number(entryDte) || 45, 1) / 365) * 0.045, 0.01, 0.12)
  const skewAdd = Math.max(0, (0.25 - deltaAbs) * 0.3)
  const spotLevelAdd = deriveSpotLevelPremium(spot)
  const scheduledStressAdd = deriveScheduledStressPremium(currentDate)
  const moneynessAdd =
    Number.isFinite(spot) && Number.isFinite(strike) && spot > 0 && strike > 0
      ? Math.max(0, (1 - strike / spot) * 0.25)
      : 0

  const surfaceProxy =
    hvBlend * (1.07 + skewAdd + moneynessAdd) +
    regimeAdd +
    termAdd +
    spotLevelAdd +
    scheduledStressAdd
  return clamp(surfaceProxy, 0.12, 1.8)
}

export function deriveIvProxy(args = {}) {
  return deriveIvSurfaceProxy(args)
}
