export interface IndustryChartRow {
  perf1M?: number | null
  perf3M?: number | null
  perf6M?: number | null
}

export interface IndustryChartSegment {
  id: 'perf1M' | 'perf1MTo3M' | 'perf3MTo6M'
  start: number
  end: number
}

export interface IndustrySparklinePoint {
  x: number
  y: number
}

export interface IndustrySparklineMonthlyPoint extends IndustrySparklinePoint {
  monthOffset: number
}

export interface IndustrySparklinePathOptions {
  width?: number
  height?: number
  maxAbs: number
  paddingY?: number
}

export function buildIndustrySparklinePoints(row: IndustryChartRow): IndustrySparklinePoint[]
export function buildIndustrySparklineMonthlyPoints(row: IndustryChartRow): IndustrySparklineMonthlyPoint[]
export function sparklineXToMonthOffset(xRatio: number): number
export function isIndustrySparklineDowntrend(row: IndustryChartRow): boolean
export function getIndustryLastMonthSegmentColor(row: IndustryChartRow): 'blue' | 'red'
export function getIndustrySparklineDomain(rows: IndustryChartRow[]): number
export function getIndustrySparklineRowDomain(row: IndustryChartRow): number
export function buildIndustrySparklinePath(points: IndustrySparklinePoint[], options: IndustrySparklinePathOptions): string
export function buildIndustrySparklineAreaPath(points: IndustrySparklinePoint[], options: IndustrySparklinePathOptions): string
export function buildIndustryStackSegments(row: IndustryChartRow): IndustryChartSegment[]
export function getIndustryChartDomain(rows: IndustryChartRow[]): number
export function valueToPct(value: number, maxAbs: number): number
