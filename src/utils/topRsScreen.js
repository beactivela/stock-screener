const MAX_ROWS = 50

const MIN_RS = 90

// IBD's exact RS Rating is proprietary. This is an internal approximation
// that ranks by RS strength while also rewarding stronger industry groups.
function normalizeIndustryRank(industryRank) {
  if (industryRank == null || Number.isNaN(industryRank)) return 0
  const capped = Math.max(1, Math.min(197, Number(industryRank)))
  return (198 - capped) / 197
}

function normalizePct(value, min, max) {
  if (value == null || Number.isNaN(value)) return 0
  if (value <= min) return 0
  if (value >= max) return 1
  return (value - min) / (max - min)
}

function qualifies(result) {
  const rs = result?.relativeStrength
  const industryRank = result?.industryRank

  return (
    rs != null &&
    rs >= MIN_RS &&
    industryRank != null &&
    !Number.isNaN(Number(industryRank))
  )
}

function score(result) {
  const rsScore = normalizePct(result.relativeStrength, 90, 100)
  const industryScore = normalizeIndustryRank(result.industryRank)

  return (
    rsScore * 0.7 +
    industryScore * 0.3
  ) * 100
}

export function buildTopRs50(results = [], fundamentalsByTicker = {}) {
  // Preserve argument shape for compatibility with existing callers.
  void fundamentalsByTicker
  const qualified = results
    .filter((row) => qualifies(row))
    .map((row) => {
      // Keep this score for transparency in the UI and easier tuning later.
      const topRsScore = Number(score(row).toFixed(2))
      return { ...row, topRsScore, qualifiesForTopRs: true }
    })
    .sort((a, b) => {
      if (b.topRsScore !== a.topRsScore) return b.topRsScore - a.topRsScore
      const rsDiff = (b.relativeStrength ?? -Infinity) - (a.relativeStrength ?? -Infinity)
      if (rsDiff !== 0) return rsDiff
      const industryDiff = (a.industryRank ?? Infinity) - (b.industryRank ?? Infinity)
      if (industryDiff !== 0) return industryDiff
      return String(a.ticker).localeCompare(String(b.ticker))
    })

  return qualified.slice(0, MAX_ROWS)
}

