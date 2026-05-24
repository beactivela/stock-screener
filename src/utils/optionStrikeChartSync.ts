/** Helpers to keep OI strike rows aligned with the lightweight-charts price scale. */

export interface StrikePriceBounds {
  min: number
  max: number
}

export interface ResolveStrikeChartYInput {
  strike: number
  pricePaneHeight: number
  strikeCoordinates?: Record<string, number>
  visiblePriceRange?: StrikePriceBounds | null
  fallbackPriceRange?: StrikePriceBounds | null
}

export interface AutoscaleInfoLike {
  priceRange: {
    minValue: number
    maxValue: number
  }
  margins?: {
    above?: number
    below?: number
  }
}

export type AutoscaleInfoProviderLike = (
  original: () => AutoscaleInfoLike | null,
) => AutoscaleInfoLike | null

/** Reject 0 / pane-edge coordinates — LWC returns 0 for some off-scale strikes. */
export function isValidStrikeCoordinate(
  coord: number | null | undefined,
  pricePaneHeight: number,
): coord is number {
  return (
    coord != null &&
    Number.isFinite(coord) &&
    coord > 0 &&
    coord < pricePaneHeight
  )
}

export function strikePriceBounds(strikes: Array<{ strike: number }>): StrikePriceBounds | null {
  if (strikes.length === 0) return null
  let min = Infinity
  let max = -Infinity
  for (const row of strikes) {
    if (!Number.isFinite(row.strike)) continue
    min = Math.min(min, row.strike)
    max = Math.max(max, row.strike)
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null
  return { min, max }
}

/** Widen candle autoscale so every OI strike gets a real priceToCoordinate Y. */
export function createOiStrikeAutoscaleInfoProvider(
  bounds: StrikePriceBounds | null,
): AutoscaleInfoProviderLike {
  return (original) => {
    const base = original()
    if (!base || !bounds) return base
    return {
      ...base,
      priceRange: {
        minValue: Math.min(base.priceRange.minValue, bounds.min),
        maxValue: Math.max(base.priceRange.maxValue, bounds.max),
      },
    }
  }
}

export function buildStrikeCoordinateMap(
  priceToCoordinate: (price: number) => number | null,
  strikes: Array<{ strike: number }>,
  pricePaneHeight: number,
): Record<string, number> {
  const next: Record<string, number> = {}
  for (const row of strikes) {
    const coordinate = priceToCoordinate(row.strike)
    if (isValidStrikeCoordinate(coordinate, pricePaneHeight)) {
      next[String(row.strike)] = coordinate
    }
  }
  return next
}

function isFiniteRange(range: StrikePriceBounds | null | undefined): range is StrikePriceBounds {
  return (
    range != null &&
    Number.isFinite(range.min) &&
    Number.isFinite(range.max) &&
    range.max > range.min
  )
}

function mapStrikeToChartY(strike: number, range: StrikePriceBounds, pricePaneHeight: number): number {
  return ((range.max - strike) / (range.max - range.min)) * pricePaneHeight
}

export function buildVisiblePriceRangeFromChart(
  coordinateToPrice: (coordinate: number) => number | null,
  pricePaneHeight: number,
): StrikePriceBounds | null {
  const topPrice = coordinateToPrice(0)
  const bottomPrice = coordinateToPrice(pricePaneHeight)
  if (topPrice == null || bottomPrice == null) return null
  if (!Number.isFinite(topPrice) || !Number.isFinite(bottomPrice)) return null
  const min = Math.min(topPrice, bottomPrice)
  const max = Math.max(topPrice, bottomPrice)
  if (max <= min) return null
  return { min, max }
}

/** Resolve a strike's chart-space Y using a single fallback policy shared by OI + strategy panes. */
export function resolveStrikeChartY({
  strike,
  pricePaneHeight,
  strikeCoordinates = {},
  visiblePriceRange = null,
  fallbackPriceRange = null,
}: ResolveStrikeChartYInput): number | null {
  const direct = strikeCoordinates[String(strike)]
  if (isValidStrikeCoordinate(direct, pricePaneHeight)) return direct

  if (isFiniteRange(visiblePriceRange)) {
    const y = mapStrikeToChartY(strike, visiblePriceRange, pricePaneHeight)
    if (Number.isFinite(y)) return Math.max(0, Math.min(pricePaneHeight, y))
  }

  if (isFiniteRange(fallbackPriceRange)) {
    const y = mapStrikeToChartY(strike, fallbackPriceRange, pricePaneHeight)
    if (Number.isFinite(y)) return Math.max(0, Math.min(pricePaneHeight, y))
  }

  return null
}

/** Invisible line anchors so autoscale includes the OI strike band. */
export function buildOiStrikeAnchorSeriesData(
  candleTimes: number[],
  bounds: StrikePriceBounds | null,
): Array<{ time: number; value: number }> | null {
  if (!bounds || candleTimes.length === 0) return null
  const t0 = candleTimes[0]
  const t1 = candleTimes[candleTimes.length - 1]
  return [
    { time: t0, value: bounds.min },
    { time: t1, value: bounds.max },
  ]
}
