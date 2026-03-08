function toFiniteNumber(value) {
  return Number.isFinite(value) ? value : 0
}

function ratioReturnPct(totalPct, tailPct) {
  const total = toFiniteNumber(totalPct) / 100
  const tail = toFiniteNumber(tailPct) / 100
  const tailBase = 1 + tail
  if (tailBase <= 0.000001) return 0
  return ((1 + total) / tailBase - 1) * 100
}

function interpolateY(anchors, monthOffset) {
  if (anchors.length === 0) return 0
  for (let i = 0; i < anchors.length - 1; i += 1) {
    const a = anchors[i]
    const b = anchors[i + 1]
    if (monthOffset >= a.monthOffset && monthOffset <= b.monthOffset) {
      const range = b.monthOffset - a.monthOffset || 1
      const t = (monthOffset - a.monthOffset) / range
      return a.y + (b.y - a.y) * t
    }
  }
  return anchors[anchors.length - 1].y
}

export function buildIndustrySparklinePoints(row) {
  const perf1M = toFiniteNumber(row?.perf1M)
  const perf3M = toFiniteNumber(row?.perf3M)
  const perf6M = toFiniteNumber(row?.perf6M)
  const perfFirst3M = ratioReturnPct(perf6M, perf3M)
  const perfFirst5M = ratioReturnPct(perf6M, perf1M)
  return [
    { x: 0, y: 0 },
    { x: 0.5, y: perfFirst3M },
    { x: 5 / 6, y: perfFirst5M },
    { x: 1, y: perf6M },
  ]
}

export function buildIndustrySparklineMonthlyPoints(row) {
  const perf1M = toFiniteNumber(row?.perf1M)
  const perf3M = toFiniteNumber(row?.perf3M)
  const perf6M = toFiniteNumber(row?.perf6M)
  const perfFirst3M = ratioReturnPct(perf6M, perf3M)
  const perfFirst5M = ratioReturnPct(perf6M, perf1M)
  const anchors = [
    { monthOffset: -6, y: 0 },
    { monthOffset: -3, y: perfFirst3M },
    { monthOffset: -1, y: perfFirst5M },
    { monthOffset: 0, y: perf6M },
  ]
  return Array.from({ length: 7 }, (_, index) => {
    const monthOffset = index - 6
    return {
      monthOffset,
      x: index / 6,
      y: interpolateY(anchors, monthOffset),
    }
  })
}

export function sparklineXToMonthOffset(xRatio) {
  const clamped = Math.max(0, Math.min(1, toFiniteNumber(xRatio)))
  const monthIndex = Math.round(clamped * 6)
  return monthIndex - 6
}

export function isIndustrySparklineDowntrend(row) {
  return Number.isFinite(row?.perf1M) && row.perf1M < 0
}

export function getIndustryLastMonthSegmentColor(row) {
  const monthTrend = toFiniteNumber(row?.perf1M)
  return monthTrend < 0 ? 'red' : 'blue'
}

export function getIndustrySparklineDomain(rows) {
  const maxAbs = (rows || []).reduce((maxValue, row) => {
    const points = buildIndustrySparklinePoints(row)
    const rowMaxAbs = points.reduce((pointMax, point) => Math.max(pointMax, Math.abs(point.y)), 0)
    return Math.max(maxValue, rowMaxAbs)
  }, 0)
  return Math.max(1, maxAbs)
}

export function getIndustrySparklineRowDomain(row) {
  const points = buildIndustrySparklineMonthlyPoints(row)
  const maxAbs = points.reduce((pointMax, point) => Math.max(pointMax, Math.abs(point.y)), 0)
  return Math.max(1, maxAbs)
}

export function buildIndustrySparklinePath(points, options = {}) {
  const width = Math.max(1, toFiniteNumber(options.width) || 100)
  const height = Math.max(1, toFiniteNumber(options.height) || 28)
  const maxAbs = Math.max(1, toFiniteNumber(options.maxAbs))
  const paddingY = Math.max(0, toFiniteNumber(options.paddingY))
  const innerHeight = Math.max(1, height - paddingY * 2)
  const centerY = height / 2
  const halfInner = innerHeight / 2

  return (points || [])
    .map((point, index) => {
      const x = Math.max(0, Math.min(1, toFiniteNumber(point?.x))) * width
      const y = centerY - (Math.max(-maxAbs, Math.min(maxAbs, toFiniteNumber(point?.y))) / maxAbs) * halfInner
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
}

export function buildIndustrySparklineAreaPath(points, options = {}) {
  const width = Math.max(1, toFiniteNumber(options.width) || 100)
  const height = Math.max(1, toFiniteNumber(options.height) || 28)
  const maxAbs = Math.max(1, toFiniteNumber(options.maxAbs))
  const paddingY = Math.max(0, toFiniteNumber(options.paddingY))
  const innerHeight = Math.max(1, height - paddingY * 2)
  const centerY = height / 2
  const halfInner = innerHeight / 2

  const mapped = (points || []).map((point) => {
    const x = Math.max(0, Math.min(1, toFiniteNumber(point?.x))) * width
    const y = centerY - (Math.max(-maxAbs, Math.min(maxAbs, toFiniteNumber(point?.y))) / maxAbs) * halfInner
    return { x, y }
  })
  if (mapped.length === 0) return ''
  const line = mapped
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ')
  const lastX = mapped[mapped.length - 1].x.toFixed(2)
  const firstX = mapped[0].x.toFixed(2)
  return `${line} L ${lastX} ${centerY.toFixed(2)} L ${firstX} ${centerY.toFixed(2)} Z`
}

export function buildIndustryStackSegments(row) {
  const perf1M = toFiniteNumber(row?.perf1M)
  const perf3M = toFiniteNumber(row?.perf3M)
  const perf6M = toFiniteNumber(row?.perf6M)
  return [
    { id: 'perf1M', start: 0, end: perf1M },
    { id: 'perf1MTo3M', start: perf1M, end: perf3M },
    { id: 'perf3MTo6M', start: perf3M, end: perf6M },
  ]
}

export function getIndustryChartDomain(rows) {
  const maxAbs = (rows || []).reduce((maxValue, row) => {
    const segments = buildIndustryStackSegments(row)
    const rowMaxAbs = segments.reduce(
      (segmentMax, segment) => Math.max(segmentMax, Math.abs(segment.start), Math.abs(segment.end)),
      0,
    )
    return Math.max(maxValue, rowMaxAbs)
  }, 0)
  return Math.max(1, maxAbs)
}

export function valueToPct(value, maxAbs) {
  const domain = Math.max(1, toFiniteNumber(maxAbs))
  const clamped = Math.max(-domain, Math.min(domain, toFiniteNumber(value)))
  return ((clamped + domain) / (2 * domain)) * 100
}
