/**
 * Chart indicator calculations: SMA, RSI, and VCP pullbacks.
 * Used by StockDetail for overlays, subcharts, and VCP setup lines.
 */

/** Bar shape from API */
export interface Bar {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

/** Pullback: local high -> subsequent low. Used to draw VCP setup lines. */
export interface Pullback {
  highTime: string
  highPrice: number
  lowTime: string
  lowPrice: number
  pct: number
  /** UTCTimestamp (seconds) for chart; use when chart uses UTCTimestamp format */
  highTimeUtc?: number
  lowTimeUtc?: number
}

/**
 * Find pullbacks (Minervini-style): each is a local high -> subsequent low.
 * Returns array with times for chart drawing. Matches server vcp.js logic.
 */
export function findPullbacks(bars: Bar[], lookback = 80): Pullback[] {
  if (bars.length < 10) return []
  const recent = bars.slice(-lookback)
  const pullbacks: Pullback[] = []
  let i = 0
  const toTime = (t: number) => new Date(t).toISOString().slice(0, 10)
  while (i < recent.length - 1) {
    const idx = i
    const h = Number(recent[idx]?.c)
    const prev = recent[idx - 1]?.c != null ? Number(recent[idx - 1].c) : null
    const next = recent[idx + 1]?.c != null ? Number(recent[idx + 1].c) : null
    if (prev != null && next != null && !Number.isNaN(h) && h >= prev && h >= next) {
      let lowIdx = idx + 1
      let low = Number(recent[lowIdx]?.l ?? recent[lowIdx]?.c ?? 0)
      for (let j = idx + 1; j < recent.length; j++) {
        const l = Number(recent[j]?.l ?? recent[j]?.c ?? 0)
        if (!Number.isNaN(l) && l < low) {
          low = l
          lowIdx = j
        }
        const cj = recent[j]?.c
        if (cj != null && !Number.isNaN(cj) && cj > low * 1.01) break
      }
      const pct = h > 0 ? ((h - low) / h) * 100 : 0
      pullbacks.push({
        highTime: toTime(recent[idx].t),
        highPrice: h,
        lowTime: toTime(recent[lowIdx].t),
        lowPrice: low,
        pct,
        highTimeUtc: Math.floor(recent[idx].t / 1000),
        lowTimeUtc: Math.floor(recent[lowIdx].t / 1000),
      })
      i = lowIdx + 1
    } else {
      i++
    }
  }
  return pullbacks
}

/** Simple moving average of closes over period */
export function sma(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = []
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      out.push(null)
      continue
    }
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += closes[j]
    out.push(sum / period)
  }
  return out
}

/**
 * VCP Contraction indicator: counts consecutive pullbacks where each is smaller than the previous.
 * Output: 0–6 scale per bar (higher = more contracting). Used to show when price is forming a VCP.
 */
export function vcpContraction(bars: Bar[], maxPullbacks = 6): (number | null)[] {
  const out: (number | null)[] = []
  for (let i = 0; i < bars.length; i++) {
    if (i < 10) {
      out.push(null)
      continue
    }
    const slice = bars.slice(0, i + 1)
    const pbs = findPullbacks(slice, slice.length)
    const recent = pbs.slice(-maxPullbacks)
    if (recent.length < 2) {
      out.push(recent.length === 1 ? 1 : 0)
      continue
    }
    let count = 1
    for (let j = recent.length - 1; j >= 1; j--) {
      if (recent[j].pct < recent[j - 1].pct) count++
      else break
    }
    out.push(count)
  }
  return out
}

/**
 * Ideal pullback: 5-10 day pullback, vol high at last high, vol push from higher low.
 * Returns bar times (ms) for yellow buy markers, using same bars as chart.
 */
