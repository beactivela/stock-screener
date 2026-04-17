const ALLOWED_STRATEGIES = new Set(['cash_secured_put'])
const ALLOWED_DELTAS = new Set([0.1, 0.15, 0.2])
const ALLOWED_DTES = new Set([30, 45, 60, 90, 180, 270, 365, 540])
const ALLOWED_PROFIT_TARGETS = new Set([30, 40, 50])
const DEFAULT_CLOSE_DTE = 21

function toDateOnly(value, label) {
  const normalized = String(value || '').slice(0, 10)
  const parsed = new Date(`${normalized}T12:00:00Z`)
  if (!normalized || Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${label}. Use YYYY-MM-DD.`)
  }
  return normalized
}

function uniqueSortedNumbers(values = []) {
  return [...new Set(values.map((value) => Number(value)).filter(Number.isFinite))].sort((a, b) => a - b)
}

export function normalizeOptionsBacktestRequest(body = {}) {
  const ticker = String(body?.ticker || '').trim().toUpperCase()
  if (!ticker) throw new Error('Ticker is required.')

  const strategy = String(body?.strategy || 'cash_secured_put').trim()
  if (!ALLOWED_STRATEGIES.has(strategy)) {
    throw new Error(`Unsupported strategy: ${strategy}`)
  }

  const deltaTargets = uniqueSortedNumbers(body?.deltaTargets)
  if (deltaTargets.length === 0) throw new Error('Select at least one delta target.')
  if (!deltaTargets.every((value) => ALLOWED_DELTAS.has(value))) {
    throw new Error(`Delta targets must be one of: ${[...ALLOWED_DELTAS].join(', ')}`)
  }

  const dteTargets = uniqueSortedNumbers(body?.dteTargets)
  if (dteTargets.length === 0) throw new Error('Select at least one DTE.')
  if (!dteTargets.every((value) => ALLOWED_DTES.has(value))) {
    throw new Error(`DTE targets must be one of: ${[...ALLOWED_DTES].join(', ')}`)
  }

  const profitTargetPct = Number(body?.profitTargetPct ?? 50)
  if (!ALLOWED_PROFIT_TARGETS.has(profitTargetPct)) {
    throw new Error(`Profit target must be one of: ${[...ALLOWED_PROFIT_TARGETS].join(', ')}`)
  }

  const closeDte = Number(body?.closeDte ?? DEFAULT_CLOSE_DTE)
  if (closeDte !== DEFAULT_CLOSE_DTE) {
    throw new Error(`closeDte must be ${DEFAULT_CLOSE_DTE} for v1.`)
  }

  const startDate = toDateOnly(body?.startDate, 'startDate')
  const endDate = toDateOnly(body?.endDate, 'endDate')
  if (startDate >= endDate) {
    throw new Error('startDate must be earlier than endDate.')
  }

  return {
    ticker,
    strategy,
    deltaTargets,
    dteTargets,
    profitTargetPct,
    closeDte,
    startDate,
    endDate,
  }
}

export function buildOptionsBacktestResponse({
  run,
  setups,
  recentRuns = [],
  assumptions = {},
  warnings = [],
}) {
  return {
    ok: true,
    run,
    setups,
    selectedSetupId: setups?.[0]?.id ?? null,
    recentRuns,
    assumptions,
    warnings,
  }
}

export function summarizeRunForList(run, setups = []) {
  const best = Array.isArray(setups) && setups.length > 0 ? setups[0] : null
  return {
    id: run.id,
    ticker: run.ticker,
    strategy: run.strategy,
    startDate: run.startDate,
    endDate: run.endDate,
    createdAt: run.createdAt,
    request: run.request,
    topSetup: best
      ? {
          id: best.id,
          deltaTarget: best.deltaTarget,
          entryDte: best.entryDte,
          sharpe: best.metrics?.sharpe ?? null,
          totalProfitUsd: best.metrics?.totalProfitUsd ?? null,
          totalReturnPct: best.metrics?.totalReturnPct ?? null,
        }
      : null,
  }
}

export const OPTIONS_BACKTEST_DEFAULTS = {
  closeDte: DEFAULT_CLOSE_DTE,
  deltaTargets: [0.1, 0.15, 0.2],
  dteTargets: [30, 45, 60, 90, 180, 270, 365, 540],
  profitTargetPct: 50,
}
