import { AI_PORTFOLIO_DEFAULT_MODEL_SLUGS } from './defaultModels.js'
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
import {
  getManagerModelMap,
  resolveAiPortfolioLlmProvider,
  suggestManagerBestEntry,
} from './ollamaManagers.js'
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

  async function getLedger() {
    return store.loadLedger()
  }

  async function executeDailyCycle({
    asOfDate,
    onManagerLlmStart,
    onManagerLlmComplete,
    onManagerIterationEnd,
  } = {}) {
    const date = asOfDate || todayDate()
    const state = (await getState()) || createInitialAiPortfolioState({ asOfDate: date })
    const out = await runAiPortfolioDailyCycle({
      state,
      asOfDate: date,
      suggestEntry: suggestManagerBestEntry,
      getStockMark: getStockMarkFromYahoo,
      getOptionMark: getOptionMarkFromYahoo,
      onManagerLlmStart,
      onManagerLlmComplete,
      onManagerIterationEnd,
    })
    await store.saveState({ state: out.state, asOfDate: date, status: 'completed' })
    schedulerState.lastRunAt = new Date().toISOString()
    return out
  }

  async function runDailyCycle({ asOfDate } = {}) {
    if (activeRun) return activeRun
    activeRun = (async () => {
      schedulerState.running = true
      try {
        const out = await executeDailyCycle({ asOfDate })
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

  /**
   * Same daily run as JSON endpoint, but streams SSE so the UI can show per-manager OpenRouter progress.
   * @param {import('express').Response} res
   */
  async function runDailyCycleSse(res, { asOfDate } = {}) {
    if (activeRun) {
      res.status(409).json({ ok: false, error: 'A daily AI portfolio run is already in progress.' })
      return
    }
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    if (typeof res.flushHeaders === 'function') res.flushHeaders()

    const send = (event, data) => {
      res.write(`event: ${event}\n`)
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    const date = asOfDate || todayDate()
    send('start', { asOfDate: date })

    activeRun = (async () => {
      schedulerState.running = true
      try {
        const out = await executeDailyCycle({
          asOfDate,
          onManagerLlmStart: ({ managerId }) => {
            send('manager_thinking', { managerId })
          },
          onManagerLlmComplete: (payload) => {
            send('manager_response', payload)
          },
          onManagerIterationEnd: (payload) => {
            send('manager_executed', payload)
          },
        })
        send('complete', { ok: true, runId: out.runId, summary: out.summary })
        res.end()
        return out
      } catch (error) {
        try {
          const state = await getState()
          await store.saveState({
            state,
            asOfDate: date,
            status: 'failed',
            errorMessage: error?.message || String(error),
          })
        } catch {
          /* ignore */
        }
        send('error', { ok: false, message: error?.message || String(error) })
        res.end()
        // Do not rethrow: response is already finished; a rejection here makes Express treat the
        // route as failed and can surface as HTTP 500 / empty body even though the client got SSE.
        console.error('[ai-portfolio] daily cycle failed:', error?.message || error)
      } finally {
        schedulerState.running = false
        activeRun = null
      }
    })()

    await activeRun
  }

  function getConfig() {
    const modelMap = getManagerModelMap()
    return {
      llm: {
        provider: resolveAiPortfolioLlmProvider(),
        openRouterKeySet: Boolean(String(process.env.OPENROUTER_API_KEY || '').trim()),
      },
      modelDefaults: { ...AI_PORTFOLIO_DEFAULT_MODEL_SLUGS },
      managers: AI_PORTFOLIO_MANAGER_IDS.map((id) => ({
        id,
        label: AI_PORTFOLIO_MANAGER_LABELS[id],
        model: modelMap[id],
        defaultModel: AI_PORTFOLIO_DEFAULT_MODEL_SLUGS[id],
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
    getLedger,
    runDailyCycle,
    runDailyCycleSse,
    startScheduler,
    stopScheduler,
    getSchedulerState,
  }
}

