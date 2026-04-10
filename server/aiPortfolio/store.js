import { getSupabase, isSupabaseConfigured } from '../supabase.js'
import { getManagerModelMap } from './ollamaManagers.js'
import { createInitialAiPortfolioState } from './simulationEngine.js'
import { AI_PORTFOLIO_MANAGER_LABELS } from './types.js'

export function createAiPortfolioStore(opts = {}) {
  const supabase = opts.supabaseClient || (isSupabaseConfigured() ? getSupabase() : null)

  function assertSupabase() {
    if (!supabase) {
      throw new Error(
        'AI Portfolio requires Supabase (SUPABASE_URL + SUPABASE_SERVICE_KEY). Local fallback is disabled.',
      )
    }
    return supabase
  }

  async function loadLatestCompletedRun() {
    const db = assertSupabase()
    const { data, error } = await db
      .from('ai_portfolio_runs')
      .select('id, run_date, finished_at, state_json')
      .eq('status', 'completed')
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(`Failed to load AI Portfolio run state: ${error.message}`)
    return data || null
  }

  function normalizeTradeForLedger(trade, managerId, fallbackDate) {
    if (!trade || typeof trade !== 'object') return null
    const statusRaw = String(trade.status || '').toLowerCase()
    const sideRaw = String(trade.side || '').toLowerCase()
    const ticker = trade.ticker ? String(trade.ticker) : null
    const strategy = trade.strategy ? String(trade.strategy) : null
    const instrumentType = trade.instrumentType ? String(trade.instrumentType) : 'stock'
    const quantity = Number(trade.quantity)
    const markUsd = Number(trade.markUsd)
    const notionalUsd = Number(trade.notionalUsd)
    const realizedPnlUsd = Number(trade.realizedPnlUsd)
    const entryAt = trade.entryAt || trade.openedAt || trade.at || fallbackDate || null
    const exitAt = trade.exitAt || (statusRaw === 'closed' ? trade.at || fallbackDate || null : null)
    const positionId = trade.positionId || null

    const side = sideRaw || (statusRaw === 'closed' ? 'sell' : statusRaw === 'filled' ? 'buy' : 'skip')
    const status = side === 'reject' ? 'rejected' : side === 'skip' ? 'skipped' : 'filled'

    return {
      managerId,
      positionId,
      ticker,
      strategy,
      instrumentType,
      side,
      status,
      quantity: Number.isFinite(quantity) ? quantity : null,
      markUsd: Number.isFinite(markUsd) ? markUsd : null,
      notionalUsd: Number.isFinite(notionalUsd) ? notionalUsd : null,
      realizedPnlUsd: Number.isFinite(realizedPnlUsd) ? realizedPnlUsd : null,
      entryAt,
      exitAt,
    }
  }

  async function loadState() {
    const latest = await loadLatestCompletedRun()
    return latest?.state_json || createInitialAiPortfolioState({ asOfDate: null })
  }

  async function loadLedger() {
    const latest = await loadLatestCompletedRun()
    const state = latest?.state_json || null
    const managers = state?.managers && typeof state.managers === 'object' ? state.managers : {}
    const out = {}
    for (const [managerId, managerState] of Object.entries(managers)) {
      const recentTrades = Array.isArray(managerState?.recentTrades) ? managerState.recentTrades : []
      out[managerId] = recentTrades
        .map((trade) => normalizeTradeForLedger(trade, managerId, state?.lastRunDate || null))
        .filter(Boolean)
    }
    return {
      asOfDate: state?.lastRunDate || null,
      managers: out,
    }
  }

  async function saveState({ state, asOfDate, status = 'completed', errorMessage = null }) {
    const db = assertSupabase()

    const runInsert = await db
      .from('ai_portfolio_runs')
      .insert({
        run_date: asOfDate || null,
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        status,
        error_message: errorMessage,
        state_json: state,
      })
      .select('id')
      .single()
    if (runInsert.error) {
      throw new Error(`Failed to save AI Portfolio run state: ${runInsert.error.message}`)
    }

    const runId = runInsert.data?.id || null
    const managers = state?.managers || {}
    const modelMap = getManagerModelMap()
    const managerRows = Object.keys(managers).map((id) => ({
      id,
      display_name: AI_PORTFOLIO_MANAGER_LABELS[id] || id,
      model_name: modelMap[id] || id,
      updated_at: new Date().toISOString(),
    }))
    if (managerRows.length) {
      const managerInsert = await db.from('ai_portfolio_managers').upsert(managerRows, { onConflict: 'id' })
      if (managerInsert.error) {
        throw new Error(`Failed to upsert AI Portfolio managers: ${managerInsert.error.message}`)
      }
    }

    if (!runId || status !== 'completed') return

    const positionsRows = []
    const tradesRows = []
    const equityRows = []
    for (const [managerId, manager] of Object.entries(managers)) {
      const positions = Array.isArray(manager?.positions) ? manager.positions : []
      const recentTrades = Array.isArray(manager?.recentTrades) ? manager.recentTrades : []
      const rejectedTrades = Array.isArray(manager?.rejectedTrades) ? manager.rejectedTrades : []

      for (const p of positions) {
        positionsRows.push({
          manager_id: managerId,
          run_id: runId,
          underlying_symbol: p.underlying || p.ticker,
          ticker: p.ticker,
          instrument_type: p.instrumentType || 'stock',
          strategy: p.strategy || 'stock',
          contract_symbol: p.contractSymbol || null,
          quantity: Number(p.quantity) || 0,
          avg_cost_usd: Number(p.entryPriceUsd) || 0,
          mark_usd: Number(p.markUsd) || null,
          exposure_usd: Number(p.exposureUsd) || 0,
          max_loss_usd: Number(p.maxLossUsd) || 0,
          reserved_usd: Number(p.reservedUsd) || 0,
          source: 'ai_portfolio_engine',
          mark_as_of: state?.updatedAt || new Date().toISOString(),
          has_greeks: Boolean(p.hasGreeks),
          pricing_mode: p.pricingMode || 'live',
          data_freshness: p.dataFreshness || 'live',
          status: 'open',
          opened_at: p.openedAt || state?.updatedAt || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
      }

      for (const trade of recentTrades) {
        const mapped = normalizeTradeForLedger(trade, managerId, asOfDate || state?.lastRunDate || null)
        if (!mapped) continue
        tradesRows.push({
          manager_id: managerId,
          run_id: runId,
          position_id: mapped.positionId,
          ticker: mapped.ticker,
          strategy: mapped.strategy,
          instrument_type: mapped.instrumentType,
          side: mapped.side,
          quantity: mapped.quantity,
          fill_price_usd: mapped.markUsd,
          notional_usd: mapped.notionalUsd,
          realized_pnl_usd: mapped.realizedPnlUsd,
          status: mapped.status,
          entry_at: mapped.entryAt || null,
          exit_at: mapped.exitAt || null,
          notes: null,
        })
      }
      for (const trade of rejectedTrades) {
        tradesRows.push({
          manager_id: managerId,
          run_id: runId,
          ticker: trade.ticker || null,
          strategy: trade.strategy || null,
          position_id: null,
          instrument_type: 'stock',
          side: 'reject',
          quantity: null,
          fill_price_usd: null,
          notional_usd: null,
          realized_pnl_usd: null,
          status: 'rejected',
          entry_at: trade.at || null,
          exit_at: null,
          violations_json: trade.violations || [],
          notes: trade.metrics ? JSON.stringify(trade.metrics) : null,
        })
      }

      equityRows.push({
        date: asOfDate || state?.lastRunDate || new Date().toISOString().slice(0, 10),
        manager_id: managerId,
        equity_usd: Number(manager?.equityUsd) || 0,
        cash_usd: Number(manager?.cashUsd) || 0,
        deployed_usd: Number(manager?.deployedUsd) || 0,
        realized_pnl_usd: Number(manager?.realizedPnlUsd) || 0,
        unrealized_pnl_usd: Number(manager?.unrealizedPnlUsd) || 0,
        running_pnl_usd: Number(manager?.runningPnlUsd) || 0,
        spy_return_pct: Number(manager?.benchmark?.spyReturnPct) || null,
        outperformance_pct: Number(manager?.benchmark?.outperformancePct) || null,
      })
    }

    if (positionsRows.length) {
      const positionsInsert = await db.from('ai_portfolio_positions').insert(positionsRows)
      if (positionsInsert.error) {
        throw new Error(`Failed to insert AI Portfolio positions: ${positionsInsert.error.message}`)
      }
    }
    if (tradesRows.length) {
      const tradesInsert = await db.from('ai_portfolio_trades').insert(tradesRows)
      if (tradesInsert.error) {
        throw new Error(`Failed to insert AI Portfolio trades: ${tradesInsert.error.message}`)
      }
    }
    if (equityRows.length) {
      const equityInsert = await db
        .from('ai_portfolio_equity_daily')
        .upsert(equityRows, { onConflict: 'date,manager_id' })
      if (equityInsert.error) {
        throw new Error(`Failed to upsert AI Portfolio daily equity: ${equityInsert.error.message}`)
      }
    }
  }

  return {
    loadState,
    loadLedger,
    saveState,
  }
}

