export type BreadthTrendLabel =
  | 'Strong Negative'
  | 'Negative'
  | 'Neutral Negative'
  | 'Neutral'
  | 'Neutral Positive'
  | 'Bullish'
  | 'Strong Bullish'

export interface BreadthTrendRating {
  score: 1 | 2 | 3 | 4 | 5 | 6 | 7
  label: BreadthTrendLabel
  angle: number | null
}

export interface BreadthTrendSegment {
  score: 1 | 2 | 3 | 4 | 5 | 6 | 7
  label: BreadthTrendLabel
  shortLabel: string
  className: string
}

export const BREADTH_TREND_SEGMENTS: BreadthTrendSegment[]

export function getBreadthTrendRatingFromAngle(angle?: number | null): BreadthTrendRating

export function getBreadthTrendRatingFromRecentMa50(
  recentMa50: Array<number | null | undefined>,
): BreadthTrendRating
