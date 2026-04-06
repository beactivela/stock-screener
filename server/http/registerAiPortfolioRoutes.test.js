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
        async runDailyCycle() {
          return { ok: true, runId: 'run_1' }
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
})

