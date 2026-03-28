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

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(__dirname, '..', '..')

/** @type {Map<string, boolean>} */
const activeByClient = new Map()

const RUN_TIMEOUT_MS = 10 * 60 * 1000

function venvPythonPath() {
  const isWin = process.platform === 'win32'
  return isWin
    ? path.join(REPO_ROOT, '.venv-tradingagents', 'Scripts', 'python.exe')
    : path.join(REPO_ROOT, '.venv-tradingagents', 'bin', 'python')
}

function runnerScriptPath() {
  return path.join(REPO_ROOT, 'scripts', 'tradingagents', 'run.py')
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

    const { ticker, asOf, provider } = validated.value
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
    if (!fs.existsSync(script)) {
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
    writeSse(res, {
      type: 'start',
      runId,
      ticker,
      asOf,
      provider,
      at: startedAt,
    })

    activeByClient.set(runKey, true)

    const child = spawn(
      py,
      [script, '--ticker', ticker, '--as-of', asOf, '--provider', provider],
      {
        cwd: REPO_ROOT,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

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
      activeByClient.delete(runKey)
    }

    const onClientClose = () => {
      try {
        child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
      cleanup()
      if (!res.writableEnded) res.end()
    }
    req.on('close', onClientClose)

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
      cleanup()
      req.off('close', onClientClose)
      writeSse(res, {
        type: 'error',
        message: `Failed to start runner: ${err.message}`,
        at: new Date().toISOString(),
      })
      if (!res.writableEnded) res.end()
    })

    child.on('close', (code) => {
      cleanup()
      req.off('close', onClientClose)

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
          ? 'Run timed out after 10 minutes'
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
