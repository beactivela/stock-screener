/**
 * Opus4.5 Chart Utilities
 * 
 * Utilities for formatting Opus4.5 signals from the server API for chart display.
 * All signal detection is done server-side (server/opus45Signal.js).
 */

// ============================================================================
// TYPES
// ============================================================================

/** Opus4.5 signal marker from server API */
export interface Opus45Marker {
  time: number          // Unix timestamp in seconds (for lightweight-charts)
  type: 'buy' | 'sell'  // Signal type
  price: number         // Price at signal
  confidence?: number   // Confidence score (0-100) for buy signals
  grade?: string | null // Letter grade (A+, A, B+, etc.) for buy signals
  reason?: string       // Human-readable reason
  stopLoss?: number     // Stop loss price (for buy signals)
  target?: number       // Target price (for buy signals)
}

/** Chart marker format for lightweight-charts */
export interface ChartMarker {
  time: number
  position: 'belowBar' | 'aboveBar'
  shape: 'arrowUp' | 'arrowDown'
  color: string
  text?: string
  size?: number
}

// ============================================================================
// CHART UTILITIES
// ============================================================================

/**
 * Convert Opus45 markers from server API to lightweight-charts marker format
 * 
 * @param data - Object with buySignals and sellSignals arrays from server API
 * @returns Markers formatted for lightweight-charts
 */
export function toChartMarkers(data: { buySignals: Opus45Marker[], sellSignals: Opus45Marker[] } | null): ChartMarker[] {
  if (!data) return []
  
  const markers: ChartMarker[] = []
  
  // Add buy signals (green arrows up below bar)
  for (const buy of data.buySignals) {
    markers.push({
      time: buy.time as any,
      position: 'belowBar',
      shape: 'arrowUp',
      color: '#22c55e',  // Green
      text: 'Buy',
      size: 1
    })
  }
  
  // Add sell signals (red arrows down above bar)
  for (const sell of data.sellSignals) {
    markers.push({
      time: sell.time as any,
      position: 'aboveBar',
      shape: 'arrowDown',
      color: '#ef4444',  // Red
      text: 'Sell',
      size: 1
    })
  }
  
  // Sort by time
  markers.sort((a, b) => (a.time as number) - (b.time as number))
  
  return markers
}
