import assert from 'node:assert/strict'
import http from 'node:http'
import { after, before, describe, it } from 'node:test'

import express from 'express'

import { registerOptionsGammaRoutes } from './registerOptionsGammaRoutes.js'

describe('registerOptionsGammaRoutes', () => {
  let server
  let baseUrl

  before(async () => {
    const app = express()
    registerOptionsGammaRoutes(app, {
      service: {
        async getGamma(ticker) {
          return {
            ok: true,
            ticker: ticker.toUpperCase(),
            spot: 125,
            asOf: '2026-04-24T12:00:00.000Z',
            source: 'yahoo_options_black_scholes',
            netGammaUsd: 1200000,
            regime: 'long_gamma',
            topLevels: [{ strike: 125, netGammaUsd: 1200000, absGammaUsd: 1200000 }],
            allLevels: [{ strike: 125, netGammaUsd: 1200000, absGammaUsd: 1200000 }],
            monthlyOnly: true,
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

  it('GET /api/options-gamma/:ticker returns gamma payload', async () => {
    const response = await fetch(`${baseUrl}/api/options-gamma/vrt`)
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.ticker, 'VRT')
    assert.equal(body.regime, 'long_gamma')
    assert.equal(body.topLevels[0].strike, 125)
  })
})

