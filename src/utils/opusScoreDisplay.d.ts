export function getOpusDisplayState(opus?: {
  opus45Confidence?: number
  opus45Grade?: string
  entryDate?: string | number
  daysSinceBuy?: number
  pctChange?: number
  entryPrice?: number
  stopLossPrice?: number
  riskRewardRatio?: number
}): {
  hasActiveSetup: boolean
  label: string
  confidence: number
  grade: string
}
