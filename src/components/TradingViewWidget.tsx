/**
 * TradingView Advanced Chart Widget
 * Embeds the TradingView chart with moving averages (10, 20, 50, 150) and RSI
 * Based on official TradingView React implementation
 */
import { useEffect, useRef, memo, useMemo } from 'react'
import TradingViewCustomIndicators, { type CustomGammaData, type CustomIndicatorPoint } from './TradingViewCustomIndicators'

interface TradingViewWidgetProps {
  ticker: string
  theme?: 'light' | 'dark'
  height?: number
  customIndicators?: {
    rsiData: CustomIndicatorPoint[]
    vcpContractionData: CustomIndicatorPoint[]
    vcpStage2Data: CustomIndicatorPoint[]
    gammaData?: CustomGammaData | null
    closePriceData?: CustomIndicatorPoint[]
  }
}

// TradingView Advanced Chart layout constants (empirically calibrated for dark theme)
// The iframe has: top toolbar (~38px) + chart pane + volume pane + time axis (~25px)
const TV_TOP_TOOLBAR_PX = 38      // height of the top toolbar / controls row
const TV_TIME_AXIS_PX = 25        // height of the time axis at the bottom
const TV_VOLUME_RATIO = 0.18      // volume pane as a fraction of the total chart pane
const TV_MARGIN_TOP = 0.18        // TV auto-scale margin above the data max (uses OHLC highs, wider than close-based max)
const TV_MARGIN_BOTTOM = 0.08     // TV auto-scale margin below the data min
const TV_LEFT_TOOLBAR_PX = 50     // left drawing-tools panel width
const TV_RIGHT_AXIS_PX = 65       // right price-axis width

function formatStrike(value: number): string {
  if (!Number.isFinite(value)) return '-'
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '')
}

