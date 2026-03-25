import assert from 'node:assert/strict'
import http from 'node:http'
import { after, before, describe, it } from 'node:test'

describe('app smoke', () => {
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

  it('responds to /api/health with ok payload', async () => {
    const response = await fetch(`${baseUrl}/api/health`)
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.ok, true)
    assert.equal(typeof body.uptime, 'number')
  })
})
