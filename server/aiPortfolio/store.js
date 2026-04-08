import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getSupabase, isSupabaseConfigured } from '../supabase.js'
import { getManagerModelMap } from './ollamaManagers.js'
import { createInitialAiPortfolioState } from './simulationEngine.js'
import { AI_PORTFOLIO_MANAGER_LABELS } from './types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(__dirname, '..', '..')
const DATA_DIR = path.join(REPO_ROOT, 'data')
const FALLBACK_STATE_FILE = path.join(DATA_DIR, 'ai-portfolio-state.json')

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function readFallbackState() {
  ensureDataDir()
  if (!fs.existsSync(FALLBACK_STATE_FILE)) return null
  try {
    const raw = fs.readFileSync(FALLBACK_STATE_FILE, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function writeFallbackState(state) {
  ensureDataDir()
  fs.writeFileSync(FALLBACK_STATE_FILE, JSON.stringify(state, null, 2))
}

export function createAiPortfolioStore() {
  const supabase = isSupabaseConfigured() ? getSupabase() : null

  async function loadState() {
    if (supabase) {
      const { data } = await supabase
        .from('ai_portfolio_runs')
        .select('state_json')
        .eq('status', 'completed')
        .order('finished_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (data?.state_json) return data.state_json
    }
    return readFallbackState() || createInitialAiPortfolioState({ asOfDate: null })
  }

  async function saveState({ state, asOfDate, status = 'completed', errorMessage = null }) {
    writeFallbackState(state)
    if (!supabase) return

    const runInsert = await supabase
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
      await supabase.from('ai_portfolio_managers').upsert(managerRows, { onConflict: 'id' })
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
        tradesRows.push({
          manager_id: managerId,
          run_id: runId,
          ticker: trade.ticker || null,
          strategy: trade.strategy || null,
          instrument_type: trade.instrumentType || 'stock',
          side: trade.side || (trade.status === 'filled' ? 'buy' : 'skip'),
          quantity: Number(trade.quantity) || null,
          fill_price_usd: Number(trade.markUsd) || null,
          notional_usd: Number(trade.notionalUsd) || null,
          realized_pnl_usd: Number(trade.realizedPnlUsd) || null,
          status: trade.status === 'filled' ? 'filled' : 'skipped',
          notes: null,
        })
      }
      for (const trade of rejectedTrades) {
        tradesRows.push({
          manager_id: managerId,
          run_id: runId,
          ticker: trade.ticker || null,
          strategy: trade.strategy || null,
          instrument_type: 'stock',
          side: 'reject',
          quantity: null,
          fill_price_usd: null,
          notional_usd: null,
          realized_pnl_usd: null,
          status: 'rejected',
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

    if (positionsRows.length) await supabase.from('ai_portfolio_positions').insert(positionsRows)
    if (tradesRows.length) await supabase.from('ai_portfolio_trades').insert(tradesRows)
    if (equityRows.length) {
      await supabase
        .from('ai_portfolio_equity_daily')
        .upsert(equityRows, { onConflict: 'date,manager_id' })
    }
  }

  return {
    loadState,
    saveState,
  }
}

