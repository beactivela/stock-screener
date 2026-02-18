/**
 * TradingView Advanced Chart Widget
 * Embeds the TradingView chart with moving averages (10, 20, 50, 150) and RSI
 * Based on official TradingView React implementation
 */
import { useEffect, useRef, memo } from 'react'

interface TradingViewWidgetProps {
  ticker: string
  theme?: 'light' | 'dark'
  height?: number
}

function TradingViewWidget({ ticker, theme = 'dark', height = 600 }: TradingViewWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'
    script.type = 'text/javascript'
    script.async = true
    
    // Use template literal like official TradingView example
    // This format works more reliably than JSON.stringify
    script.innerHTML = JSON.stringify({
      width: '100%',
      height: height - 32, // Explicit height for the widget (minus footer)
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
      // Studies with custom colors for MAs
      studies: [
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
        {
          id: 'RSI@tv-basicstudies',
          version: 49,
          inputs: {
            length: 14,
            source: 'close',
          },
        },
      ],
    })

    containerRef.current.appendChild(script)

    return () => {
      // Cleanup on unmount or ticker change
      if (containerRef.current) {
        containerRef.current.innerHTML = `
          <div class="tradingview-widget-container__widget" style="height: ${height - 32}px; width: 100%;"></div>
        `
      }
    }
  }, [ticker, theme, height])

  return (
    <div 
      className="tradingview-widget-container" 
      ref={containerRef}
      style={{ height: `${height}px`, width: '100%' }}
    >
      <div 
        className="tradingview-widget-container__widget" 
        style={{ height: `${height - 32}px`, width: '100%' }}
      />
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
  )
}

export default memo(TradingViewWidget)
