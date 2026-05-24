/** Layout math for Stock2 / TradeVision-style chart workspace. */

/** Global Layout header chrome (sticky nav + Yahoo subline). */
export const LAYOUT_HEADER_HEIGHT_PX = 88
/** @deprecated Use LAYOUT_HEADER_HEIGHT_PX — kept for tests referencing slim Stock2 shell. */
export const STOCK2_HEADER_HEIGHT_PX = LAYOUT_HEADER_HEIGHT_PX
export const STOCK2_TOOLBAR_HEIGHT_PX = 44
export const STOCK2_RSI_CHART_HEIGHT_PX = 140
export const STOCK2_RSI_HEADER_HEIGHT_PX = 30
export const STOCK2_RSI_BLOCK_HEIGHT_PX = STOCK2_RSI_CHART_HEIGHT_PX + STOCK2_RSI_HEADER_HEIGHT_PX
export const STOCK2_MIN_PRICE_PANE_HEIGHT_PX = 420

/** Fixed daily EMA matching ~63 weeks on a weekly chart (63 × 5 trading days). */
export const EMA315_PERIOD = 315

/** US equities: ~252 trading sessions per 365 calendar days. */
const TRADING_DAYS_PER_CALENDAR_YEAR = 252 / 365

export function approximateTradingDays(calendarDays: number): number {
  return Math.floor(calendarDays * TRADING_DAYS_PER_CALENDAR_YEAR)
}

export function minCalendarDaysForTradingBars(tradingBars: number): number {
  return Math.ceil(tradingBars / TRADING_DAYS_PER_CALENDAR_YEAR)
}

/**
 * Calendar days to request from `/api/bars` so long EMAs (e.g. 315 on daily) can warm up.
 * Matches server floors for weekly/monthly; daily uses ~2y so Yahoo returns enough sessions.
 */
export function computeStock2BarsFetchDays(interval: '1d' | '1wk' | '1mo'): number {
  if (interval === '1mo') return 1825
  if (interval === '1wk') return 730
  return Math.max(730, minCalendarDaysForTradingBars(EMA315_PERIOD + 30))
}

export function computeStock2PricePaneHeight(options: {
  gridHeight: number
  showIndicators: boolean
  minHeight?: number
}): number {
  const rsiBlock = options.showIndicators ? STOCK2_RSI_BLOCK_HEIGHT_PX : 0
  const available = options.gridHeight - rsiBlock
  if (available <= 0) return 1
  /**
   * Critical for Stock2 stability: never exceed available grid space.
   * If we force a min pane taller than available, stackHeight can overshoot and trigger
   * a ResizeObserver feedback loop where the workspace keeps expanding vertically.
   */
  return available
}

export function computeStock2StackHeight(pricePaneHeight: number, showIndicators: boolean): number {
  return pricePaneHeight + (showIndicators ? STOCK2_RSI_BLOCK_HEIGHT_PX : 0)
}

/** Fallback when the grid has not laid out yet — avoids feedback loops from oversized side columns. */
export function computeStock2GridHeightFromViewport(viewportHeight: number): number {
  return Math.max(
    STOCK2_MIN_PRICE_PANE_HEIGHT_PX + STOCK2_RSI_BLOCK_HEIGHT_PX,
    viewportHeight - LAYOUT_HEADER_HEIGHT_PX - STOCK2_TOOLBAR_HEIGHT_PX,
  )
}
