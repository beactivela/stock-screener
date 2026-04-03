import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, describe, it } from 'node:test'

import express from 'express'

import { registerTradingAgentsRoutes } from './registerTradingAgentsRoutes.js'
import { buildTradingAgentsRunnerArgv } from '../tradingagents/runnerArgv.js'
import { validateTradingAgentsRunRequest } from '../tradingagents/validation.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(__dirname, '..', '..')
const VENV_PY = path.join(REPO_ROOT, '.venv-tradingagents', 'bin', 'python')
const RUNNER_SCRIPT = path.join(REPO_ROOT, 'scripts', 'tradingagents', 'run.py')

async function readSseEvents(response, maxMs = 5000) {
  const events = []
  if (!response.body) return events
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const expiresAt = Date.now() + maxMs

  while (Date.now() < expiresAt) {
    const remaining = Math.max(1, expiresAt - Date.now())
    const nextChunk = await Promise.race([
      reader.read(),
      new Promise((resolve) => setTimeout(() => resolve({ done: true, value: undefined }), remaining)),
    ])
    if (nextChunk.done) break
    buffer += decoder.decode(nextChunk.value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      try {
        events.push(JSON.parse(line.slice(5).trim()))
      } catch {
        // Ignore malformed data chunks in tests.
      }
    }
    if (events.some((ev) => ev.type && ev.type !== 'start')) {
      break
    }
  }

  try {
    await reader.cancel()
  } catch {
    // Ignore cancel errors when stream has already closed.
  }
  return events
}

describe('registerTradingAgentsRoutes', () => {
  let server
  let baseUrl

  before(async () => {
    const app = express()
    app.use(express.json())
    registerTradingAgentsRoutes(app)
    server = http.createServer(app)
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address()
    baseUrl = `http://127.0.0.1:${port}`
  })

  after(async () => {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      })
    }
  })

  it('runner argv includes analysts from validated body', () => {
    const v = validateTradingAgentsRunRequest({
      ticker: 'MSFT',
      asOf: '2026-01-20',
      provider: 'ollama',
      profile: 'fast',
    })
    assert.equal(v.ok, true)
    if (v.ok) {
      assert.deepEqual(buildTradingAgentsRunnerArgv(v.value), [
        '--ticker',
        'MSFT',
        '--as-of',
        '2026-01-20',
        '--provider',
        'ollama',
        '--analysts',
        'market,fundamentals',
      ])
    }
  })

  it('returns 400 for invalid body', async () => {
    const response = await fetch(`${baseUrl}/api/tradingagents/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker: '!!!', asOf: '2026-01-15', provider: 'openai' }),
    })
    assert.equal(response.status, 400)
    const body = await response.json()
    assert.ok(body.error)
  })

  it('returns 503 when venv python is missing', async (t) => {
    if (fs.existsSync(VENV_PY)) {
      t.skip()
      return
    }
    const response = await fetch(`${baseUrl}/api/tradingagents/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker: 'NVDA', asOf: '2026-01-15', provider: 'openai' }),
    })
    assert.equal(response.status, 503)
  })

  it('keeps streaming when request close is emitted after body parse', async (t) => {
    if (!fs.existsSync(VENV_PY) || !fs.existsSync(RUNNER_SCRIPT)) {
      t.skip()
      return
    }

    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
      // Reproduces environments where request `close` can fire right after request intake.
      setTimeout(() => req.emit('close'), 25)
      next()
    })
    registerTradingAgentsRoutes(app)
    const localServer = http.createServer(app)
    await new Promise((resolve) => localServer.listen(0, '127.0.0.1', resolve))
    const { port } = localServer.address()
    const localUrl = `http://127.0.0.1:${port}`

    try {
      const response = await fetch(`${localUrl}/api/tradingagents/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ ticker: 'NVDA', asOf: '2026-01-15', provider: 'ollama' }),
      })
      assert.equal(response.status, 200)
      const events = await readSseEvents(response, 4000)
      assert.ok(events.some((ev) => ev.type === 'start'))
      assert.ok(
        events.some((ev) => ev.type !== 'start'),
        `expected at least one event after start, got: ${JSON.stringify(events)}`,
      )
    } finally {
      await new Promise((resolve, reject) => {
        localServer.close((err) => (err ? reject(err) : resolve()))
      })
    }
  })
})
