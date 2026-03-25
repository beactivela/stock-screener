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
 * Exponential moving average of closes. First (period - 1) entries are null; value at index period-1
 * is the SMA seed; thereafter standard EMA with α = 2/(period+1).
 */
export function ema(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null)
  if (closes.length < period || period < 1) return out
  const k = 2 / (period + 1)
  let sum = 0
  for (let i = 0; i < period; i++) sum += closes[i]
  out[period - 1] = sum / period
  for (let i = period; i < closes.length; i++) {
    const prev = out[i - 1]
    if (prev == null) continue
    out[i] = closes[i] * k + prev * (1 - k)
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

export interface VcpStage2Options {
  relativeStrengthRating?: number | null
  rsThreshold?: number
  maRiseLookback?: number
  pullbackLookback?: number
}

export interface ChartLinePoint {
  time: number
  value?: number
}

export interface BuildLineSeriesOptions {
  fallbackValue?: number
}

export function buildLineSeriesWithTimeline(
  bars: Bar[],
  values: Array<number | null | undefined>,
  options: BuildLineSeriesOptions = {}
): ChartLinePoint[] {
  const { fallbackValue } = options
  return bars.map((bar, index) => {
    const value = values[index]
    const time = Math.floor(bar.t / 1000)
    if (value == null || Number.isNaN(value)) {
      return fallbackValue == null ? { time } : { time, value: fallbackValue }
    }
    return { time, value }
  })
}

function hasHigherHighsAndHigherLows(pullbacks: Pullback[]): boolean {
  if (pullbacks.length < 2) return false
  const prev = pullbacks[pullbacks.length - 2]
  const last = pullbacks[pullbacks.length - 1]
  return last.highPrice > prev.highPrice && last.lowPrice > prev.lowPrice
}

/**
 * Strict Stage 2 status for each bar:
 * - Price above rising 50 MA
 * - Price above rising 150 MA
 * - Recent swing structure shows a higher high and higher low
 * - Current RS rating clears the configured threshold
 *
 * Returns a series aligned to bars:
 * - `1` = strict Stage 2 pass
 * - `0` = evaluated but failed
 * - `null` = warmup period before 150 MA/rising checks are available
 */
export function vcpStage2Indicator(
  bars: Bar[],
  options: VcpStage2Options = {}
): (number | null)[] {
  const {
    relativeStrengthRating = null,
    rsThreshold = 80,
    maRiseLookback = 20,
    pullbackLookback = 120,
  } = options

  if (!Array.isArray(bars) || bars.length === 0) return []

  const closes = bars.map((bar) => Number(bar.c) || 0)
  const sma50 = sma(closes, 50)
  const sma150 = sma(closes, 150)
  const minReadyIndex = 149 + Math.max(1, maRiseLookback)
  const hasStrongRs =
    typeof relativeStrengthRating === 'number' &&
    Number.isFinite(relativeStrengthRating) &&
    relativeStrengthRating >= rsThreshold

  return bars.map((bar, index) => {
    if (index < minReadyIndex) return null

    const close = Number(bar.c) || 0
    const ma50 = sma50[index]
    const ma150 = sma150[index]
    const prior50 = index - maRiseLookback >= 0 ? sma50[index - maRiseLookback] : null
    const prior150 = index - maRiseLookback >= 0 ? sma150[index - maRiseLookback] : null

    if (ma50 == null || ma150 == null || prior50 == null || prior150 == null) return null

    const aboveRising50 = close > ma50 && ma50 > prior50
    const aboveRising150 = close > ma150 && ma150 > prior150
    const structureOk = hasHigherHighsAndHigherLows(
      findPullbacks(bars.slice(0, index + 1), pullbackLookback)
    )

    return aboveRising50 && aboveRising150 && structureOk && hasStrongRs ? 1 : 0
  })
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

/**
 * Find volume-based buy signals with strict trend filters:
 * 0. Price must be above 50 MA (minimum requirement for longs)
 * 1. Look back 4-10 days for a period with volume increase
 * 2. Price decreased during that period (accumulation)
 * 3. 10 MA must be above 20 MA (uptrend structure)
 * 4. Price must be above prior red candle high (resistance cleared)
 * 5. Signal when price crosses above 10MA, 20MA, or the high from the volume period
 * 
 * Returns array of bar times (ms) where buy signals occur
 */
export function findVolumePriceBreakouts(bars: Bar[]): number[] {
  if (bars.length < 30) return []
  
  const volumes = bars.map((b) => b.v ?? 0)
  const closes = bars.map((b) => b.c)
  const highs = bars.map((b) => b.h)
  
  // Calculate 20-day volume SMA for comparison
  const volSma20 = sma(volumes, 20)
  
  // Calculate 10, 20, and 50 MA for price breakout detection and trend filtering
  const sma10 = sma(closes, 10)
  const sma20 = sma(closes, 20)
  const sma50 = sma(closes, 50)
  
  const signals: number[] = []
  
  // Start from bar 25 to ensure we have enough history
  for (let i = 25; i < bars.length; i++) {
    // Look back 4-10 days to find volume spike period
    for (let lookback = 4; lookback <= 10; lookback++) {
      const volumePeriodStart = i - lookback
      if (volumePeriodStart < 20) continue
      
      // Check if there was volume increase during this period
      // Compare average volume in this period vs the 20-day SMA before it
      let volumeSpikePeriodEnd = volumePeriodStart
      let maxVolume = volumes[volumePeriodStart]
      let hadVolumeIncrease = false
      
      // Find the bar with highest volume in the lookback period
      for (let j = volumePeriodStart; j <= i - 1; j++) {
        const vol = volumes[j]
        const volAvg = volSma20[j]
        
        if (volAvg && vol > maxVolume) {
          maxVolume = vol
          volumeSpikePeriodEnd = j
        }
        
        // Volume increase means volume was above 20-day average
        if (volAvg && vol > volAvg * 1.2) {
          hadVolumeIncrease = true
        }
      }
      
      if (!hadVolumeIncrease) continue
      
      // Check if price decreased from start to end of volume period
      const priceAtStart = closes[volumePeriodStart]
      const priceAtEnd = closes[volumeSpikePeriodEnd]
      
      if (priceAtEnd >= priceAtStart) continue // Price didn't decrease
      
      // Find the high during the volume spike period
      const highDuringVolume = Math.max(...highs.slice(volumePeriodStart, volumeSpikePeriodEnd + 1))
      
      // FILTER 0: Price must be above 50 MA (minimum requirement for long trades)
      const currentClose = closes[i]
      const currentHigh = highs[i]
      const ma10Value = sma10[i]
      const ma20Value = sma20[i]
      const ma50Value = sma50[i]
      
      // Skip if price is not above 50 MA (not in a strong uptrend)
      if (!ma50Value || currentClose <= ma50Value) {
        continue
      }
      
      // FILTER 1: Only proceed if 10 MA is above 20 MA (uptrend confirmation)
      // Check if 10 MA is above 20 MA (uptrend structure)
      if (!ma10Value || !ma20Value || ma10Value <= ma20Value) {
        continue
      }
      
      // FILTER 2: Find the most recent red candle and check if price is above its high
      let priorRedCandleHigh = 0
      for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
        const barOpen = bars[j].o
        const barClose = bars[j].c
        const barHigh = bars[j].h
        
        // Red candle: close < open
        if (barClose < barOpen) {
          priorRedCandleHigh = barHigh
          break
        }
      }
      
      // If we found a prior red candle, current price must be above its high
      if (priorRedCandleHigh > 0 && currentClose <= priorRedCandleHigh) {
        continue
      }
      
      // Previous bar values to confirm breakout (not just touching)
      const prevClose = closes[i - 1]
      
      let hasBreakout = false
      
      // Breakout above 10 MA
      if (ma10Value && prevClose < ma10Value && currentClose > ma10Value) {
        hasBreakout = true
      }
      
      // Breakout above 20 MA
      if (ma20Value && prevClose < ma20Value && currentClose > ma20Value) {
        hasBreakout = true
      }
      
      // Breakout above volume period high
      if (prevClose < highDuringVolume && currentHigh > highDuringVolume) {
        hasBreakout = true
      }
      
      if (hasBreakout) {
        signals.push(bars[i].t)
        break // Only one signal per bar
      }
    }
  }
  
  return signals
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

/**
 * Calculate Relative Strength (RS) line vs a benchmark.
 * RS = (Stock Price / Benchmark Price) × Base Value
 * 
 * Returns normalized RS line values. Rising RS = stock outperforming benchmark (bullish).
 * Falling RS = stock underperforming benchmark (bearish).
 * 
 * @param stockBars - Stock's OHLC bars (must be sorted by time ascending)
 * @param benchmarkBars - Benchmark OHLC bars (must be sorted by time ascending)
 * @param baseValue - Starting value for normalization (default 1000)
 * @returns Array of RS values aligned by date, or null when dates don't match
 */
export function calculateRelativeStrength(
  stockBars: Bar[],
  benchmarkBars: Bar[],
  baseValue = 1000
): (number | null)[] {
  if (stockBars.length === 0 || benchmarkBars.length === 0) return []

  // Create a map of benchmark prices by date for fast lookup
  // Format: 'YYYY-MM-DD' -> close price
  const benchmarkPriceMap = new Map<string, number>()
  for (const bar of benchmarkBars) {
    const dateKey = new Date(bar.t).toISOString().slice(0, 10)
    benchmarkPriceMap.set(dateKey, bar.c)
  }

  // Find the first date where we have both stock and benchmark data
  let firstStockDate = new Date(stockBars[0].t).toISOString().slice(0, 10)
  let firstBenchmarkPrice = benchmarkPriceMap.get(firstStockDate)
  let firstStockPrice = stockBars[0].c

  // If first dates don't align, find the earliest common date
  let startIndex = 0
  while (!firstBenchmarkPrice && startIndex < stockBars.length) {
    startIndex++
    firstStockDate = new Date(stockBars[startIndex]?.t ?? 0).toISOString().slice(0, 10)
    firstBenchmarkPrice = benchmarkPriceMap.get(firstStockDate)
    firstStockPrice = stockBars[startIndex]?.c ?? 0
  }

  if (!firstBenchmarkPrice || firstBenchmarkPrice <= 0 || firstStockPrice <= 0) {
    // No common dates or invalid prices
    return stockBars.map(() => null)
  }

  // Calculate initial RS ratio
  const initialRatio = firstStockPrice / firstBenchmarkPrice

  // Calculate RS for each bar
  const rsValues: (number | null)[] = []
  
  for (let i = 0; i < stockBars.length; i++) {
    const dateKey = new Date(stockBars[i].t).toISOString().slice(0, 10)
    const benchmarkPrice = benchmarkPriceMap.get(dateKey)
    const stockPrice = stockBars[i].c

    if (!benchmarkPrice || benchmarkPrice <= 0 || stockPrice <= 0) {
      // No benchmark data for this date or invalid price
      rsValues.push(null)
      continue
    }

    // Calculate current ratio
    const currentRatio = stockPrice / benchmarkPrice
    
    // Normalize to base value using the initial ratio
    // This ensures the RS line starts at baseValue and moves from there
    const rsValue = (currentRatio / initialRatio) * baseValue
    
    rsValues.push(rsValue)
  }

  return rsValues
}
