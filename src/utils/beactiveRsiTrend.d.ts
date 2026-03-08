export type BeactiveTrendColor = 'green' | 'red'

export interface BeactiveRsiPoint {
  close: number
  rsi: number | null
  ma50: number | null
  ma150: number | null
  trendColor: BeactiveTrendColor | null
  bullishFill: boolean
  bearishFill: boolean
}

export function calculateBeactiveRsiTrend(closes: number[], rsiLength?: number): BeactiveRsiPoint[]
