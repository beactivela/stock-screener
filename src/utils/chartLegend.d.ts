export interface LegendBar {
  o: number
  h: number
  l: number
  c: number
  v: number
}

export interface LegendSnapshot {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  ma10: number | null
  ma20: number | null
  ma50: number | null
  volumeMa: number | null
}

export function buildLegendSnapshot(params: {
  time: number
  barsByTime: Map<number, LegendBar>
  ma10ByTime: Map<number, number>
  ma20ByTime: Map<number, number>
  ma50ByTime: Map<number, number>
  volumeMaByTime: Map<number, number>
}): LegendSnapshot | null
