import assert from 'node:assert/strict'
import http from 'node:http'
import { after, before, describe, it } from 'node:test'

import express from 'express'

import { registerOptionsBacktestRoutes } from './registerOptionsBacktestRoutes.js'

describe('registerOptionsBacktestRoutes', () => {
  let server
  let baseUrl

  before(async () => {
    const app = express()
    app.use(express.json())
    registerOptionsBacktestRoutes(app, {
      service: {
        async listRuns() {
          return {
            ok: true,
            runs: [{ id: 'run_1', ticker: 'AAPL', strategy: 'cash_secured_put' }],
          }
        },
        async getRun(runId) {
          return {
            ok: true,
            run: { id: runId, ticker: 'AAPL', strategy: 'cash_secured_put' },
            setups: [{ id: 'setup_1', metrics: { sharpe: 1.2 } }],
            selectedSetupId: 'setup_1',
            recentRuns: [],
            assumptions: {},
            warnings: [],
          }
        },
        async run(body) {
          return {
            ok: true,
            run: { id: 'run_new', ticker: body.ticker, strategy: body.strategy },
            setups: [{ id: 'setup_new', metrics: { sharpe: 1.4 } }],
            selectedSetupId: 'setup_new',
            recentRuns: [],
            assumptions: {},
            warnings: [],
          }
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
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  })

  it('GET /api/options-backtest/runs returns saved runs', async () => {
    const response = await fetch(`${baseUrl}/api/options-backtest/runs`)
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.runs[0].id, 'run_1')
  })

  it('GET /api/options-backtest/runs/:runId returns run detail', async () => {
    const response = await fetch(`${baseUrl}/api/options-backtest/runs/run_1`)
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.run.id, 'run_1')
    assert.equal(body.setups[0].id, 'setup_1')
  })

  it('POST /api/options-backtest/run returns run payload', async () => {
    const response = await fetch(`${baseUrl}/api/options-backtest/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticker: 'AAPL',
        strategy: 'cash_secured_put',
        deltaTargets: [0.1],
        dteTargets: [30],
        profitTargetPct: 50,
        closeDte: 21,
        startDate: '2021-01-01',
        endDate: '2023-01-01',
      }),
    })
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.run.id, 'run_new')
  })
})
