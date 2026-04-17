export type BreadthTrendLabel =
  | 'Strong Negative'
  | 'Negative'
  | 'Neutral Negative'
  | 'Neutral'
  | 'Neutral Positive'
  | 'Bullish'
  | 'Strong Bullish'

export type MarketExposureLabel = 'Bearish' | 'Neutral' | 'Semi Bullish' | 'Bullish'

export interface BreadthTrendRating {
  score: 1 | 2 | 3 | 4 | 5 | 6 | 7
  label: BreadthTrendLabel
  angle: number | null
  exposureLabel: MarketExposureLabel
  exposurePercentage: 20 | 30 | 40 | 50 | 60 | 70 | 80
}

export interface BreadthTrendSegment {
  score: 1 | 2 | 3 | 4 | 5 | 6 | 7
  label: BreadthTrendLabel
  shortLabel: string
  className: string
  exposureLabel: MarketExposureLabel
  exposurePercentage: 20 | 30 | 40 | 50 | 60 | 70 | 80
}

export const BREADTH_TREND_SEGMENTS: BreadthTrendSegment[]

export function getMarketExposureForBreadthScore(
  score: 1 | 2 | 3 | 4 | 5 | 6 | 7,
): Pick<BreadthTrendRating, 'exposureLabel' | 'exposurePercentage'>

export function getBreadthTrendRatingFromAngle(angle?: number | null): BreadthTrendRating

export function getBreadthTrendRatingFromRecentMa50(
  recentMa50: Array<number | null | undefined>,
): BreadthTrendRating
