import crypto from 'node:crypto'
import { getSupabase, isSupabaseConfigured } from '../supabase.js'
import { summarizeRunForList } from './contracts.js'

function normalizeRunRow(row) {
  if (!row) return null
  return {
    id: row.id,
    ticker: row.ticker,
    strategy: row.strategy,
    startDate: row.start_date,
    endDate: row.end_date,
    request: row.request_json || {},
    assumptions: row.assumptions_json || {},
    warnings: row.warnings_json || [],
    createdAt: row.created_at,
  }
}

function normalizeSetupRow(row) {
  if (!row) return null
  return {
    id: row.id,
    runId: row.run_id,
    strategy: row.strategy,
    deltaTarget: Number(row.delta_target),
    entryDte: Number(row.entry_dte),
    profitTargetPct: Number(row.profit_target_pct),
    closeDte: Number(row.close_dte),
    metrics: row.metrics_json || {},
    equityCurve: row.equity_curve_json || [],
    rankOrder: Number(row.rank_order || 0),
  }
}

function normalizeTradeRow(row) {
  if (!row) return null
  return {
    id: row.id,
    setupId: row.setup_id,
    ticker: row.ticker,
    entryDate: row.entry_date,
    exitDate: row.exit_date,
    strike: Number(row.strike),
    entryDte: Number(row.entry_dte),
    exitDte: Number(row.exit_dte),
    targetDelta: Number(row.target_delta),
    premiumOpen: Number(row.premium_open),
    premiumClose: Number(row.premium_close),
    collateralUsd: Number(row.collateral_usd),
    exitReason: row.exit_reason,
    assigned: Boolean(row.assigned),
    pnlUsd: Number(row.pnl_usd),
    returnPct: Number(row.return_pct),
    annualizedRoyPct: Number(row.annualized_roy_pct),
    daysHeld: Number(row.days_held),
  }
}

