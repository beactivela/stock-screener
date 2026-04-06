import {
  AI_PORTFOLIO_ALLOWED_OPTION_STRATEGIES,
  AI_PORTFOLIO_BENCHMARK_TICKER,
  AI_PORTFOLIO_MANAGER_IDS,
  AI_PORTFOLIO_MANAGER_LABELS,
  AI_PORTFOLIO_MAX_CONCENTRATION_PCT,
  AI_PORTFOLIO_MAX_DEPLOYED_PCT,
  AI_PORTFOLIO_MAX_RISK_PER_TRADE_PCT,
  AI_PORTFOLIO_MIN_CASH_PCT,
  AI_PORTFOLIO_STARTING_CAPITAL_USD,
  AI_PORTFOLIO_TARGET_OUTPERFORMANCE_PCT,
} from './types.js'
import { suggestManagerBestEntry, getManagerModelMap } from './ollamaManagers.js'
import { getOptionMarkFromYahoo, getStockMarkFromYahoo } from './yahooOptionsData.js'
import {
  buildAiPortfolioSummary,
  createInitialAiPortfolioState,
  runAiPortfolioDailyCycle,
} from './simulationEngine.js'
import { createAiPortfolioStore } from './store.js'

function todayDate() {
  return new Date().toISOString().slice(0, 10)
}

export function createAiPortfolioService() {
  const store = createAiPortfolioStore()
  let schedulerState = {
    enabled: String(process.env.AI_PORTFOLIO_SCHEDULE_ENABLED || '').trim() === '1',
    running: false,
    lastRunAt: null,
    nextRunAt: null,
    intervalMs: Math.max(60000, Number(process.env.AI_PORTFOLIO_SCHEDULE_INTERVAL_MS) || 24 * 60 * 60 * 1000),
    timerId: null,
  }
  let activeRun = null

  async function getState() {
    return store.loadState()
  }

  async function getSummary() {
    const state = await getState()
    return buildAiPortfolioSummary(state)
  }

  async function runDailyCycle({ asOfDate } = {}) {
    if (activeRun) return activeRun
    activeRun = (async () => {
      schedulerState.running = true
      try {
        const state = (await getState()) || createInitialAiPortfolioState({ asOfDate: asOfDate || todayDate() })
        const out = await runAiPortfolioDailyCycle({
          state,
          asOfDate: asOfDate || todayDate(),
          suggestEntry: suggestManagerBestEntry,
          getStockMark: getStockMarkFromYahoo,
          getOptionMark: getOptionMarkFromYahoo,
        })
        await store.saveState({ state: out.state, asOfDate: asOfDate || todayDate(), status: 'completed' })
        schedulerState.lastRunAt = new Date().toISOString()
        return {
          runId: out.runId,
          summary: out.summary,
        }
      } catch (error) {
        const state = await getState()
        await store.saveState({
          state,
          asOfDate: asOfDate || todayDate(),
          status: 'failed',
          errorMessage: error?.message || String(error),
        })
        throw error
      } finally {
        schedulerState.running = false
        activeRun = null
      }
    })()
    return activeRun
  }

  function getConfig() {
    const modelMap = getManagerModelMap()
    return {
      managers: AI_PORTFOLIO_MANAGER_IDS.map((id) => ({
        id,
        label: AI_PORTFOLIO_MANAGER_LABELS[id],
        model: modelMap[id],
      })),
      benchmarkTicker: AI_PORTFOLIO_BENCHMARK_TICKER,
      startingCapitalUsd: AI_PORTFOLIO_STARTING_CAPITAL_USD,
      constraints: {
        maxConcentrationPct: AI_PORTFOLIO_MAX_CONCENTRATION_PCT,
        maxRiskPerTradePct: AI_PORTFOLIO_MAX_RISK_PER_TRADE_PCT,
        maxDeployedPct: AI_PORTFOLIO_MAX_DEPLOYED_PCT,
        minCashPct: AI_PORTFOLIO_MIN_CASH_PCT,
        targetOutperformancePct: AI_PORTFOLIO_TARGET_OUTPERFORMANCE_PCT,
      },
      options: {
        strategies: AI_PORTFOLIO_ALLOWED_OPTION_STRATEGIES,
        dataSource: 'Yahoo Finance (with simplified fallback when fields unavailable)',
      },
      executionMode: 'paper_live',
      brokerExecution: false,
    }
  }

  function scheduleNextTick() {
    schedulerState.nextRunAt = new Date(Date.now() + schedulerState.intervalMs).toISOString()
  }

  function startScheduler() {
    if (schedulerState.timerId) return
    schedulerState.enabled = true
    scheduleNextTick()
    schedulerState.timerId = setInterval(() => {
      scheduleNextTick()
      runDailyCycle({ asOfDate: todayDate() }).catch((error) => {
        console.error('[ai-portfolio] scheduled run failed:', error?.message || error)
      })
    }, schedulerState.intervalMs)
  }

  function stopScheduler() {
    if (schedulerState.timerId) {
      clearInterval(schedulerState.timerId)
      schedulerState.timerId = null
    }
    schedulerState.enabled = false
    schedulerState.nextRunAt = null
  }

  function getSchedulerState() {
    return {
      enabled: schedulerState.enabled,
      running: schedulerState.running,
      lastRunAt: schedulerState.lastRunAt,
      nextRunAt: schedulerState.nextRunAt,
      intervalMs: schedulerState.intervalMs,
    }
  }

  if (schedulerState.enabled) startScheduler()

  return {
    getConfig,
    getSummary,
    runDailyCycle,
    startScheduler,
    stopScheduler,
    getSchedulerState,
  }
}

