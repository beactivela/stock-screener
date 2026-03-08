export interface TopRsCandidate {
  ticker: string
  relativeStrength?: number | null
  industryRank?: number | null
}

export interface TopRsFundamentals {
  qtrEarningsYoY?: number | null
  pctHeldByInst?: number | null
  profitMargin?: number | null
  operatingMargin?: number | null
}

export interface TopRsResult extends TopRsCandidate {
  topRsScore: number
  qualifiesForTopRs: true
}

export function buildTopRs50(
  results?: TopRsCandidate[],
  fundamentalsByTicker?: Record<string, TopRsFundamentals>,
): TopRsResult[]