export function createOptionsBacktestStore(opts = {}) {
  const supabase = opts.supabaseClient || (isSupabaseConfigured() ? getSupabase() : null)

  function assertSupabase() {
    if (!supabase) {
      throw new Error(
        'Options backtesting requires Supabase (SUPABASE_URL + SUPABASE_SERVICE_KEY).',
      )
    }
    return supabase
  }

  async function saveRun({ request, assumptions, warnings, setups }) {
    const db = assertSupabase()
    const now = new Date().toISOString()
    const runId = crypto.randomUUID()
    const runRow = {
      id: runId,
      ticker: request.ticker,
      strategy: request.strategy,
      start_date: request.startDate,
      end_date: request.endDate,
      request_json: request,
      assumptions_json: assumptions,
      warnings_json: warnings,
      created_at: now,
    }
    const runInsert = await db.from('options_backtest_runs').insert(runRow)
    if (runInsert.error) throw new Error(`Failed to save options backtest run: ${runInsert.error.message}`)

    const setupRows = setups.map((setup) => ({
      id: crypto.randomUUID(),
      run_id: runId,
      strategy: setup.strategy,
      delta_target: setup.deltaTarget,
      entry_dte: setup.entryDte,
      profit_target_pct: setup.profitTargetPct,
      close_dte: setup.closeDte,
      metrics_json: setup.metrics,
      equity_curve_json: setup.equityCurve,
      rank_order: setup.rankOrder ?? 0,
    }))
    if (setupRows.length > 0) {
      const setupInsert = await db.from('options_backtest_setups').insert(setupRows)
      if (setupInsert.error) throw new Error(`Failed to save options backtest setups: ${setupInsert.error.message}`)
    }

    const tradesRows = []
    for (let i = 0; i < setups.length; i += 1) {
      const setup = setups[i]
      const setupRow = setupRows[i]
      for (const trade of setup.trades || []) {
        tradesRows.push({
          id: crypto.randomUUID(),
          setup_id: setupRow.id,
          ticker: trade.ticker,
          entry_date: trade.entryDate,
          exit_date: trade.exitDate,
          strike: trade.strike,
          entry_dte: trade.entryDte,
          exit_dte: trade.exitDte,
          target_delta: trade.targetDelta,
          premium_open: trade.premiumOpen,
          premium_close: trade.premiumClose,
          collateral_usd: trade.collateralUsd,
          exit_reason: trade.exitReason,
          assigned: trade.assigned,
          pnl_usd: trade.pnlUsd,
          return_pct: trade.returnPct,
          annualized_roy_pct: trade.annualizedRoyPct,
          days_held: trade.daysHeld,
        })
      }
    }
    if (tradesRows.length > 0) {
      const tradesInsert = await db.from('options_backtest_trades').insert(tradesRows)
      if (tradesInsert.error) throw new Error(`Failed to save options backtest trades: ${tradesInsert.error.message}`)
    }

    return getRun(runId)
  }

  async function listRuns({ limit = 12, ticker = null } = {}) {
    const db = assertSupabase()
    let query = db
      .from('options_backtest_runs')
      .select('id, ticker, strategy, start_date, end_date, request_json, assumptions_json, warnings_json, created_at')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (ticker) query = query.eq('ticker', String(ticker).trim().toUpperCase())
    const { data, error } = await query
    if (error) throw new Error(`Failed to list options backtest runs: ${error.message}`)
    const runs = []
    for (const row of data || []) {
      const detail = await getRun(row.id)
      runs.push(summarizeRunForList(detail.run, detail.setups))
    }
    return runs
  }

  async function getRun(runId) {
    const db = assertSupabase()
    const runQuery = await db
      .from('options_backtest_runs')
      .select('id, ticker, strategy, start_date, end_date, request_json, assumptions_json, warnings_json, created_at')
      .eq('id', runId)
      .maybeSingle()
    if (runQuery.error) throw new Error(`Failed to load options backtest run: ${runQuery.error.message}`)
    if (!runQuery.data) throw new Error('Options backtest run not found.')

    const setupsQuery = await db
      .from('options_backtest_setups')
      .select('id, run_id, strategy, delta_target, entry_dte, profit_target_pct, close_dte, metrics_json, equity_curve_json, rank_order')
      .eq('run_id', runId)
      .order('rank_order', { ascending: true })
    if (setupsQuery.error) throw new Error(`Failed to load options backtest setups: ${setupsQuery.error.message}`)

    const setupIds = (setupsQuery.data || []).map((row) => row.id)
    let tradeRows = []
    if (setupIds.length > 0) {
      const tradesQuery = await db
        .from('options_backtest_trades')
        .select('id, setup_id, ticker, entry_date, exit_date, strike, entry_dte, exit_dte, target_delta, premium_open, premium_close, collateral_usd, exit_reason, assigned, pnl_usd, return_pct, annualized_roy_pct, days_held')
        .in('setup_id', setupIds)
        .order('entry_date', { ascending: true })
      if (tradesQuery.error) throw new Error(`Failed to load options backtest trades: ${tradesQuery.error.message}`)
      tradeRows = tradesQuery.data || []
    }

    const tradesBySetupId = new Map()
    for (const tradeRow of tradeRows) {
      if (!tradesBySetupId.has(tradeRow.setup_id)) tradesBySetupId.set(tradeRow.setup_id, [])
      tradesBySetupId.get(tradeRow.setup_id).push(normalizeTradeRow(tradeRow))
    }

    const run = normalizeRunRow(runQuery.data)
    const setups = (setupsQuery.data || []).map((row) => ({
      ...normalizeSetupRow(row),
      trades: tradesBySetupId.get(row.id) || [],
    }))
    return {
      run,
      setups,
      assumptions: run.assumptions,
      warnings: run.warnings,
    }
  }

  return {
    saveRun,
    listRuns,
    getRun,
  }
}
