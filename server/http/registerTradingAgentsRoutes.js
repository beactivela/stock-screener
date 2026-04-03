/**
 * POST /api/tradingagents/run — SSE stream from Python TradingAgents JSONL runner.
 */

import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { consumeJsonlChunk } from '../tradingagents/jsonl.js'
import {
  providerRequiredEnvVar,
  validateTradingAgentsRunRequest,
} from '../tradingagents/validation.js'
import { buildTradingAgentsRunnerArgv } from '../tradingagents/runnerArgv.js'
import {
  isTradingAgentsStdioWorkerBusy,
  isTradingAgentsStdioWorkerConfigured,
  resetTradingAgentsStdioWorker,
  runTradingAgentsStdioJob,
  tradingAgentsStdioWorkerScript,
} from '../tradingagents/stdioWorker.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(__dirname, '..', '..')

/** @type {Map<string, boolean>} */
const activeByClient = new Map()

// Full TradingAgents graphs often exceed 10m. Override with TRADINGAGENTS_RUN_TIMEOUT_MS (ms), e.g. 3600000 = 60m.
const _parsedRunTimeout = Number(process.env.TRADINGAGENTS_RUN_TIMEOUT_MS)
const RUN_TIMEOUT_MS =
  Number.isFinite(_parsedRunTimeout) && _parsedRunTimeout > 0
    ? Math.min(_parsedRunTimeout, 2 * 60 * 60 * 1000)
    : 45 * 60 * 1000

function venvPythonPath() {
  const isWin = process.platform === 'win32'
  return isWin
    ? path.join(REPO_ROOT, '.venv-tradingagents', 'Scripts', 'python.exe')
    : path.join(REPO_ROOT, '.venv-tradingagents', 'bin', 'python')
}

function runnerScriptPath() {
  return path.join(REPO_ROOT, 'scripts', 'tradingagents', 'run.py')
}

function tradingAgentsWorkerPath() {
  return tradingAgentsStdioWorkerScript(REPO_ROOT)
}

/**
 * @param {import('express').Request} req
 */
function clientRunKey(req) {
  const ua = req.get('user-agent') || ''
  const ip = req.ip || req.socket?.remoteAddress || 'unknown'
  return `${ip}:${ua.slice(0, 200)}`
}

/**
 * @param {import('express').Response} res
 * @param {unknown} obj
 */
function writeSse(res, obj) {
  if (res.writableEnded) return
  try {
    res.write(`data: ${JSON.stringify(obj)}\n\n`)
    res.flush?.()
  } catch {
    /* ignore */
  }
}

/**
 * @param {import('express').Application} app
 */
