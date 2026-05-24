/** Percent distance of price from an EMA: ((price - ema) / ema) * 100 */

export function priceEmaDistancePercent(
  price: number | null | undefined,
  emaValue: number | null | undefined,
): number | null {
  if (price == null || emaValue == null) return null
  if (!Number.isFinite(price) || !Number.isFinite(emaValue) || emaValue === 0) return null
  return ((price - emaValue) / emaValue) * 100
}

export function formatEmaDistancePercent(distancePct: number | null | undefined): string {
  if (distancePct == null || !Number.isFinite(distancePct)) return '—'
  const sign = distancePct > 0 ? '+' : ''
  return `${sign}${distancePct.toFixed(2)}%`
}

export interface EmaDistanceOverlayLayout {
  x: number | null
  topY: number | null
  bottomY: number | null
  priceY: number | null
  emaY: number | null
  labelY: number | null
  distancePct: number | null
  visible: boolean
}

const MIN_OVERLAY_LINE_PX = 6

/** Map chart coordinates into a vertical EMA↔price measure on the last bar. */
export function buildEmaDistanceOverlayLayout(input: {
  price: number | null | undefined
  emaValue: number | null | undefined
  x: number | null | undefined
  priceY: number | null | undefined
  emaY: number | null | undefined
}): EmaDistanceOverlayLayout {
  const distancePct = priceEmaDistancePercent(input.price, input.emaValue)
  const x = input.x ?? null
  const priceY = input.priceY ?? null
  const emaY = input.emaY ?? null

  if (
    x == null ||
    priceY == null ||
    emaY == null ||
    distancePct == null ||
    !Number.isFinite(x) ||
    !Number.isFinite(priceY) ||
    !Number.isFinite(emaY)
  ) {
    return {
      x: null,
      topY: null,
      bottomY: null,
      priceY: null,
      emaY: null,
      labelY: null,
      distancePct,
      visible: false,
    }
  }

  let topY = Math.min(priceY, emaY)
  let bottomY = Math.max(priceY, emaY)
  if (bottomY - topY < MIN_OVERLAY_LINE_PX) {
    const mid = (topY + bottomY) / 2
    topY = mid - MIN_OVERLAY_LINE_PX / 2
    bottomY = mid + MIN_OVERLAY_LINE_PX / 2
  }

  return {
    x,
    topY,
    bottomY,
    priceY,
    emaY,
    labelY: (topY + bottomY) / 2,
    distancePct,
    visible: true,
  }
}

export function emaDistanceOverlayColor(distancePct: number | null | undefined): string {
  if (distancePct == null || !Number.isFinite(distancePct)) return '#94a3b8'
  return distancePct >= 0 ? '#22c55e' : '#ef4444'
}
