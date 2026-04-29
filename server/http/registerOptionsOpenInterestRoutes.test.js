import assert from 'node:assert/strict'
import http from 'node:http'
import { after, before, describe, it } from 'node:test'

import express from 'express'

import { registerOptionsOpenInterestRoutes } from './registerOptionsOpenInterestRoutes.js'

describe('registerOptionsOpenInterestRoutes', () => {
  let server
  let baseUrl
  const calls = []

  before(async () => {
    const app = express()
    registerOptionsOpenInterestRoutes(app, {
      service: {
        async getOpenInterest(ticker, opts = {}) {
          calls.push({ ticker, opts })
          return {
            ok: true,
            ticker: ticker.toUpperCase(),
            spot: 209.35,
            asOf: '2026-04-24T12:00:00.000Z',
            source: 'yahoo_options_open_interest',
            selectedExpiration: opts.expiration || '2026-05-01',
            expirations: [
              { date: '2026-05-01', label: 'May 1, 2026', dte: 7 },
              { date: '2026-05-15', label: 'May 15, 2026', dte: 21 },
            ],
            strikes: [
              {
                strike: 210,
                callOpenInterest: 1200,
                putOpenInterest: 800,
                totalOpenInterest: 2000,
                callContractSymbol: 'AAPL260515C00210000',
                putContractSymbol: 'AAPL260515P00210000',
              },
            ],
            message: null,
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

  it('GET /api/options-open-interest/:ticker returns open-interest payload', async () => {
    const response = await fetch(`${baseUrl}/api/options-open-interest/aapl?expiration=2026-05-15`)
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.ticker, 'AAPL')
    assert.equal(body.selectedExpiration, '2026-05-15')
    assert.equal(body.strikes[0].callOpenInterest, 1200)
    assert.deepEqual(calls[0], { ticker: 'aapl', opts: { expiration: '2026-05-15' } })
  })
})