function TradingViewWidget({ ticker, theme = 'dark', height = 600, customIndicators }: TradingViewWidgetProps) {
  const widgetHostRef = useRef<HTMLDivElement>(null)
  const showCustomIndicators = Boolean(customIndicators)

  const tvPriceGeometry = useMemo(() => {
    const prices = (customIndicators?.closePriceData ?? [])
      .map((d) => d.value)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))

    if (prices.length === 0) return null

    const dataMin = Math.min(...prices)
    const dataMax = Math.max(...prices)
    const dataRange = Math.max(dataMax - dataMin, 1)

    // Replicate TV's auto-scale margins
    const scaleMin = dataMin - dataRange * TV_MARGIN_BOTTOM
    const scaleMax = dataMax + dataRange * TV_MARGIN_TOP
    const scaleRange = scaleMax - scaleMin

    // Pixel geometry inside the iframe (height minus the copyright footer we render outside)
    const chartAreaH = height - 32
    const paneH = chartAreaH - TV_TOP_TOOLBAR_PX - TV_TIME_AXIS_PX
    const volumeH = paneH * TV_VOLUME_RATIO
    const priceH = paneH - volumeH

    return { scaleMin, scaleMax, scaleRange, priceH }
  }, [customIndicators, height])

  // Compute GEX overlay line positions using the full price history to estimate
  // the TV chart's auto-scale price range.
  const gexOverlay = useMemo(() => {
    const levels = customIndicators?.gammaData?.ok ? customIndicators.gammaData.topLevels.slice(0, 5) : []
    if (!levels.length || !tvPriceGeometry) return null

    return levels
      .map((level) => ({
        strike: level.strike,
        positive: level.netGammaUsd >= 0,
        y: TV_TOP_TOOLBAR_PX + ((tvPriceGeometry.scaleMax - level.strike) / tvPriceGeometry.scaleRange) * tvPriceGeometry.priceH,
      }))
      .filter((l) => l.y >= TV_TOP_TOOLBAR_PX && l.y <= TV_TOP_TOOLBAR_PX + tvPriceGeometry.priceH)
  }, [customIndicators, tvPriceGeometry])

  useEffect(() => {
    if (!widgetHostRef.current) return
    widgetHostRef.current.innerHTML = `
      <div class="tradingview-widget-container__widget" style="height: ${height - 32}px; width: 100%;"></div>
    `
    const movingAverageStudies = [
      {
        id: 'MASimple@tv-basicstudies',
        version: 74,
        inputs: {
          length: 10,
          source: 'close',
          offset: 0,
        },
        styles: {
          plot_0: {
            linestyle: 0,
            linewidth: 1,
            plottype: 0,
            trackPrice: false,
            transparency: 0,
            visible: true,
            color: '#eab308',
          },
        },
      },
      {
        id: 'MASimple@tv-basicstudies',
        version: 74,
        inputs: {
          length: 20,
          source: 'close',
          offset: 0,
        },
        styles: {
          plot_0: {
            linestyle: 0,
            linewidth: 1,
            plottype: 0,
            trackPrice: false,
            transparency: 0,
            visible: true,
            color: '#3b82f6',
          },
        },
      },
      {
        id: 'MASimple@tv-basicstudies',
        version: 74,
        inputs: {
          length: 50,
          source: 'close',
          offset: 0,
        },
        styles: {
          plot_0: {
            linestyle: 0,
            linewidth: 1,
            plottype: 0,
            trackPrice: false,
            transparency: 0,
            visible: true,
            color: '#8b5cf6',
          },
        },
      },
      {
        id: 'MASimple@tv-basicstudies',
        version: 74,
        inputs: {
          length: 150,
          source: 'close',
          offset: 0,
        },
        styles: {
          plot_0: {
            linestyle: 0,
            linewidth: 1,
            plottype: 0,
            trackPrice: false,
            transparency: 0,
            visible: true,
            color: '#ef4444',
          },
        },
      },
    ]
    const studies = showCustomIndicators
      ? movingAverageStudies
      : [
          ...movingAverageStudies,
          {
            id: 'RSI@tv-basicstudies',
            version: 49,
            inputs: {
              length: 14,
              source: 'close',
            },
          },
        ]

    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'
    script.type = 'text/javascript'
    script.async = true

    script.innerHTML = JSON.stringify({
      width: '100%',
      height: height - 32,
      symbol: ticker,
      interval: 'D',
      timezone: 'Etc/UTC',
      theme: theme,
      style: '1',
      locale: 'en',
      allow_symbol_change: true,
      calendar: false,
      hide_side_toolbar: false,
      hide_top_toolbar: false,
      hide_legend: false,
      hide_volume: false,
      save_image: true,
      withdateranges: false,
      support_host: 'https://www.tradingview.com',
      studies,
    })

    const loadTimer = window.setTimeout(() => {
      widgetHostRef.current?.appendChild(script)
    }, 0)

    return () => {
      window.clearTimeout(loadTimer)
      if (widgetHostRef.current) {
        widgetHostRef.current.innerHTML = ''
      }
    }
  }, [ticker, theme, height, showCustomIndicators])

  return (
    <div className="w-full">
      <div
        className="tradingview-widget-container"
        style={{ height: `${height}px`, width: '100%', position: 'relative' }}
      >
          <div ref={widgetHostRef} style={{ height: `${height - 32}px`, width: '100%' }} />

          {/* GEX overlay — sits on top of the TV iframe, pointer-events disabled so the chart stays interactive */}
          {gexOverlay && gexOverlay.length > 0 && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: `${height - 32}px`,
                pointerEvents: 'none',
                zIndex: 5,
                overflow: 'hidden',
              }}
            >
              {gexOverlay.map((level) => {
                const color = level.positive ? '#10b981' : '#f43f5e'
                return (
                  <div
                    key={level.strike}
                    style={{
                      position: 'absolute',
                      top: `${level.y}px`,
                      left: 0,
                      right: 0,
                    }}
                  >
                    {/* Dashed horizontal line spanning chart plot area */}
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: `${TV_LEFT_TOOLBAR_PX}px`,
                        right: `${TV_RIGHT_AXIS_PX}px`,
                        borderTop: `1px dashed ${color}`,
                        opacity: 0.9,
                      }}
                    />
                    {/* Price label just left of the right axis */}
                    <span
                      style={{
                        position: 'absolute',
                        right: `${TV_RIGHT_AXIS_PX + 4}px`,
                        top: '-10px',
                        fontSize: '10px',
                        lineHeight: '18px',
                        color,
                        background: 'rgba(15,23,42,0.92)',
                        padding: '0 5px',
                        borderRadius: '3px',
                        border: `1px solid ${color}99`,
                        whiteSpace: 'nowrap',
                        fontFamily: 'ui-monospace, monospace',
                        fontWeight: 600,
                      }}
                    >
                      {formatStrike(level.strike)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          <div className="tradingview-widget-copyright" style={{ textAlign: 'center', height: '32px', lineHeight: '32px' }}>
            <a
              href={`https://www.tradingview.com/symbols/${ticker}/`}
              rel="noopener noreferrer"
              target="_blank"
              className="text-xs text-slate-500 hover:text-slate-400"
            >
              <span>{ticker} chart</span>
            </a>
            <span className="text-xs text-slate-500"> by TradingView</span>
          </div>
      </div>
      {customIndicators && (
        <TradingViewCustomIndicators
          rsiData={customIndicators.rsiData}
          vcpContractionData={customIndicators.vcpContractionData}
          vcpStage2Data={customIndicators.vcpStage2Data}
          gammaData={customIndicators.gammaData}
        />
      )}
    </div>
  )
}

export default memo(TradingViewWidget)