export function findIdealPullbackBarTimes(bars: Bar[], lookback = 80): number[] {
  if (bars.length < 60) return []
  const recent = bars.slice(-lookback)
  const volumes = bars.map((b) => b.v ?? 0)
  const volSma20 = sma(volumes, 20)
  const recentStartIdx = bars.length - recent.length

  // Server findPullbacks returns { highIdx, lowIdx } - our findPullbacks returns Pullback with highTime, lowTime
  // We need to match server logic. Server uses indices into recent. Our findPullbacks returns different structure.
  // Replicate server's findPullbacks logic to get highIdx, lowIdx
  const serverStylePullbacks: { highIdx: number; lowIdx: number; highPrice: number; lowPrice: number }[] = []
  let i = 0
  while (i < recent.length - 1) {
    const idx = i
    const h = Number(recent[idx]?.c)
    const prev = recent[idx - 1]?.c != null ? Number(recent[idx - 1].c) : null
    const next = recent[idx + 1]?.c != null ? Number(recent[idx + 1].c) : null
    if (prev != null && next != null && !Number.isNaN(h) && h >= prev && h >= next) {
      let lowIdx = idx + 1
      let low = Number(recent[lowIdx]?.l ?? recent[lowIdx]?.c ?? 0)
      for (let j = idx + 1; j < recent.length; j++) {
        const l = Number(recent[j]?.l ?? recent[j]?.c ?? 0)
        if (!Number.isNaN(l) && l < low) {
          low = l
          lowIdx = j
        }
        const cj = recent[j]?.c
        if (cj != null && !Number.isNaN(cj) && cj > low * 1.01) break
      }
      serverStylePullbacks.push({ highIdx: idx, lowIdx, highPrice: h, lowPrice: low })
      i = lowIdx + 1
    } else {
      i++
    }
  }

  const result: number[] = []
  // Check last 4 pullbacks for ideal setup (in case the most recent is still forming)
  const toCheck = serverStylePullbacks.slice(-4)
  for (const last of toCheck) {
    const { highIdx, lowIdx, lowPrice } = last
    const pullbackDays = lowIdx - highIdx + 1
    if (pullbackDays < 4 || pullbackDays > 12) continue

    const highBarIdx = recentStartIdx + highIdx
    const volAtHigh = volumes[highBarIdx] ?? 0
    const volSmaAtHigh = volSma20[highBarIdx]
    if (volSmaAtHigh == null || volSmaAtHigh <= 0 || volAtHigh <= volSmaAtHigh) continue

    const prevIdx = serverStylePullbacks.indexOf(last) - 1
    const prevPullback = prevIdx >= 0 ? serverStylePullbacks[prevIdx] : null
    if (prevPullback && lowPrice <= prevPullback.lowPrice) continue

    for (let k = lowIdx + 1; k < Math.min(lowIdx + 11, recent.length) && result.length < 5; k++) {
      const barIdx = recentStartIdx + k
      const v = volumes[barIdx] ?? 0
      const vSma = volSma20[barIdx]
      const close = recent[k]?.c ?? 0
      if (vSma != null && vSma > 0 && v > vSma && close > lowPrice) {
        const t = bars[barIdx]?.t
        if (t != null) result.push(t)
      }
    }
    if (result.length > 0) break
  }
  return result
}

/** RSI (14-period default) using Wilder smoothing. Returns 0–100 or null for insufficient data. */
export function rsi(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = []
  for (let i = 0; i < closes.length; i++) {
    if (i < period) {
      out.push(null)
      continue
    }
    let sumGain = 0
    let sumLoss = 0
    for (let j = i - period + 1; j <= i; j++) {
      const change = closes[j] - closes[j - 1]
      if (change > 0) sumGain += change
      else sumLoss += Math.abs(change)
    }
    const avgGain = sumGain / period
    const avgLoss = sumLoss / period
    if (avgLoss === 0) {
      out.push(100)
      continue
    }
    const rs = avgGain / avgLoss
    out.push(100 - 100 / (1 + rs))
  }
  return out
}
