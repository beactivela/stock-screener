/**
 * Parse ATLAS portfolio_trajectory.csv and downsample for API sparkline payloads.
 */

export const SPARKLINE_MAX_POINTS = 200

/**
 * @param {string} raw - CSV text (UTF-8)
 * @returns {{ date: string, portfolio_value: number }[]}
 */
export function parsePortfolioTrajectoryCsv(raw) {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) return []

  const header = lines[0].split(',').map((h) => h.trim())
  const idxDate = header.indexOf('date')
  const idxPv = header.indexOf('portfolio_value')
  if (idxDate < 0 || idxPv < 0) return []

  const out = []
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i])
    if (cols.length <= Math.max(idxDate, idxPv)) continue
    const date = String(cols[idxDate] || '').trim()
    const pv = Number(cols[idxPv])
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(pv)) continue
    out.push({ date, portfolio_value: pv })
  }
  return out
}

/** Minimal CSV split for this file (no quoted commas in data). */
function splitCsvLine(line) {
  return line.split(',')
}

/**
 * Uniform stride downsample to at most maxPoints.
 * @param {{ date: string, portfolio_value: number }[]} rows
 * @param {number} maxPoints
 * @returns {{ time: string, value: number }[]}
 */
export function downsampleTrajectoryForSparkline(rows, maxPoints = SPARKLINE_MAX_POINTS) {
  if (!rows.length) return []
  if (rows.length <= maxPoints) {
    return rows.map((r) => ({ time: r.date, value: r.portfolio_value }))
  }
  const step = (rows.length - 1) / (maxPoints - 1)
  const points = []
  for (let k = 0; k < maxPoints; k++) {
    const idx = Math.min(rows.length - 1, Math.round(k * step))
    const r = rows[idx]
    points.push({ time: r.date, value: r.portfolio_value })
  }
  return points
}
