/**
 * Beactive RSI Trend mini-chart. Renders RSI with trend coloring (green/red).
 * Smooth filled area chart matching TradingView-style appearance.
 */
export interface BeactiveRenderPoint {
  rsi: number
  trendColor: 'green' | 'red'
  bullishFill: boolean
  bearishFill: boolean
}

interface BeactiveRsiPanelProps {
  points: BeactiveRenderPoint[]
  /** Constrain width to align with chart plot area (exclude price scale). Default true. */
  alignWithChart?: boolean
}

function smoothCurvePath(
  indices: number[],
  points: BeactiveRenderPoint[],
  xFor: (i: number) => number,
  yFor: (v: number) => number
): string {
  if (indices.length <= 1) return ''
  const pts = indices.map((i) => ({ x: xFor(i), y: yFor(points[i].rsi) }))
  let path = ''
  for (let j = 1; j < pts.length; j++) {
    const p0 = pts[Math.max(0, j - 2)]
    const p1 = pts[j - 1]
    const p2 = pts[j]
    const p3 = pts[Math.min(pts.length - 1, j + 1)]
    const tension = 0.3
    const cp1x = p1.x + (p2.x - p0.x) * tension
    const cp1y = p1.y + (p2.y - p0.y) * tension
    const cp2x = p2.x - (p3.x - p1.x) * tension
    const cp2y = p2.y - (p3.y - p1.y) * tension
    path += (path ? ' ' : '') + `C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`
  }
  return path
}

function buildFillSegments(
  points: BeactiveRenderPoint[],
  xFor: (i: number) => number,
  yFor: (v: number) => number,
  y50: number
): { fill: string; path: string }[] {
  const segments: { fill: string; path: string }[] = []
  let start = 0
  for (let i = 1; i <= points.length; i++) {
    const atEnd = i === points.length
    const prevFill = points[start].bullishFill ? 'green' : points[start].bearishFill ? 'red' : 'neutral'
    const currFill = atEnd ? prevFill : points[i].bullishFill ? 'green' : points[i].bearishFill ? 'red' : 'neutral'
    const segmentEnds = atEnd || currFill !== prevFill
    if (segmentEnds) {
      const end = atEnd ? points.length - 1 : i - 1
      if (end >= start && prevFill !== 'neutral') {
        const fill = prevFill === 'green' ? 'rgba(34, 197, 94, 0.35)' : 'rgba(239, 68, 68, 0.35)'
        const indices = Array.from({ length: end - start + 1 }, (_, k) => start + k)
        const curvePath = smoothCurvePath(indices, points, xFor, yFor)
        const path = curvePath
          ? `M ${xFor(start)} ${y50} L ${xFor(start)} ${yFor(points[start].rsi)} ${curvePath} L ${xFor(end)} ${y50} Z`
          : `M ${xFor(start)} ${y50} L ${xFor(start)} ${yFor(points[start].rsi)} L ${xFor(end)} ${y50} Z`
        segments.push({ fill, path })
      }
      if (!atEnd) start = i
    }
  }
  return segments
}

export default function BeactiveRsiPanel({ points, alignWithChart = true }: BeactiveRsiPanelProps) {
  if (points.length === 0) {
    return (
      <div className="h-[64px] rounded border border-slate-800 bg-slate-950/60 px-2 py-1 flex items-center justify-center text-[11px] text-slate-500">
        Beactive RSI Trend loading…
      </div>
    )
  }

  const width = 200
  const height = 112
  const padY = 8
  const innerHeight = height - padY * 2
  const xFor = (index: number) => (points.length <= 1 ? 0 : (index / (points.length - 1)) * width)
  const yFor = (value: number) => padY + ((100 - value) / 100) * innerHeight
  const y70 = yFor(70)
  const y50 = yFor(50)
  const y30 = yFor(30)

  const fillSegments = buildFillSegments(points, xFor, yFor, y50)

  function smoothPath(indices: number[]): string {
    if (indices.length === 0) return ''
    if (indices.length === 1) return `M ${xFor(indices[0])} ${yFor(points[indices[0]].rsi)}`
    const pts = indices.map((i) => ({ x: xFor(i), y: yFor(points[i].rsi) }))
    let path = `M ${pts[0].x} ${pts[0].y}`
    for (let j = 1; j < pts.length; j++) {
      const p0 = pts[Math.max(0, j - 2)]
      const p1 = pts[j - 1]
      const p2 = pts[j]
      const p3 = pts[Math.min(pts.length - 1, j + 1)]
      const tension = 0.3
      const cp1x = p1.x + (p2.x - p0.x) * tension
      const cp1y = p1.y + (p2.y - p0.y) * tension
      const cp2x = p2.x - (p3.x - p1.x) * tension
      const cp2y = p2.y - (p3.y - p1.y) * tension
      path += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`
    }
    return path
  }

  const lineSegments: { path: string; color: string }[] = []
  if (points.length >= 2) {
    let segStart = 0
    for (let i = 1; i <= points.length; i++) {
      const atEnd = i === points.length
      const prevColor = points[segStart].trendColor === 'green' ? '#22c55e' : '#ef4444'
      const currColor = atEnd ? prevColor : points[i].trendColor === 'green' ? '#22c55e' : '#ef4444'
      if (currColor !== prevColor || atEnd) {
        const end = i - 1
        if (end >= segStart) {
          const indices = Array.from({ length: end - segStart + 1 }, (_, k) => segStart + k)
          lineSegments.push({ path: smoothPath(indices), color: prevColor })
        }
        if (!atEnd) segStart = i
      }
    }
  }

  return (
    <div
      className={`h-[64px] rounded border border-slate-800 bg-slate-950/60 px-2 py-1 ${alignWithChart ? 'w-[calc(100%-48px)]' : ''}`}
    >
      <div className="text-[10px] text-slate-400 mb-0.5">Beactive RSI Trend (14)</div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="w-full h-[44px]" shapeRendering="geometricPrecision">
        <line x1={0} y1={y70} x2={width} y2={y70} stroke="rgba(250,204,21,0.5)" strokeDasharray="4 4" strokeWidth="1" />
        <line x1={0} y1={y50} x2={width} y2={y50} stroke="rgba(148,163,184,0.6)" strokeWidth="1" />
        <line x1={0} y1={y30} x2={width} y2={y30} stroke="rgba(250,204,21,0.5)" strokeDasharray="4 4" strokeWidth="1" />
        {fillSegments.map((seg, i) => (
          <path key={`fill-${i}`} d={seg.path} fill={seg.fill} />
        ))}
        {lineSegments.map((seg, i) => (
          <path
            key={`line-${i}`}
            d={seg.path}
            fill="none"
            stroke={seg.color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
    </div>
  )
}
