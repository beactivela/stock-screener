import assert from 'node:assert/strict'
import http from 'node:http'
import { after, before, describe, it } from 'node:test'

describe('atlas web ui api', () => {
  let server
  let baseUrl

  before(async () => {
    process.env.SKIP_EXPRESS_LISTEN = '1'
    process.env.NODE_ENV = 'test'
    const { app } = await import('./index.js')
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
    delete process.env.SKIP_EXPRESS_LISTEN
    delete process.env.NODE_ENV
  })

  it('GET /api/atlas/summary returns 200 and core summary fields', async () => {
    const response = await fetch(`${baseUrl}/api/atlas/summary`)
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.equal(body.ok, true)
    assert.equal(typeof body.summary?.period, 'string')
    assert.equal(typeof body.summary?.trading_days, 'number')
    assert.equal(typeof body.summary?.autoresearch?.total_modifications, 'number')
    assert.equal(typeof body.meta?.repoUrl, 'string')
  })

  it('GET /api/atlas/summary includes freshness mtimes for Data badge', async () => {
    const response = await fetch(`${baseUrl}/api/atlas/summary`)
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(typeof body.meta?.freshness?.summary?.mtimeIso, 'string')
    assert.ok(body.meta.freshness.summary.mtimeMs > 0)
    const tr = body.meta?.freshness?.trajectory
    assert.ok(tr && (typeof tr.mtimeIso === 'string' || tr.error === 'not_found'))
  })

  it('GET /api/atlas/summary includes sparkline + final_agent_weights for Atlas page', async () => {
    const response = await fetch(`${baseUrl}/api/atlas/summary`)
    const body = await response.json()
    assert.equal(response.status, 200)

    assert.ok(body.sparkline?.points?.length > 0, 'expected portfolio_trajectory.csv sparkline in vendor/atlas-gic')
    assert.ok(body.sparkline.points.length <= 200, 'sparkline should be downsampled')
    assert.equal(typeof body.sparkline.points[0].time, 'string')
    assert.equal(typeof body.sparkline.points[0].value, 'number')
    assert.equal(body.sparkline.field, 'portfolio_value')

    const weights = body.summary?.final_agent_weights
    assert.ok(weights && typeof weights === 'object')
    assert.ok(Object.keys(weights).length >= 1, 'expected agent weight keys for Top-N UI')
  })
})
