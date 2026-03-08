/**
 * TradingView RSI Widget - Compact RSI chart using Advanced Chart widget
 * Configured to show only RSI indicator in a minimal layout
 */
import { useEffect, useRef, memo } from 'react'

interface TradingViewRsiWidgetProps {
  ticker: string
  /** Constrain width to align with chart plot area (exclude price scale). Default true. */
  alignWithChart?: boolean
}

// Map Yahoo Finance tickers to TradingView symbols
function toTradingViewSymbol(ticker: string): string {
  const mapping: Record<string, string> = {
    '^GSPC': 'SPX',           // S&P 500 Index
    '^IXIC': 'IXIC',          // NASDAQ Composite Index
    '^RUT': 'RUT',            // Russell 2000 Index
    '^DJI': 'DJI',            // Dow Jones Industrial Average
  }
  return mapping[ticker] || ticker
}

function TradingViewRsiWidget({ ticker, alignWithChart = true }: TradingViewRsiWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const tvSymbol = toTradingViewSymbol(ticker)

  useEffect(() => {
    if (!containerRef.current) return

    // Clear previous content
    containerRef.current.innerHTML = ''

    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'
    script.type = 'text/javascript'
    script.async = true

    // TradingView's Beactive-style RSI configuration:
    // - RSI(14) with custom colors
    // - Show MA50 and MA150 on main chart (for Beactive trend context)
    script.innerHTML = JSON.stringify({
      autosize: false,
      width: '100%',
      height: 120,
      symbol: tvSymbol,
      interval: 'D',
      timezone: 'Etc/UTC',
      theme: 'dark',
      style: '1',
      locale: 'en',
      allow_symbol_change: false,
      calendar: false,
      hide_side_toolbar: true,
      hide_top_toolbar: true,
      hide_legend: true,
      save_image: false,
      hide_volume: true,
      withdateranges: false,
      support_host: 'https://www.tradingview.com',
      backgroundColor: 'rgba(15, 23, 42, 0.6)',
      gridColor: 'rgba(30, 41, 59, 1)',
      studies: [
        // RSI(14) - core of Beactive RSI
        {
          id: 'RSI@tv-basicstudies',
          version: 49,
          inputs: {
            length: 14,
            source: 'close',
          },
          styles: {
            plot_0: {
              linestyle: 0,
              linewidth: 2,
              plottype: 0,
              trackPrice: false,
              transparency: 0,
              visible: true,
              color: '#22c55e', // Green line
            },
          },
        },
      ],
      // Hide main chart, show only RSI panel
      studies_overrides: {
        'volume.volume.color.0': 'rgba(0,0,0,0)',
        'volume.volume.color.1': 'rgba(0,0,0,0)',
        // RSI levels
        'relative strength index.upper band': 70,
        'relative strength index.lower band': 30,
        'relative strength index.hlines background': 'rgba(148, 163, 184, 0.1)',
      },
      overrides: {
        'mainSeriesProperties.visible': false,
        'paneProperties.background': 'rgba(15, 23, 42, 0.6)',
        'paneProperties.backgroundGradientStartColor': 'rgba(15, 23, 42, 0.6)',
        'paneProperties.backgroundGradientEndColor': 'rgba(15, 23, 42, 0.6)',
        'paneProperties.vertGridProperties.color': 'rgba(30, 41, 59, 0.5)',
        'paneProperties.horzGridProperties.color': 'rgba(30, 41, 59, 0.5)',
      },
    })

    const wrapper = document.createElement('div')
    wrapper.className = 'tradingview-widget-container__widget'
    wrapper.style.height = '100%'
    wrapper.style.width = '100%'
    containerRef.current.appendChild(wrapper)
    wrapper.appendChild(script)

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = ''
      }
    }
  }, [ticker, tvSymbol])

  return (
    <div className={`${alignWithChart ? 'w-[calc(100%-48px)]' : ''}`}>
      <div className="text-[10px] text-slate-400 mb-1">
        Beactive RSI Trend (14)
        <span className="ml-2 text-slate-500">· TradingView RSI (green when bullish trend: close &gt; MA50 &amp; MA150)</span>
      </div>
      <div
        ref={containerRef}
        className="h-[120px] rounded border border-slate-800 bg-slate-950/60 overflow-hidden"
      />
    </div>
  )
}

export default memo(TradingViewRsiWidget)
