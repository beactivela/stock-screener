import { useRef, useState } from 'react'

import {
  buildOpenInterestBarRows,
  chartSpaceYToStrikeOverlayPx,
  formatExpirationDropdownLabel,
  formatOpenInterest,
  OPTIONS_STRIKE_OVERLAY_TOP_PX,
  type OptionsOpenInterestExpiration,
  type OptionsOpenInterestStrike,
} from '../utils/optionsOpenInterest'
import type { VisualizerStrategyId } from '../utils/optionsStrategy'

interface OptionsOpenInterestRailProps {
  expirations: OptionsOpenInterestExpiration[]
  selectedExpiration: string | null
  strikes: OptionsOpenInterestStrike[]
  spot: number | null
  pricePaneHeight: number
  fullHeight: number
  strikeCoordinates: Record<string, number>
  priceMin: number | null
  priceMax: number | null
  loading?: boolean
  message?: string | null
  onExpirationChange: (expiration: string) => void
  strategyKind?: VisualizerStrategyId
  strategyShortStrike?: number | null
  strategyLongStrike?: number | null
  onStrategyStrikeChange?: (next: { shortStrike: number | null; longStrike: number | null }) => void
}

type DragLeg = 'short' | 'long'

function formatStrike(value: number | null | undefined): string {
  if (!Number.isFinite(value)) return '-'
  const n = Number(value)
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '')
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export default function OptionsOpenInterestRail({
  expirations,
  selectedExpiration,
  strikes,
  spot,
  pricePaneHeight,
  fullHeight,
  strikeCoordinates,
  priceMin,
  priceMax,
  loading = false,
  message = null,
  onExpirationChange,
  strategyKind = 'put_credit_spread',
  strategyShortStrike = null,
  strategyLongStrike = null,
  onStrategyStrikeChange,
}: OptionsOpenInterestRailProps) {
  const [dragLeg, setDragLeg] = useState<DragLeg | null>(null)
  const dragLegRef = useRef<DragLeg | null>(null)
  /** Strike rows + chips live here; pointer Y is mapped in this box so it matches chart `strikeCoordinates`. */
  const strikeLaneRef = useRef<HTMLDivElement | null>(null)
  const selected = expirations.find((expiration) => expiration.date === selectedExpiration)
  const hasScale = priceMin != null && priceMax != null && priceMax > priceMin
  const pricedPutRows = [...strikes]
    .filter((row) => row.putQuote?.mid != null && row.putQuote.mid > 0)
    .sort((a, b) => a.strike - b.strike)
  const pricedCallRows = [...strikes]
    .filter((row) => row.callQuote?.mid != null && row.callQuote.mid > 0)
    .sort((a, b) => a.strike - b.strike)
  const laneHeight = Math.max(1, pricePaneHeight - OPTIONS_STRIKE_OVERLAY_TOP_PX)

  /** Chart-space Y [0, pricePaneHeight] for nearest-strike math (same space as `strikeCoordinates`). */
  const chartYFromClientY = (clientY: number): number | null => {
    const lane = strikeLaneRef.current
    if (!lane) return null
    const rect = lane.getBoundingClientRect()
    if (rect.height <= 1) return null
    const yInLane = clamp(clientY - rect.top, 0, rect.height)
    return (yInLane / rect.height) * pricePaneHeight
  }

  /** Position inside the strike lane (px from lane top) so rows line up with chart coordinates. */
  const laneTopPxForChartY = (chartY: number): number =>
    clamp(chartSpaceYToStrikeOverlayPx(chartY, pricePaneHeight) - OPTIONS_STRIKE_OVERLAY_TOP_PX, 0, laneHeight)

  const yPxForStrike = (strike: number): number | null => {
    const coordinate = strikeCoordinates[String(strike)]
    if (Number.isFinite(coordinate)) return clamp(coordinate, 0, pricePaneHeight)
    if (!hasScale) return null
    return clamp(((priceMax - strike) / (priceMax - priceMin)) * pricePaneHeight, 0, pricePaneHeight)
  }

  /** PCS: short above long; bear put: short (lower K) below long — candidate filters differ. */
  const nearestPutSpreadStrikeFromY = (clientY: number, leg: DragLeg, pcs: boolean): number | null => {
    if (strategyShortStrike == null || strategyLongStrike == null) return null
    const y = chartYFromClientY(clientY)
    if (y == null) return null
    const candidates = pricedPutRows.filter((row) =>
      pcs
        ? leg === 'short'
          ? row.strike > strategyLongStrike!
          : row.strike < strategyShortStrike!
        : leg === 'short'
          ? row.strike < strategyLongStrike!
          : row.strike > strategyShortStrike!,
    )
    if (candidates.length === 0) return null
    return candidates.reduce((closest, row) => {
      const rowY = yPxForStrike(row.strike)
      const closestY = yPxForStrike(closest.strike)
      if (rowY == null) return closest
      if (closestY == null) return row
      return Math.abs(rowY - y) < Math.abs(closestY - y) ? row : closest
    }, candidates[0]).strike
  }

  const nearestCallSpreadStrikeFromY = (clientY: number, leg: DragLeg): number | null => {
    if (strategyShortStrike == null || strategyLongStrike == null) return null
    const y = chartYFromClientY(clientY)
    if (y == null) return null
    const candidates = pricedCallRows.filter((row) =>
      leg === 'short' ? row.strike < strategyLongStrike! : row.strike > strategyShortStrike!,
    )
    if (candidates.length === 0) return null
    return candidates.reduce((closest, row) => {
      const rowY = yPxForStrike(row.strike)
      const closestY = yPxForStrike(closest.strike)
      if (rowY == null) return closest
      if (closestY == null) return row
      return Math.abs(rowY - y) < Math.abs(closestY - y) ? row : closest
    }, candidates[0]).strike
  }

  const nearestCspPutStrikeFromY = (clientY: number): number | null => {
    if (pricedPutRows.length === 0) return null
    const y = chartYFromClientY(clientY)
    if (y == null) return null
    return pricedPutRows.reduce((closest, row) => {
      const rowY = yPxForStrike(row.strike)
      const closestY = yPxForStrike(closest.strike)
      if (rowY == null) return closest
      if (closestY == null) return row
      return Math.abs(rowY - y) < Math.abs(closestY - y) ? row : closest
    }, pricedPutRows[0]).strike
  }

  const nearestCallStrikeFromY = (clientY: number): number | null => {
    if (pricedCallRows.length === 0) return null
    const y = chartYFromClientY(clientY)
    if (y == null) return null
    return pricedCallRows.reduce((closest, row) => {
      const rowY = yPxForStrike(row.strike)
      const closestY = yPxForStrike(closest.strike)
      if (rowY == null) return closest
      if (closestY == null) return row
      return Math.abs(rowY - y) < Math.abs(closestY - y) ? row : closest
    }, pricedCallRows[0]).strike
  }

  const updateStrategyStrike = (clientY: number, leg: DragLeg) => {
    if (!onStrategyStrikeChange) return
    if (strategyKind === 'long_call') {
      const nextStrike = nearestCallStrikeFromY(clientY)
      if (nextStrike == null) return
      onStrategyStrikeChange({ shortStrike: null, longStrike: nextStrike })
      return
    }
    if (strategyKind === 'cash_secured_put') {
      const nextStrike = nearestCspPutStrikeFromY(clientY)
      if (nextStrike == null) return
      onStrategyStrikeChange({ shortStrike: nextStrike, longStrike: null })
      return
    }
    if (strategyKind === 'bear_call_spread') {
      if (strategyShortStrike == null || strategyLongStrike == null) return
      const nextStrike = nearestCallSpreadStrikeFromY(clientY, leg)
      if (nextStrike == null) return
      const next =
        leg === 'short'
          ? { shortStrike: nextStrike, longStrike: strategyLongStrike }
          : { shortStrike: strategyShortStrike, longStrike: nextStrike }
      if (next.shortStrike != null && next.longStrike != null && next.shortStrike < next.longStrike) {
        onStrategyStrikeChange(next)
      }
      return
    }
    if (strategyKind !== 'put_credit_spread' && strategyKind !== 'bear_put_spread') return
    if (strategyShortStrike == null || strategyLongStrike == null) return
    const pcs = strategyKind === 'put_credit_spread'
    const nextStrike = nearestPutSpreadStrikeFromY(clientY, leg, pcs)
    if (nextStrike == null) return
    const next =
      leg === 'short'
        ? { shortStrike: nextStrike, longStrike: strategyLongStrike }
        : { shortStrike: strategyShortStrike, longStrike: nextStrike }
    const valid = pcs ? next.shortStrike! > next.longStrike! : next.shortStrike! < next.longStrike!
    if (valid) onStrategyStrikeChange(next)
  }

  const stepPutSpreadStrike = (leg: DragLeg, direction: 1 | -1, pcs: boolean) => {
    if (!onStrategyStrikeChange || strategyShortStrike == null || strategyLongStrike == null) return
    const current = leg === 'short' ? strategyShortStrike : strategyLongStrike
    const candidates = pricedPutRows
      .filter((row) =>
        pcs
          ? leg === 'short'
            ? row.strike > strategyLongStrike!
            : row.strike < strategyShortStrike!
          : leg === 'short'
            ? row.strike < strategyLongStrike!
            : row.strike > strategyShortStrike!,
      )
      .map((row) => row.strike)
    const index = candidates.indexOf(current)
    const next = candidates[clamp(index + direction, 0, candidates.length - 1)]
    if (next == null) return
    onStrategyStrikeChange(
      leg === 'short'
        ? { shortStrike: next, longStrike: strategyLongStrike }
        : { shortStrike: strategyShortStrike, longStrike: next },
    )
  }

  const stepBearCallSpreadStrike = (leg: DragLeg, direction: 1 | -1) => {
    if (!onStrategyStrikeChange || strategyShortStrike == null || strategyLongStrike == null) return
    const current = leg === 'short' ? strategyShortStrike : strategyLongStrike
    const candidates = pricedCallRows
      .filter((row) => (leg === 'short' ? row.strike < strategyLongStrike! : row.strike > strategyShortStrike!))
      .map((row) => row.strike)
    const index = candidates.indexOf(current)
    const next = candidates[clamp(index + direction, 0, candidates.length - 1)]
    if (next == null) return
    onStrategyStrikeChange(
      leg === 'short'
        ? { shortStrike: next, longStrike: strategyLongStrike }
        : { shortStrike: strategyShortStrike, longStrike: next },
    )
  }

  const stepCspPutStrike = (direction: 1 | -1) => {
    if (!onStrategyStrikeChange) return
    const candidates = pricedPutRows.map((row) => row.strike)
    if (candidates.length === 0) return
    const current = strategyShortStrike ?? candidates[0]
    const index = candidates.indexOf(current)
    const next = candidates[clamp(index === -1 ? 0 : index + direction, 0, candidates.length - 1)]
    if (next == null) return
    onStrategyStrikeChange({ shortStrike: next, longStrike: null })
  }

  const stepLongCallStrike = (direction: 1 | -1) => {
    if (!onStrategyStrikeChange || strategyLongStrike == null) return
    const candidates = pricedCallRows.map((row) => row.strike)
    if (candidates.length === 0) return
    const index = candidates.indexOf(strategyLongStrike)
    const next = candidates[clamp(index === -1 ? 0 : index + direction, 0, candidates.length - 1)]
    if (next == null) return
    onStrategyStrikeChange({ shortStrike: null, longStrike: next })
  }
  const railRows = buildOpenInterestBarRows({ strikes, spot, maxRows: null })
    .map((row) => {
      const coordinate = strikeCoordinates[String(row.strike)]
      if (Number.isFinite(coordinate)) {
        return { ...row, laneTopPx: laneTopPxForChartY(coordinate as number) }
      }
      if (!hasScale) return { ...row, laneTopPx: null as number | null }
      const chartY = ((priceMax - row.strike) / (priceMax - priceMin)) * pricePaneHeight
      const laneTopPx = laneTopPxForChartY(chartY)
      return { ...row, laneTopPx: clamp(laneTopPx, 2, laneHeight - 2) }
    })
    .filter((row) => row.laneTopPx == null || (row.laneTopPx >= 0 && row.laneTopPx <= laneHeight))

  return (
    <aside
      className="hidden w-[250px] self-stretch border-l border-slate-800 bg-slate-950/95 text-xs text-slate-300 xl:flex xl:flex-col"
      style={{ minHeight: fullHeight }}
      aria-label="Options open interest by strike"
    >
      <div className="relative shrink-0 border-b border-slate-800" style={{ height: pricePaneHeight }}>
        <div className="absolute inset-x-0 top-0 z-10 border-b border-slate-800 bg-slate-950/95 px-2 py-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="font-semibold text-slate-200">Options OI</span>
            {selected && <span className="text-[10px] text-slate-500">{selected.dte}D</span>}
          </div>
          <label className="sr-only" htmlFor="options-oi-expiration">
            Options expiration
          </label>
          <select
            id="options-oi-expiration"
            className="w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[11px] text-slate-200 outline-none focus:border-cyan-500"
            value={selectedExpiration || ''}
            onChange={(event) => onExpirationChange(event.target.value)}
            disabled={loading || expirations.length === 0}
            aria-label="Options expiration"
          >
            {expirations.length === 0 && <option value="">No expirations</option>}
            {expirations.map((expiration) => (
              <option key={expiration.date} value={expiration.date}>
                {formatExpirationDropdownLabel(expiration)}
              </option>
            ))}
          </select>
        </div>
        <div className="absolute inset-x-0 top-[74px] z-10 grid grid-cols-[1fr_42px_1fr] border-y border-slate-800 bg-slate-950/90 px-2 py-1 text-[10px] uppercase tracking-wide text-slate-500">
          <span>Call</span>
          <span className="text-center">Strike</span>
          <span className="text-right">Put</span>
        </div>
        {loading ? (
          <div className="p-3 text-slate-500">Loading OI...</div>
        ) : railRows.length > 0 ? (
          <>
            <div ref={strikeLaneRef} className="absolute inset-x-0 bottom-0 z-[5]" style={{ top: OPTIONS_STRIKE_OVERLAY_TOP_PX }}>
            {railRows.map((row) => {
              const topStyle =
                row.laneTopPx == null ? undefined : { top: `${row.laneTopPx}px` }
              const rowClassName =
                row.laneTopPx == null
                  ? 'relative grid grid-cols-[1fr_42px_1fr] items-center gap-1 px-2 py-1'
                  : 'absolute left-0 right-0 grid -translate-y-1/2 grid-cols-[1fr_42px_1fr] items-center gap-1 px-2'
              return (
                <div
                  key={row.strike}
                  className={`${rowClassName} text-[10px]`}
                  style={topStyle}
                  title={`Strike ${formatStrike(row.strike)}, calls ${formatOpenInterest(row.callOpenInterest)} open interest, puts ${formatOpenInterest(row.putOpenInterest)} open interest`}
                  aria-label={`Strike ${formatStrike(row.strike)}, calls ${formatOpenInterest(row.callOpenInterest)} open interest, puts ${formatOpenInterest(row.putOpenInterest)} open interest`}
                >
                  <div className="flex h-3 items-center justify-end rounded-sm bg-slate-900">
                    <div
                      className="h-2 rounded-sm bg-emerald-500/80"
                      style={{ width: `${row.callWidthPct}%` }}
                    />
                  </div>
                  <div className="rounded bg-slate-900/95 px-1 text-center font-mono text-slate-300 ring-1 ring-slate-800">
                    {formatStrike(row.strike)}
                  </div>
                  <div className="flex h-3 items-center rounded-sm bg-slate-900">
                    <div
                      className="h-2 rounded-sm bg-rose-500/80"
                      style={{ width: `${row.putWidthPct}%` }}
                    />
                  </div>
                </div>
              )
            })}
            {(strategyKind === 'put_credit_spread' || strategyKind === 'bear_put_spread') &&
              [
                {
                  leg: 'short' as const,
                  label: 'Sell Put',
                  strike: strategyShortStrike,
                  className: 'left-2 border-emerald-400 bg-emerald-500/95 text-white',
                  suffix: 'P' as const,
                },
                {
                  leg: 'long' as const,
                  label: 'Buy Put',
                  strike: strategyLongStrike,
                  className: 'right-2 border-rose-400 bg-rose-500/95 text-white',
                  suffix: 'P' as const,
                },
              ].map((handle) => {
                const pcsMode = strategyKind === 'put_credit_spread'
                const chartY = handle.strike == null ? null : yPxForStrike(handle.strike)
                const topPx = chartY == null || handle.strike == null ? null : laneTopPxForChartY(chartY)
                return topPx == null || handle.strike == null ? null : (
                  <button
                    key={`put-spread-${handle.leg}`}
                    type="button"
                    className={`absolute z-30 flex w-[82px] -translate-y-1/2 cursor-ns-resize items-center justify-center rounded border px-1.5 py-1 font-mono text-[10px] font-semibold shadow-lg ${handle.className}`}
                    style={{ top: topPx }}
                    onPointerDown={(event) => {
                      event.preventDefault()
                      event.currentTarget.setPointerCapture(event.pointerId)
                      dragLegRef.current = handle.leg
                      setDragLeg(handle.leg)
                      updateStrategyStrike(event.clientY, handle.leg)
                    }}
                    onPointerMove={(event) => {
                      if (dragLegRef.current === handle.leg || dragLeg === handle.leg) {
                        updateStrategyStrike(event.clientY, handle.leg)
                      }
                    }}
                    onPointerUp={(event) => {
                      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                        event.currentTarget.releasePointerCapture(event.pointerId)
                      }
                      dragLegRef.current = null
                      setDragLeg(null)
                    }}
                    onLostPointerCapture={() => {
                      dragLegRef.current = null
                      setDragLeg(null)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowUp') {
                        event.preventDefault()
                        stepPutSpreadStrike(handle.leg, 1, pcsMode)
                      }
                      if (event.key === 'ArrowDown') {
                        event.preventDefault()
                        stepPutSpreadStrike(handle.leg, -1, pcsMode)
                      }
                    }}
                    aria-label={`${handle.label} strike ${formatStrike(handle.strike)}`}
                  >
                    {formatStrike(handle.strike)}
                    {handle.suffix}
                  </button>
                )
              })}
            {strategyKind === 'bear_call_spread' &&
              [
                {
                  leg: 'short' as const,
                  label: 'Sell Call',
                  strike: strategyShortStrike,
                  className: 'left-2 border-amber-400 bg-amber-600/95 text-white',
                  suffix: 'C' as const,
                },
                {
                  leg: 'long' as const,
                  label: 'Buy Call',
                  strike: strategyLongStrike,
                  className: 'left-2 border-violet-400 bg-violet-600/95 text-white',
                  suffix: 'C' as const,
                },
              ].map((handle) => {
                const chartY = handle.strike == null ? null : yPxForStrike(handle.strike)
                const topPx = chartY == null || handle.strike == null ? null : laneTopPxForChartY(chartY)
                return topPx == null || handle.strike == null ? null : (
                  <button
                    key={`call-spread-${handle.leg}`}
                    type="button"
                    className={`absolute z-30 flex w-[82px] -translate-y-1/2 cursor-ns-resize items-center justify-center rounded border px-1.5 py-1 font-mono text-[10px] font-semibold shadow-lg ${handle.className}`}
                    style={{ top: topPx }}
                    onPointerDown={(event) => {
                      event.preventDefault()
                      event.currentTarget.setPointerCapture(event.pointerId)
                      dragLegRef.current = handle.leg
                      setDragLeg(handle.leg)
                      updateStrategyStrike(event.clientY, handle.leg)
                    }}
                    onPointerMove={(event) => {
                      if (dragLegRef.current === handle.leg || dragLeg === handle.leg) {
                        updateStrategyStrike(event.clientY, handle.leg)
                      }
                    }}
                    onPointerUp={(event) => {
                      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                        event.currentTarget.releasePointerCapture(event.pointerId)
                      }
                      dragLegRef.current = null
                      setDragLeg(null)
                    }}
                    onLostPointerCapture={() => {
                      dragLegRef.current = null
                      setDragLeg(null)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowUp') {
                        event.preventDefault()
                        stepBearCallSpreadStrike(handle.leg, 1)
                      }
                      if (event.key === 'ArrowDown') {
                        event.preventDefault()
                        stepBearCallSpreadStrike(handle.leg, -1)
                      }
                    }}
                    aria-label={`${handle.label} strike ${formatStrike(handle.strike)}`}
                  >
                    {formatStrike(handle.strike)}
                    {handle.suffix}
                  </button>
                )
              })}
            {strategyKind === 'cash_secured_put' &&
              strategyShortStrike != null &&
              (() => {
                const cy = yPxForStrike(strategyShortStrike)
                const topPx = cy == null ? null : laneTopPxForChartY(cy)
                return topPx == null ? null : (
                  <button
                    key="csp-sell-put"
                    type="button"
                    className="absolute right-2 z-30 flex w-[82px] -translate-y-1/2 cursor-ns-resize items-center justify-center rounded border border-rose-400 bg-rose-600/95 px-1.5 py-1 font-mono text-[10px] font-semibold text-white shadow-lg"
                    style={{ top: topPx }}
                    onPointerDown={(event) => {
                      event.preventDefault()
                      event.currentTarget.setPointerCapture(event.pointerId)
                      dragLegRef.current = 'short'
                      setDragLeg('short')
                      updateStrategyStrike(event.clientY, 'short')
                    }}
                    onPointerMove={(event) => {
                      if (dragLegRef.current === 'short' || dragLeg === 'short') {
                        updateStrategyStrike(event.clientY, 'short')
                      }
                    }}
                    onPointerUp={(event) => {
                      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                        event.currentTarget.releasePointerCapture(event.pointerId)
                      }
                      dragLegRef.current = null
                      setDragLeg(null)
                    }}
                    onLostPointerCapture={() => {
                      dragLegRef.current = null
                      setDragLeg(null)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowUp') {
                        event.preventDefault()
                        stepCspPutStrike(1)
                      }
                      if (event.key === 'ArrowDown') {
                        event.preventDefault()
                        stepCspPutStrike(-1)
                      }
                    }}
                    aria-label={`Cash secured sell put strike ${formatStrike(strategyShortStrike)}`}
                  >
                    {formatStrike(strategyShortStrike)}P
                  </button>
                )
              })()}
            {strategyKind === 'long_call' &&
              strategyLongStrike != null &&
              (() => {
                const cy = yPxForStrike(strategyLongStrike)
                const topPx = cy == null ? null : laneTopPxForChartY(cy)
                return topPx == null ? null : (
                  <button
                    key="long-call"
                    type="button"
                    className="absolute left-2 z-30 flex w-[82px] -translate-y-1/2 cursor-ns-resize items-center justify-center rounded border border-sky-400 bg-sky-600/95 px-1.5 py-1 font-mono text-[10px] font-semibold text-white shadow-lg"
                    style={{ top: topPx }}
                    onPointerDown={(event) => {
                      event.preventDefault()
                      event.currentTarget.setPointerCapture(event.pointerId)
                      dragLegRef.current = 'long'
                      setDragLeg('long')
                      updateStrategyStrike(event.clientY, 'long')
                    }}
                    onPointerMove={(event) => {
                      if (dragLegRef.current === 'long' || dragLeg === 'long') {
                        updateStrategyStrike(event.clientY, 'long')
                      }
                    }}
                    onPointerUp={(event) => {
                      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                        event.currentTarget.releasePointerCapture(event.pointerId)
                      }
                      dragLegRef.current = null
                      setDragLeg(null)
                    }}
                    onLostPointerCapture={() => {
                      dragLegRef.current = null
                      setDragLeg(null)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowUp') {
                        event.preventDefault()
                        stepLongCallStrike(1)
                      }
                      if (event.key === 'ArrowDown') {
                        event.preventDefault()
                        stepLongCallStrike(-1)
                      }
                    }}
                    aria-label={`Buy call strike ${formatStrike(strategyLongStrike)}`}
                  >
                    {formatStrike(strategyLongStrike)}C
                  </button>
                )
              })()}
            </div>
          </>
        ) : (
          <div className="p-3 text-slate-500">{message || 'No useful open interest data'}</div>
        )}
      </div>
      <div className="min-h-0 flex-1 border-t border-slate-800 bg-slate-950/80" aria-hidden="true" />
    </aside>
  )
}
