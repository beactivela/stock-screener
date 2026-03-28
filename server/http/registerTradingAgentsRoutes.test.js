import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, describe, it } from 'node:test'

import express from 'express'

import { registerTradingAgentsRoutes } from './registerTradingAgentsRoutes.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(__dirname, '..', '..')
const VENV_PY = path.join(REPO_ROOT, '.venv-tradingagents', 'bin', 'python')

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
})
