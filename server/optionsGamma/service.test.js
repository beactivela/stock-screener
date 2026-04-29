import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  blackScholesGamma,
  buildGammaPayload,
  createOptionsGammaService,
  isStandardMonthlyExpiration,
  practicalGammaExposureUsd,
} from './service.js'

function option({
  strike,
  openInterest = 100,
  impliedVolatility = 0.4,
  contractSize = 'REGULAR',
}) {
  return {
    contractSymbol: `MOCK${strike}`,
    strike,
    openInterest,
    impliedVolatility,
    contractSize,
  }
}

function chain({
  spot = 100,
  expirationDate,
  calls = [],
  puts = [],
}) {
  return {
    quote: { regularMarketPrice: spot },
    options: [
      {
        expirationDate: new Date(`${expirationDate}T12:00:00Z`),
        calls,
        puts,
      },
    ],
  }
}

describe('options gamma service math', () => {
  it('computes positive finite Black-Scholes gamma for normal inputs', () => {
    const gamma = blackScholesGamma({
      spot: 100,
      strike: 100,
      yearsToExpiry: 30 / 365,
      volatility: 0.3,
    })
    assert.equal(typeof gamma, 'number')
    assert.ok(gamma > 0)
  })

  it('returns null for invalid gamma inputs', () => {
    assert.equal(blackScholesGamma({ spot: 0, strike: 100, yearsToExpiry: 1, volatility: 0.3 }), null)
    assert.equal(blackScholesGamma({ spot: 100, strike: 100, yearsToExpiry: 0, volatility: 0.3 }), null)
    assert.equal(blackScholesGamma({ spot: 100, strike: 100, yearsToExpiry: 1, volatility: 0 }), null)
  })

  it('signs practical GEX positive for calls and negative for puts', () => {
    const callGex = practicalGammaExposureUsd({ gamma: 0.02, openInterest: 100, spot: 50, optionType: 'call' })
    const putGex = practicalGammaExposureUsd({ gamma: 0.02, openInterest: 100, spot: 50, optionType: 'put' })
    assert.ok(callGex > 0)
    assert.equal(putGex, -callGex)
  })

  it('detects standard third-Friday monthly expirations', () => {
    assert.equal(isStandardMonthlyExpiration(new Date('2026-05-15T12:00:00Z')), true)
    assert.equal(isStandardMonthlyExpiration(new Date('2026-05-22T12:00:00Z')), false)
    assert.equal(isStandardMonthlyExpiration(new Date('2026-05-14T12:00:00Z')), false)
  })

  it('aggregates call and put GEX by strike', () => {
    const payload = buildGammaPayload({
      ticker: 'ABC',
      spot: 100,
      asOf: new Date('2026-04-24T12:00:00Z'),
      chains: [
        chain({
          expirationDate: '2026-05-15',
          calls: [option({ strike: 100, openInterest: 100 })],
          puts: [option({ strike: 100, openInterest: 50 })],
        }),
        chain({
          expirationDate: '2026-05-15',
          calls: [option({ strike: 110, openInterest: 100 })],
        }),
      ],
    })
    assert.equal(payload.ok, true)
    const row = payload.allLevels.find((level) => level.strike === 100)
    assert.ok(row)
    assert.ok(row.callGammaUsd > 0)
    assert.ok(row.putGammaUsd < 0)
    assert.equal(row.contractCount, 2)
  })
})

describe('createOptionsGammaService', () => {
  it('filters 7-180 DTE and prefers monthly expirations for top levels', async () => {
    const calls = []
    const seen = []
    const client = {
      async options(_ticker, query = {}) {
        calls.push(query.date ? query.date.toISOString().slice(0, 10) : 'initial')
        if (!query.date) {
          return {
            quote: { regularMarketPrice: 100 },
            expirationDates: [
              new Date('2026-04-30T12:00:00Z'),
              new Date('2026-05-15T12:00:00Z'),
              new Date('2026-05-22T12:00:00Z'),
              new Date('2026-12-18T12:00:00Z'),
            ],
            options: [],
          }
        }
        const key = query.date.toISOString().slice(0, 10)
        seen.push(key)
        if (key === '2026-05-15') {
          return chain({
            expirationDate: key,
            calls: [option({ strike: 100, openInterest: 500 }), option({ strike: 105, openInterest: 400 })],
            puts: [option({ strike: 95, openInterest: 450 })],
          })
        }
        return chain({
          expirationDate: key,
          calls: [option({ strike: 130, openInterest: 10 })],
          puts: [option({ strike: 70, openInterest: 10 })],
        })
      },
    }
    const service = createOptionsGammaService({
      client,
      now: () => new Date('2026-04-24T12:00:00Z'),
      cacheTtlMs: 1,
    })
    const payload = await service.getGamma('abc')
    assert.equal(payload.ok, true)
    assert.equal(payload.monthlyOnly, true)
    assert.deepEqual(seen.sort(), ['2026-05-15', '2026-05-22'])
    assert.ok(calls.includes('initial'))
    assert.ok(!seen.includes('2026-04-30'))
    assert.ok(!seen.includes('2026-12-18'))
    assert.ok(payload.topLevels.every((level) => [95, 100, 105].includes(level.strike)))
  })

  it('falls back to all expirations when monthly data is empty', async () => {
    const client = {
      async options(_ticker, query = {}) {
        if (!query.date) {
          return {
            quote: { regularMarketPrice: 100 },
            expirationDates: [new Date('2026-05-22T12:00:00Z')],
            options: [],
          }
        }
        return chain({
          expirationDate: '2026-05-22',
          calls: [option({ strike: 100, openInterest: 500 }), option({ strike: 105, openInterest: 400 })],
        })
      },
    }
    const service = createOptionsGammaService({
      client,
      now: () => new Date('2026-04-24T12:00:00Z'),
      cacheTtlMs: 1,
    })
    const payload = await service.getGamma('abc')
    assert.equal(payload.ok, true)
    assert.equal(payload.monthlyOnly, false)
    assert.equal(payload.topLevels.length, 2)
  })

  it('returns no useful gamma data for thin chains', async () => {
    const client = {
      async options(_ticker, query = {}) {
        if (!query.date) {
          return {
            quote: { regularMarketPrice: 100 },
            expirationDates: [new Date('2026-05-15T12:00:00Z')],
            options: [],
          }
        }
        return chain({
          expirationDate: '2026-05-15',
          calls: [option({ strike: 100, openInterest: 0 })],
        })
      },
    }
    const service = createOptionsGammaService({
      client,
      now: () => new Date('2026-04-24T12:00:00Z'),
      cacheTtlMs: 1,
    })
    const payload = await service.getGamma('abc')
    assert.equal(payload.ok, false)
    assert.equal(payload.message, 'No useful gamma data')
    assert.deepEqual(payload.topLevels, [])
  })
})

