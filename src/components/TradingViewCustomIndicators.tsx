import { useEffect, useMemo, useRef } from 'react'
import { ColorType, createChart, type IChartApi, type ISeriesApi, type Time } from 'lightweight-charts'

export interface CustomIndicatorPoint {
  time: number
  value?: number
}

export interface CustomGammaLevel {
  strike: number
  netGammaUsd: number
  absGammaUsd: number
}

export interface CustomGammaData {
  ok: boolean
  netGammaUsd: number | null
  regime: 'long_gamma' | 'short_gamma' | 'neutral'
  topLevels: CustomGammaLevel[]
  monthlyOnly: boolean
  message?: string | null
}

export interface TradingViewCustomIndicatorsProps {
  rsiData: CustomIndicatorPoint[]
  vcpContractionData: CustomIndicatorPoint[]
  vcpStage2Data: CustomIndicatorPoint[]
  gammaData?: CustomGammaData | null
}

const PANEL_OPTIONS = {
  layout: { background: { type: ColorType.Solid, color: '#0f172a' }, textColor: '#94a3b8' },
  grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
  timeScale: { timeVisible: true, secondsVisible: false },
  rightPriceScale: { visible: false },
}

function dedupeByTime(points: CustomIndicatorPoint[]): CustomIndicatorPoint[] {
  return [...points]
    .sort((a, b) => a.time - b.time)
    .reduce<CustomIndicatorPoint[]>((acc, point) => {
      if (!Number.isFinite(point.time)) return acc
      const previous = acc[acc.length - 1]
      if (!previous || previous.time < point.time) acc.push(point)
      else if (previous.time === point.time) acc[acc.length - 1] = point
      return acc
    }, [])
}

function valueAtTime(points: CustomIndicatorPoint[], time: Time | string | number | undefined): number {
  if (time == null) return 0
  const numericTime = typeof time === 'number' ? time : Number(time)
  if (!Number.isFinite(numericTime)) return 0
  const exact = points.find((point) => point.time === numericTime)
  if (exact?.value != null) return exact.value
  const prior = [...points].reverse().find((point) => point.time <= numericTime && point.value != null)
  return prior?.value ?? 0
}

function formatUsdCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '$0'
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`
  return `${sign}$${abs.toFixed(0)}`
}

function formatGammaUsd(value: number | null | undefined): string {
  const formatted = formatUsdCompact(value)
  return value != null && value > 0 ? `+${formatted}` : formatted
}

function formatStrike(value: number): string {
  if (!Number.isFinite(value)) return '-'
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '')
}

function formatRegime(regime: CustomGammaData['regime']): string {
  if (regime === 'long_gamma') return 'Long gamma'
  if (regime === 'short_gamma') return 'Short gamma'
  return 'Neutral gamma'
}

export default function TradingViewCustomIndicators({
  rsiData,
  vcpContractionData,
  vcpStage2Data,
  gammaData,
}: TradingViewCustomIndicatorsProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const rsiRef = useRef<HTMLDivElement>(null)
  const vcpRef = useRef<HTMLDivElement>(null)
  const stage2Ref = useRef<HTMLDivElement>(null)

  const seriesData = useMemo(() => ({
    rsi: dedupeByTime(rsiData),
    vcp: dedupeByTime(vcpContractionData),
    stage2: dedupeByTime(vcpStage2Data),
  }), [rsiData, vcpContractionData, vcpStage2Data])

  useEffect(() => {
    if (!wrapperRef.current || !rsiRef.current || !vcpRef.current || !stage2Ref.current) return
    const width = wrapperRef.current.clientWidth
    if (width <= 0 || seriesData.rsi.length === 0) return

    const charts: IChartApi[] = []
    const rsiChart = createChart(rsiRef.current, {
      ...PANEL_OPTIONS,
      width,
      height: 170,
      leftPriceScale: { visible: true, borderColor: '#334155', minimumWidth: 60, scaleMargins: { top: 0.1, bottom: 0.1 } },
    })
    const vcpChart = createChart(vcpRef.current, {
      ...PANEL_OPTIONS,
      width,
      height: 120,
      leftPriceScale: { visible: true, borderColor: '#334155', minimumWidth: 60, scaleMargins: { top: 0.1, bottom: 0.1 } },
    })
    const stage2Chart = createChart(stage2Ref.current, {
      ...PANEL_OPTIONS,
      width,
      height: 110,
      leftPriceScale: { visible: true, borderColor: '#334155', minimumWidth: 60, scaleMargins: { top: 0.15, bottom: 0.15 } },
    })
    charts.push(rsiChart, vcpChart, stage2Chart)

    const rsiSeries = rsiChart.addLineSeries({ color: '#06b6d4', lineWidth: 2, priceScaleId: 'left' })
    rsiSeries.setData(seriesData.rsi as any)
    rsiSeries.createPriceLine({ price: 70, color: '#5eead4', lineWidth: 1, lineStyle: 1, axisLabelVisible: true, title: 'Overbought' })
    rsiSeries.createPriceLine({ price: 30, color: '#5eead4', lineWidth: 1, lineStyle: 1, axisLabelVisible: true, title: 'Oversold' })

    const vcpSeries = vcpChart.addLineSeries({ color: '#a855f7', lineWidth: 2, priceScaleId: 'left' })
    vcpSeries.setData(seriesData.vcp as any)
    vcpSeries.createPriceLine({ price: 1, color: '#a855f7', lineWidth: 1, lineStyle: 1, axisLabelVisible: true })

    const stage2Series = stage2Chart.addLineSeries({
      color: '#22c55e',
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
      priceScaleId: 'left',
    })
    stage2Series.setData(seriesData.stage2 as any)
    stage2Series.createPriceLine({ price: 1, color: '#16a34a', lineWidth: 1, lineStyle: 1, axisLabelVisible: true, title: 'Pass' })
    stage2Series.createPriceLine({ price: 0, color: '#475569', lineWidth: 1, lineStyle: 1, axisLabelVisible: true, title: 'Fail' })

    let crosshairSyncing = false
    const syncCrosshair = (time: Time | undefined) => {
      if (!time || crosshairSyncing) return
      crosshairSyncing = true
      try {
        rsiChart.setCrosshairPosition(valueAtTime(seriesData.rsi, time), time, rsiSeries as ISeriesApi<'Line'>)
        vcpChart.setCrosshairPosition(valueAtTime(seriesData.vcp, time), time, vcpSeries as ISeriesApi<'Line'>)
        stage2Chart.setCrosshairPosition(valueAtTime(seriesData.stage2, time), time, stage2Series as ISeriesApi<'Line'>)
      } finally {
        crosshairSyncing = false
      }
    }
    const clearCrosshair = () => {
      if (crosshairSyncing) return
      charts.forEach((chart) => chart.clearCrosshairPosition())
    }
    charts.forEach((chart) => {
      chart.subscribeCrosshairMove((param) => {
        if (param.time != null) syncCrosshair(param.time)
        else clearCrosshair()
      })
    })

    let rangeSyncing = false
    const syncRange = (range: { from: number; to: number } | null) => {
      if (!range || rangeSyncing) return
      rangeSyncing = true
      charts.forEach((chart) => chart.timeScale().setVisibleLogicalRange(range))
      rangeSyncing = false
    }
    charts.forEach((chart) => chart.timeScale().subscribeVisibleLogicalRangeChange(syncRange))

    rsiChart.timeScale().fitContent()
    const range = rsiChart.timeScale().getVisibleLogicalRange()
    if (range) charts.forEach((chart) => chart.timeScale().setVisibleLogicalRange(range))

    const resize = () => {
      const nextWidth = wrapperRef.current?.clientWidth ?? 0
      if (nextWidth > 0) charts.forEach((chart) => chart.applyOptions({ width: nextWidth }))
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(wrapperRef.current)

    return () => {
      resizeObserver.disconnect()
      charts.forEach((chart) => chart.remove())
    }
  }, [seriesData])

  return (
    <div ref={wrapperRef} className="border-t border-slate-800">
      <div className="border-b border-slate-800">
        <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs font-semibold text-emerald-400 bg-slate-900/50">
          <span>GEX Gamma Exposure - Practical Net Gamma</span>
          {gammaData?.ok ? (
            <>
              <span className={`rounded px-1.5 py-0.5 font-medium ${
                gammaData.regime === 'long_gamma'
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : gammaData.regime === 'short_gamma'
                    ? 'bg-rose-500/15 text-rose-300'
                    : 'bg-slate-800 text-slate-300'
              }`}>
                {formatRegime(gammaData.regime)}
              </span>
              <span className="text-slate-500">
                Net {formatGammaUsd(gammaData.netGammaUsd)} · {gammaData.monthlyOnly ? 'monthly expirations' : '7-180 DTE'}
              </span>
            </>
          ) : (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 font-medium text-slate-400">
              {gammaData?.message || 'No useful gamma data'}
            </span>
          )}
        </div>
        <div className="bg-slate-950 px-3 py-3">
          {gammaData?.ok && gammaData.topLevels.length > 0 ? (
            <div className="space-y-2">
              {gammaData.topLevels.slice(0, 5).map((level) => {
                const positive = level.netGammaUsd >= 0
                const maxAbs = Math.max(...gammaData.topLevels.map((item) => Math.abs(item.netGammaUsd)), 1)
                const widthPct = Math.max(8, Math.min(100, (Math.abs(level.netGammaUsd) / maxAbs) * 100))
                return (
                  <div key={`${level.strike}-${level.netGammaUsd}`} className="grid grid-cols-[64px_minmax(0,1fr)_88px] items-center gap-2 text-xs">
                    <div className="font-mono text-slate-300">{formatStrike(level.strike)}</div>
                    <div className="h-7 overflow-hidden rounded bg-slate-900 ring-1 ring-slate-800">
                      <div
                        className={`flex h-full items-center px-2 font-medium text-white ${
                          positive ? 'bg-emerald-500/80' : 'bg-rose-500/80'
                        }`}
                        style={{ width: `${widthPct}%` }}
                      >
                        GEX {formatGammaUsd(level.netGammaUsd)} {formatStrike(level.strike)}
                      </div>
                    </div>
                    <div className={`text-right font-mono ${positive ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {formatGammaUsd(level.netGammaUsd)}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="rounded bg-slate-900/80 px-3 py-3 text-sm text-slate-400 ring-1 ring-slate-800">
              {gammaData?.message || 'No useful gamma data'}
            </div>
          )}
        </div>
      </div>
      <div className="border-b border-slate-800">
        <div className="px-3 py-1.5 text-xs font-semibold text-cyan-400 bg-slate-900/50">
          RSI (14) - Relative Strength Index
        </div>
        <div className="relative">
          <div ref={rsiRef} style={{ height: 170 }} />
          <div className="absolute top-2 left-2 bg-slate-900/95 backdrop-blur-sm px-3 py-1.5 rounded text-xs text-cyan-400 font-medium pointer-events-none border border-cyan-500/50 shadow-lg">
            RSI (14) • Overbought &gt;70 • Oversold &lt;30
          </div>
        </div>
      </div>
      <div className="border-b border-slate-800">
        <div className="px-3 py-1.5 text-xs font-semibold text-purple-400 bg-slate-900/50">
          VCP Contraction - Volatility Compression Pattern
        </div>
        <div className="relative">
          <div ref={vcpRef} style={{ height: 120 }} />
          <div className="absolute top-2 left-2 bg-slate-900/95 backdrop-blur-sm px-3 py-1.5 rounded text-xs text-purple-400 font-medium pointer-events-none border border-purple-500/50 shadow-lg">
            VCP Score (consecutive smaller pullbacks)
          </div>
        </div>
      </div>
      <div>
        <div className="px-3 py-1.5 text-xs font-semibold text-emerald-400 bg-slate-900/50">
          VCP Stage 2 - Strict Minervini Filter
        </div>
        <div className="relative">
          <div ref={stage2Ref} style={{ height: 110 }} />
          <div className="absolute top-2 left-2 bg-slate-900/95 backdrop-blur-sm px-3 py-1.5 rounded text-xs text-emerald-400 font-medium pointer-events-none border border-emerald-500/50 shadow-lg">
            Pass = price above rising 50/150 MA + higher highs/lows + current RS &gt;= 80
          </div>
        </div>
      </div>
    </div>
  )
}
