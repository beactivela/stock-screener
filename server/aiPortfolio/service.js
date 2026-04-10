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

const AI_PORTFOLIO_DEFAULT_CHECKPOINT_TIMES = ['09:00', '11:00', '13:00', '14:30']
const AI_PORTFOLIO_DEFAULT_TIMEZONE = 'America/Chicago'

const zonedFormatterCache = new Map()

function getZonedFormatter(timeZone) {
  const key = String(timeZone || AI_PORTFOLIO_DEFAULT_TIMEZONE)
  if (!zonedFormatterCache.has(key)) {
    zonedFormatterCache.set(
      key,
      new Intl.DateTimeFormat('en-US', {
        timeZone: key,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }),
    )
  }
  return zonedFormatterCache.get(key)
}

/**
 * Parse a comma separated HH:MM list to normalized checkpoint slots.
 * @param {string | undefined | null} value
 * @returns {Array<{ hour: number, minute: number, label: string }>}
 */
export function parseMarketCheckpointSlots(value) {
  const raw = String(value || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
  const seed = raw.length ? raw : AI_PORTFOLIO_DEFAULT_CHECKPOINT_TIMES
  const unique = new Set()
  const slots = []
  for (const token of seed) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(token)
    if (!m) continue
    const hour = Number(m[1])
    const minute = Number(m[2])
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) continue
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) continue
    const label = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
    if (unique.has(label)) continue
    unique.add(label)
    slots.push({ hour, minute, label })
  }
  slots.sort((a, b) => a.hour - b.hour || a.minute - b.minute)
  return slots.length
    ? slots
    : AI_PORTFOLIO_DEFAULT_CHECKPOINT_TIMES.map((label) => {
        const [h, m] = label.split(':').map(Number)
        return { hour: h, minute: m, label }
      })
}

/**
 * @param {Date} date
 * @param {string} timeZone
 */
export function getZonedDateParts(date, timeZone = AI_PORTFOLIO_DEFAULT_TIMEZONE) {
  const parts = getZonedFormatter(timeZone).formatToParts(date)
  const map = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]))
  const year = Number(map.year)
  const month = Number(map.month)
  const day = Number(map.day)
  const hour = Number(map.hour)
  const minute = Number(map.minute)
  const second = Number(map.second)
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    dateKey: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  }
}

export function getActiveCheckpointLabel(now, slots, timeZone = AI_PORTFOLIO_DEFAULT_TIMEZONE) {
  const p = getZonedDateParts(now, timeZone)
  const found = (slots || []).find((slot) => slot.hour === p.hour && slot.minute === p.minute)
  return found?.label || null
}

export function computeNextCheckpointIso(now, slots, timeZone = AI_PORTFOLIO_DEFAULT_TIMEZONE) {
  if (!Array.isArray(slots) || !slots.length) return null
  const probe = new Date(now.getTime())
  probe.setUTCSeconds(0, 0)
  probe.setUTCMinutes(probe.getUTCMinutes() + 1)
  for (let i = 0; i < 60 * 24 * 8; i += 1) {
    const p = getZonedDateParts(probe, timeZone)
    const match = slots.some((slot) => slot.hour === p.hour && slot.minute === p.minute)
    if (match) return probe.toISOString()
    probe.setUTCMinutes(probe.getUTCMinutes() + 1)
  }
  return null
}

export function createAiPortfolioService(opts = {}) {
  const store = opts.store || createAiPortfolioStore()
  const nowFn = opts.now || (() => new Date())
  const setIntervalFn = opts.setInterval || setInterval
  const clearIntervalFn = opts.clearInterval || clearInterval
  const checkpointTimeZone = String(
    opts.checkpointTimeZone || process.env.AI_PORTFOLIO_SCHEDULE_TIMEZONE || AI_PORTFOLIO_DEFAULT_TIMEZONE,
  )
  const checkpointSlots = parseMarketCheckpointSlots(
    opts.checkpointTimes || process.env.AI_PORTFOLIO_SCHEDULE_TIMES,
  )
  const scheduleTickMs = Math.max(30000, Number(process.env.AI_PORTFOLIO_SCHEDULE_TICK_MS) || 60000)

  let schedulerState = {
    enabled: String(process.env.AI_PORTFOLIO_SCHEDULE_ENABLED || '').trim() === '1',
    running: false,
    lastRunAt: null,
    lastRunCheckpoint: null,
    nextRunAt: null,
    timeZone: checkpointTimeZone,
    checkpointTimes: checkpointSlots.map((slot) => slot.label),
    intervalMs: scheduleTickMs,
    executedCheckpointKeys: [],
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
    schedulerState.nextRunAt = computeNextCheckpointIso(nowFn(), checkpointSlots, checkpointTimeZone)
  }

  function markCheckpointExecuted(checkpointKey) {
    schedulerState.executedCheckpointKeys = [...schedulerState.executedCheckpointKeys, checkpointKey].slice(-64)
  }

  async function runScheduledCheckpointIfDue(now = nowFn()) {
    const label = getActiveCheckpointLabel(now, checkpointSlots, checkpointTimeZone)
    if (!label) {
      scheduleNextTick()
      return
    }
    const zoned = getZonedDateParts(now, checkpointTimeZone)
    const checkpointKey = `${zoned.dateKey}@${label}`
    if (schedulerState.executedCheckpointKeys.includes(checkpointKey)) {
      scheduleNextTick()
      return
    }
    markCheckpointExecuted(checkpointKey)
    schedulerState.lastRunCheckpoint = checkpointKey
    try {
      await runDailyCycle({ asOfDate: zoned.dateKey })
    } catch (error) {
      console.error('[ai-portfolio] scheduled checkpoint failed:', error?.message || error)
    } finally {
      scheduleNextTick()
    }
  }

  function startScheduler() {
    if (schedulerState.timerId) return
    schedulerState.enabled = true
    scheduleNextTick()
    schedulerState.timerId = setIntervalFn(() => {
      runScheduledCheckpointIfDue(nowFn()).catch((error) => {
        console.error('[ai-portfolio] scheduler tick failed:', error?.message || error)
      })
    }, schedulerState.intervalMs)
    runScheduledCheckpointIfDue(nowFn()).catch((error) => {
      console.error('[ai-portfolio] scheduler bootstrap tick failed:', error?.message || error)
    })
  }

  function stopScheduler() {
    if (schedulerState.timerId) {
      clearIntervalFn(schedulerState.timerId)
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
      lastRunCheckpoint: schedulerState.lastRunCheckpoint,
      nextRunAt: schedulerState.nextRunAt,
      timeZone: schedulerState.timeZone,
      checkpointTimes: schedulerState.checkpointTimes,
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

