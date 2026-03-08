const MAX_ROWS = 50

const MIN_RS = 90
const MIN_QTR_EARNINGS_YOY = 20
const MIN_INST_OWNERSHIP = 20
const MIN_PROFIT_MARGIN = 5
const MIN_OPERATING_MARGIN = 8

// IBD's exact RS Rating is proprietary. This is an internal approximation
// that keeps RS as the dominant signal while still requiring quality fundamentals.
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

function qualifies(result, fundamentalsByTicker) {
  const rs = result?.relativeStrength
  const fundamentals = fundamentalsByTicker[result?.ticker] ?? {}
  const earnings = fundamentals.qtrEarningsYoY
  const inst = fundamentals.pctHeldByInst
  const profit = fundamentals.profitMargin
  const operating = fundamentals.operatingMargin

  return (
    rs != null &&
    rs >= MIN_RS &&
    earnings != null &&
    earnings >= MIN_QTR_EARNINGS_YOY &&
    inst != null &&
    inst >= MIN_INST_OWNERSHIP &&
    profit != null &&
    profit >= MIN_PROFIT_MARGIN &&
    operating != null &&
    operating >= MIN_OPERATING_MARGIN
  )
}

function score(result, fundamentalsByTicker) {
  const fundamentals = fundamentalsByTicker[result.ticker] ?? {}
  const rsScore = normalizePct(result.relativeStrength, 90, 100)
  const earningsScore = normalizePct(fundamentals.qtrEarningsYoY, 20, 100)
  const instScore = normalizePct(fundamentals.pctHeldByInst, 20, 95)
  const profitScore = normalizePct(fundamentals.profitMargin, 5, 40)
  const operatingScore = normalizePct(fundamentals.operatingMargin, 8, 45)
  const industryScore = normalizeIndustryRank(result.industryRank)

  return (
    rsScore * 0.4 +
    earningsScore * 0.2 +
    industryScore * 0.15 +
    instScore * 0.1 +
    profitScore * 0.075 +
    operatingScore * 0.075
  ) * 100
}

export function buildTopRs50(results = [], fundamentalsByTicker = {}) {
  const qualified = results
    .filter((row) => qualifies(row, fundamentalsByTicker))
    .map((row) => {
      // Keep this score for transparency in the UI and easier tuning later.
      const topRsScore = Number(score(row, fundamentalsByTicker).toFixed(2))
      return { ...row, topRsScore, qualifiesForTopRs: true }
    })
    .sort((a, b) => {
      if (b.topRsScore !== a.topRsScore) return b.topRsScore - a.topRsScore
      const rsDiff = (b.relativeStrength ?? -Infinity) - (a.relativeStrength ?? -Infinity)
      if (rsDiff !== 0) return rsDiff
      return String(a.ticker).localeCompare(String(b.ticker))
    })

  return qualified.slice(0, MAX_ROWS)
}

