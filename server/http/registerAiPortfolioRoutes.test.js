import assert from 'node:assert/strict'
import http from 'node:http'
import { after, before, describe, it } from 'node:test'

import express from 'express'

import { registerAiPortfolioRoutes } from './registerAiPortfolioRoutes.js'

describe('registerAiPortfolioRoutes', () => {
  let server
  let baseUrl

  before(async () => {
    const app = express()
    app.use(express.json())
    registerAiPortfolioRoutes(app, {
      service: {
        async getConfig() {
          return { managers: [{ id: 'claude', model: 'claude-3.7' }] }
        },
        async getSummary() {
          return { ok: true, managers: { claude: { equityUsd: 50000 } } }
        },
        async getLedger() {
          return {
            asOfDate: '2026-04-07',
            managers: {
              claude: [
                {
                  ticker: 'AAPL',
                  status: 'filled',
                  entryAt: '2026-04-07',
                  exitAt: null,
                  notionalUsd: 5000,
                  realizedPnlUsd: 0,
                },
              ],
            },
          }
        },
        async runDailyCycle() {
          return { ok: true, runId: 'run_1' }
        },
        /** Minimal SSE stub so the stream route is exercised like production Express. */
        async runDailyCycleSse(res) {
          res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
          res.setHeader('Cache-Control', 'no-cache, no-transform')
          if (typeof res.flushHeaders === 'function') res.flushHeaders()
          res.write(`event: start\ndata: ${JSON.stringify({ asOfDate: '2026-04-07' })}\n\n`)
          res.write(`event: complete\ndata: ${JSON.stringify({ ok: true, runId: 'run_sse' })}\n\n`)
          res.end()
        },
      },
    })
    server = http.createServer(app)
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address()
    baseUrl = `http://127.0.0.1:${port}`
  })

  after(async () => {
    if (!server) return
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()))
    })
  })

  it('GET /api/ai-portfolio/config returns manager map', async () => {
    const response = await fetch(`${baseUrl}/api/ai-portfolio/config`)
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(Array.isArray(body.managers), true)
    assert.equal(body.managers[0].id, 'claude')
  })

  it('GET /api/ai-portfolio/summary returns summary payload', async () => {
    const response = await fetch(`${baseUrl}/api/ai-portfolio/summary`)
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.managers.claude.equityUsd, 50000)
  })

  it('GET /api/ai-portfolio/ledger returns trade ledger payload', async () => {
    const response = await fetch(`${baseUrl}/api/ai-portfolio/ledger`)
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.managers.claude[0].ticker, 'AAPL')
    assert.equal(body.managers.claude[0].entryAt, '2026-04-07')
  })

  it('POST /api/ai-portfolio/simulate/daily runs daily cycle', async () => {
    const response = await fetch(`${baseUrl}/api/ai-portfolio/simulate/daily`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asOfDate: '2026-04-07' }),
    })
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.runId, 'run_1')
  })

  it('POST /api/ai-portfolio/simulate/daily-stream returns SSE framing', async () => {
    const response = await fetch(`${baseUrl}/api/ai-portfolio/simulate/daily-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({}),
    })
    assert.equal(response.status, 200)
    const text = await response.text()
    assert.ok(text.includes('event: start'))
    assert.ok(text.includes('event: complete'))
  })
})

