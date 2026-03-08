export type MarketRegimeLabel = 'Bullish' | 'Mild Bullish' | 'Neutral' | 'Mild Bearish' | 'Bearish'

export function classifyMovingAverageRegime(params: {
  ma10?: number | null
  ma20?: number | null
  ma50?: number | null
  recentMa20?: Array<number | null | undefined>
  recentMa50?: Array<number | null | undefined>
  neutralBandPct?: number
}): MarketRegimeLabel