export function registerTradingAgentsRoutes(app) {
  app.post('/api/tradingagents/run', (req, res) => {
    const validated = validateTradingAgentsRunRequest(req.body)
    if (!validated.ok) {
      return res.status(400).json({ error: validated.error })
    }

    const { ticker, asOf, provider, analysts } = validated.value
    const runKey = clientRunKey(req)
    if (activeByClient.has(runKey)) {
      return res.status(409).json({
        error: 'A TradingAgents run is already in progress for this session. Wait or open a new browser profile.',
      })
    }

    const envVar = providerRequiredEnvVar(provider)
    if (envVar && !process.env[envVar]) {
      return res.status(400).json({
        error: `Missing ${envVar} for provider "${provider}". Set it in .env or the server environment.`,
      })
    }

    const py = venvPythonPath()
    const script = runnerScriptPath()
    if (!fs.existsSync(py)) {
      return res.status(503).json({
        error:
          'Python venv not found (.venv-tradingagents). Run: npm run install:tradingagents',
      })
    }
    const useStdioWorker = isTradingAgentsStdioWorkerConfigured()
    if (useStdioWorker) {
      if (!fs.existsSync(tradingAgentsWorkerPath())) {
        return res.status(503).json({ error: 'TradingAgents worker_stdio.py is missing.' })
      }
      if (isTradingAgentsStdioWorkerBusy()) {
        return res.status(503).json({
          error:
            'TradingAgents stdio worker is already running a job. Wait for it to finish or disable TRADINGAGENTS_STDIO_WORKER.',
        })
      }
    } else if (!fs.existsSync(script)) {
      return res.status(503).json({ error: 'TradingAgents runner script is missing.' })
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders?.()

    const runId = crypto.randomUUID()
    const startedAt = new Date().toISOString()
    let keepaliveId = null
    writeSse(res, {
      type: 'start',
      runId,
      ticker,
      asOf,
      provider,
      analysts,
      at: startedAt,
    })

    // Comment frames keep some proxies/buffers from holding the stream open without flushing.
    keepaliveId = setInterval(() => {
      if (res.writableEnded) return
      try {
        res.write(': keepalive\n\n')
        res.flush?.()
      } catch {
        /* ignore */
      }
    }, 15000)

    activeByClient.set(runKey, true)

    if (useStdioWorker) {
      let timedOutStdio = false
      /** @type {ReturnType<typeof setTimeout> | null} */
      let timeoutStdio = null

      const cleanupStdio = () => {
        if (timeoutStdio) clearTimeout(timeoutStdio)
        if (keepaliveId) {
          clearInterval(keepaliveId)
          keepaliveId = null
        }
        activeByClient.delete(runKey)
      }

      let finalizedStdio = false
      function finalizeStdio() {
        if (finalizedStdio) return false
        finalizedStdio = true
        cleanupStdio()
        res.off('close', onClientCloseStdio)
        return true
      }
      function onClientCloseStdio() {
        if (res.writableEnded) return
        resetTradingAgentsStdioWorker()
        if (finalizeStdio() && !res.writableEnded) res.end()
      }
      res.on('close', onClientCloseStdio)

      timeoutStdio = setTimeout(() => {
        timedOutStdio = true
        resetTradingAgentsStdioWorker()
        if (finalizeStdio() && !res.writableEnded) {
          writeSse(res, {
            type: 'error',
            message: `Run timed out after ${Math.round(RUN_TIMEOUT_MS / 60000)} minutes — increase TRADINGAGENTS_RUN_TIMEOUT_MS in .env if your graph needs longer`,
            at: new Date().toISOString(),
          })
          res.end()
        }
      }, RUN_TIMEOUT_MS)

      runTradingAgentsStdioJob(
        REPO_ROOT,
        py,
        { ticker, asOf, provider, analysts },
        (ev) => writeSse(res, ev),
      )
        .then((code) => {
          clearTimeout(timeoutStdio)
          const canRespond = finalizeStdio()
          if (!canRespond || res.writableEnded) return
          if (timedOutStdio) return
          if (code !== 0) {
            writeSse(res, {
              type: 'error',
              message: `Runner exited with code ${code}`,
              at: new Date().toISOString(),
            })
          }
          if (!res.writableEnded) res.end()
        })
        .catch((err) => {
          clearTimeout(timeoutStdio)
          const canRespond = finalizeStdio()
          if (!canRespond || res.writableEnded) return
          const msg =
            err?.message === 'TRADINGAGENTS_WORKER_BUSY'
              ? 'TradingAgents stdio worker is busy.'
              : `Stdio worker error: ${err?.message || String(err)}`
          writeSse(res, {
            type: 'error',
            message: msg,
            at: new Date().toISOString(),
          })
          if (!res.writableEnded) res.end()
        })
      return
    }

    const child = spawn(py, [script, ...buildTradingAgentsRunnerArgv(validated.value)], {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let jsonlBuf = ''
    /** @type {string[]} */
    const stderrLines = []
    const pushStderr = (s) => {
      const lines = s.split('\n').filter(Boolean)
      for (const line of lines) {
        stderrLines.push(line)
        if (stderrLines.length > 20) stderrLines.shift()
      }
    }

    let timedOut = false
    let timeoutId = setTimeout(() => {
      timedOut = true
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
    }, RUN_TIMEOUT_MS)

    const cleanup = () => {
      clearTimeout(timeoutId)
      if (keepaliveId) {
        clearInterval(keepaliveId)
        keepaliveId = null
      }
      activeByClient.delete(runKey)
    }

    let finalized = false
    const finalize = () => {
      if (finalized) return false
      finalized = true
      cleanup()
      res.off('close', onClientClose)
      return true
    }

    const onClientClose = () => {
      // Use response-close as the disconnect signal. Request close can fire
      // after request intake for normal POSTs and can kill long-running work early.
      if (res.writableEnded) return
      try {
        child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
      finalize()
      if (!res.writableEnded) res.end()
    }
    res.on('close', onClientClose)

    child.stdout?.on('data', (buf) => {
      const text = buf.toString('utf8')
      const { events, nextBuffer } = consumeJsonlChunk(text, jsonlBuf)
      jsonlBuf = nextBuffer
      for (const ev of events) {
        writeSse(res, ev)
      }
    })

    child.stderr?.on('data', (buf) => {
      pushStderr(buf.toString('utf8'))
    })

    child.on('error', (err) => {
      const canRespond = finalize()
      if (!canRespond || res.writableEnded) return
      writeSse(res, {
        type: 'error',
        message: `Failed to start runner: ${err.message}`,
        at: new Date().toISOString(),
      })
      if (!res.writableEnded) res.end()
    })

    child.on('close', (code) => {
      const canRespond = finalize()
      if (!canRespond || res.writableEnded) return

      if (jsonlBuf.trim()) {
        const { events } = consumeJsonlChunk('\n', jsonlBuf)
        for (const ev of events) {
          writeSse(res, ev)
        }
      }

      if (code !== 0 && !res.writableEnded) {
        const tail = stderrLines.slice(-5).join(' | ')
        const redacted = tail.replace(/sk-[a-zA-Z0-9]{10,}/g, '[redacted]')
        const msg = timedOut
          ? `Run timed out after ${Math.round(RUN_TIMEOUT_MS / 60000)} minutes — increase TRADINGAGENTS_RUN_TIMEOUT_MS in .env if your graph needs longer`
          : `Runner exited with code ${code}${redacted ? `: ${redacted}` : ''}`
        writeSse(res, {
          type: 'error',
          message: msg,
          at: new Date().toISOString(),
        })
      }

      if (!res.writableEnded) res.end()
    })
  })
}
