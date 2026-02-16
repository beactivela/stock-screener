/**
 * Build industry trend maps (3M, 6M, 1Y, YTD) from API industry-trend payload.
 * Used by Dashboard for table columns and after fetch operations.
 */
interface IndustryGroup {
  industry: string
  industryAvg3Mo?: number | null
  industryAvg6Mo?: number | null
  industryAvg1Y?: number | null
  industryYtd?: number | null
  tickers?: Array<{ change3mo?: number | null; change6mo?: number | null; change1y?: number | null; ytd?: number | null }>
}

export interface IndustryMaps {
  map3m: Record<string, number>
  map6m: Record<string, number>
  map1y: Record<string, number>
  mapYtd: Record<string, number>
}

export function buildIndustryMaps(industries: IndustryGroup[] | undefined): IndustryMaps {
  const map3m: Record<string, number> = {}
  const map6m: Record<string, number> = {}
  const map1y: Record<string, number> = {}
  const mapYtd: Record<string, number> = {}

  for (const g of industries ?? []) {
    let trend3m = g.industryAvg3Mo
    if (trend3m == null && g.tickers?.length) {
      const withChange = g.tickers.filter((t) => t.change3mo != null)
      if (withChange.length) trend3m = withChange.reduce((s, t) => s + (t.change3mo ?? 0), 0) / withChange.length
    }
    let trend6m = g.industryAvg6Mo
    if (trend6m == null && g.tickers?.length) {
      const withChange = g.tickers.filter((t) => t.change6mo != null)
      if (withChange.length) trend6m = withChange.reduce((s, t) => s + (t.change6mo ?? 0), 0) / withChange.length
    }
    let trend1y = g.industryAvg1Y
    if (trend1y == null && g.tickers?.length) {
      const withChange = g.tickers.filter((t) => t.change1y != null)
      if (withChange.length) trend1y = withChange.reduce((s, t) => s + (t.change1y ?? 0), 0) / withChange.length
    }
    let trendYtd = g.industryYtd
    if (trendYtd == null && g.tickers?.length) {
      const withChange = g.tickers.filter((t) => t.ytd != null)
      if (withChange.length) trendYtd = withChange.reduce((s, t) => s + (t.ytd ?? 0), 0) / withChange.length
    }
    if (trend3m != null && !Number.isNaN(trend3m)) map3m[g.industry] = trend3m
    if (trend6m != null && !Number.isNaN(trend6m)) map6m[g.industry] = trend6m
    if (trend1y != null && !Number.isNaN(trend1y)) map1y[g.industry] = trend1y
    if (trendYtd != null && !Number.isNaN(trendYtd)) mapYtd[g.industry] = trendYtd
  }

  return { map3m, map6m, map1y, mapYtd }
}
