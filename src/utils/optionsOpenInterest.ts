export interface OptionsOpenInterestExpiration {
  date: string
  label: string
  dte: number
}

export interface OptionsOpenInterestQuote {
  contractSymbol: string | null
  bid: number | null
  ask: number | null
  lastPrice: number | null
  mid: number | null
  impliedVolatility: number | null
  delta: number | null
  gamma: number | null
  theta: number | null
  vega: number | null
}

export interface OptionsOpenInterestStrike {
  strike: number
  callOpenInterest: number
  putOpenInterest: number
  totalOpenInterest: number
  callContractSymbol?: string | null
  putContractSymbol?: string | null
  callQuote?: OptionsOpenInterestQuote | null
  putQuote?: OptionsOpenInterestQuote | null
}

export interface OptionsOpenInterestBarRow extends OptionsOpenInterestStrike {
  callWidthPct: number
  putWidthPct: number
}

function toFiniteNumber(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function parseExpirationDate(value: unknown): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(d.getTime()) ? null : d
}

function isStandardMonthlyExpiration(dateLike: unknown): boolean {
  const d = parseExpirationDate(dateLike)
  if (!d) return false
  if (d.getUTCDay() !== 5) return false
  const day = d.getUTCDate()
  return day >= 15 && day <= 21
}

export function getMaxOpenInterest(strikes: OptionsOpenInterestStrike[]): number {
  return Math.max(
    0,
    ...strikes.flatMap((row) => [
      Math.max(0, Number(row.callOpenInterest) || 0),
      Math.max(0, Number(row.putOpenInterest) || 0),
    ]),
  )
}

function scaleOpenInterest(value: number, maxOpenInterest: number): number {
  if (!Number.isFinite(value) || value <= 0 || maxOpenInterest <= 0) return 0
  return Math.max(4, Math.min(100, Math.round((value / maxOpenInterest) * 100)))
}

export function buildOpenInterestBarRows({
  strikes,
  spot,
  maxRows = 18,
}: {
  strikes: OptionsOpenInterestStrike[]
  spot: number | null | undefined
  maxRows?: number | null
}): OptionsOpenInterestBarRow[] {
  const safeSpot = toFiniteNumber(spot)
  const maxOpenInterest = getMaxOpenInterest(strikes)
  const sortedByRelevance = [...strikes]
    .filter((row) => Number.isFinite(row.strike) && row.totalOpenInterest > 0)
    .sort((a, b) => {
      if (safeSpot == null) return a.strike - b.strike
      const distance = Math.abs(a.strike - safeSpot) - Math.abs(b.strike - safeSpot)
      return distance || a.strike - b.strike
    })

  const sorted = (maxRows == null ? sortedByRelevance : sortedByRelevance.slice(0, Math.max(1, maxRows)))
    .sort((a, b) => b.strike - a.strike)

  return sorted.map((row) => ({
    ...row,
    callWidthPct: scaleOpenInterest(row.callOpenInterest, maxOpenInterest),
    putWidthPct: scaleOpenInterest(row.putOpenInterest, maxOpenInterest),
  }))
}

export function chooseDefaultExpiration(
  expirations: OptionsOpenInterestExpiration[],
  selectedExpiration: string | null | undefined,
): string | null {
  if (selectedExpiration && expirations.some((expiration) => expiration.date === selectedExpiration)) {
    return selectedExpiration
  }
  return expirations.find((expiration) => isStandardMonthlyExpiration(expiration.date))?.date ?? expirations[0]?.date ?? null
}

export function formatExpirationDropdownLabel(expiration: OptionsOpenInterestExpiration): string {
  const typeSuffix = isStandardMonthlyExpiration(expiration.date) ? 'M' : 'W'
  return `${expiration.label} (${typeSuffix})`
}

export function formatOpenInterest(value: number | null | undefined): string {
  const n = toFiniteNumber(value)
  if (n == null || n <= 0) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2).replace(/\.0+$/, '')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, '')}K`
  return Math.round(n).toLocaleString('en-US')
}

/**
 * Pixels from the top of the price pane reserved for expiration + column headers before the strike lane.
 * Must stay in sync with `OptionsOpenInterestRail` (`top-[74px]` grid + block above) and `style={{ top: … }}` on the lane.
 */
export const OPTIONS_STRIKE_OVERLAY_TOP_PX = 102

/**
 * Map Lightweight Charts `ISeriesApi.priceToCoordinate` Y (0 = top of pane, `pricePaneHeight` = bottom)
 * to `top` / `cy` inside any column that shares the OI rail’s strike lane (OI rows, PCS graph, leg labels).
 */
export function chartSpaceYToStrikeOverlayPx(chartY: number, pricePaneHeight: number): number {
  const h = Math.max(1, pricePaneHeight)
  const clamped = Math.max(0, Math.min(h, chartY))
  const laneH = Math.max(1, h - OPTIONS_STRIKE_OVERLAY_TOP_PX)
  return OPTIONS_STRIKE_OVERLAY_TOP_PX + (clamped / h) * laneH
}
