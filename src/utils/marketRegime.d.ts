export type MarketRegimeLabel = 'Risk ON' | 'Risk OFF'

export function classifyMovingAverageRegime(params: {
  close?: number | null
  ma10?: number | null
  ma20?: number | null
  ma50?: number | null
  recentMa20?: Array<number | null | undefined>
  recentMa50?: Array<number | null | undefined>
  neutralBandPct?: number
}): MarketRegimeLabel
