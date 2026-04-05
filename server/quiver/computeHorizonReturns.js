/**
 * Quiver strategy cumulative series: `close` is scaled so 100_000_000 = +0% total return from start.
 * Horizon return from date A to date B: (closeB / closeA - 1) * 100.
 */

/**
 * @param {{ date: string, close: number }[]} points sorted ascending by date
 * @param {Date} asOf
 * @param {number[]} horizonsYears e.g. [1,3,5,10]
 * @returns {Record<string, number | null>} keys perf_1y_pct etc.
 */
export function horizonReturnsFromGraph(points, asOf, horizonsYears = [1, 3, 5, 10]) {
  const out = {
    perf_1y_pct: null,
    perf_3y_pct: null,
    perf_5y_pct: null,
    perf_10y_pct: null,
    strategy_start_date: null,
  }
  if (!points.length) return out

  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date))
  out.strategy_start_date = sorted[0].date

  const endIdx = lastIndexOnOrBefore(sorted, asOf)
  if (endIdx < 0) return out
  const closeEnd = sorted[endIdx].close
  if (!Number.isFinite(closeEnd) || closeEnd <= 0) return out

  const keyMap = { 1: 'perf_1y_pct', 3: 'perf_3y_pct', 5: 'perf_5y_pct', 10: 'perf_10y_pct' }

  for (const y of horizonsYears) {
    const startDate = new Date(asOf)
    startDate.setFullYear(startDate.getFullYear() - y)
    const startIdx = lastIndexOnOrBefore(sorted, startDate)
    const key = keyMap[y]
    if (!key || startIdx < 0) continue
    const closeStart = sorted[startIdx].close
    if (!Number.isFinite(closeStart) || closeStart <= 0) continue
    /** If the series doesn't go back far enough, skip (null). */
    if (sorted[startIdx].date > sorted[endIdx].date) continue
    out[key] = ((closeEnd / closeStart - 1) * 100)
  }

  return out
}

/**
 * Points sorted by date ascending. Find last index with date <= d.
 */
function lastIndexOnOrBefore(sorted, d) {
  const ds = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)
  let lo = 0
  let hi = sorted.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid].date <= ds) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}
