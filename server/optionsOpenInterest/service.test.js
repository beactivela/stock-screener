import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildOpenInterestPayload,
  createOptionsOpenInterestService,
} from './service.js'

function contract({
  contractSymbol,
  strike,
  openInterest,
  contractSize = 'REGULAR',
  bid = null,
  ask = null,
  lastPrice = null,
  impliedVolatility = null,
  delta = null,
  gamma = null,
  theta = null,
  vega = null,
}) {
  return {
    contractSymbol: contractSymbol || `MOCK${strike}`,
    strike,
    openInterest,
    contractSize,
    bid,
    ask,
    lastPrice,
    impliedVolatility,
    delta,
    gamma,
    theta,
    vega,
  }
}

function chain({
  spot = 100,
  expirationDates = [],
  expirationDate,
  calls = [],
  puts = [],
}) {
  return {
    quote: { regularMarketPrice: spot },
    expirationDates: expirationDates.map((date) => new Date(`${date}T12:00:00Z`)),
    options: expirationDate
      ? [
          {
            expirationDate: new Date(`${expirationDate}T12:00:00Z`),
            calls,
            puts,
          },
        ]
      : [],
  }
}

function barsFromLogReturns(returns, startClose = 100) {
  let close = startClose
  return returns.map((value, index) => {
    close *= Math.exp(value)
    return {
      t: new Date(Date.UTC(2026, 1, index + 1)).getTime(),
      o: close,
      h: close,
      l: close,
      c: close,
      v: 1_000_000,
    }
  })
}

describe('buildOpenInterestPayload', () => {
  it('returns all expirations and defaults to the nearest monthly expiration', () => {
    const payload = buildOpenInterestPayload({
      ticker: 'aapl',
      spot: 209.35,
      asOf: new Date('2026-04-24T12:00:00Z'),
      expirationDates: [
        new Date('2026-05-01T12:00:00Z'),
        new Date('2026-05-15T12:00:00Z'),
      ],
      chain: chain({
        expirationDate: '2026-05-15',
        calls: [contract({ strike: 210, openInterest: 1200, contractSymbol: 'AAPL260515C00210000' })],
        puts: [contract({ strike: 210, openInterest: 800, contractSymbol: 'AAPL260515P00210000' })],
      }),
    })

    assert.equal(payload.ok, true)
    assert.equal(payload.ticker, 'AAPL')
    assert.equal(payload.selectedExpiration, '2026-05-15')
    assert.deepEqual(payload.expirations.map((item) => item.date), ['2026-05-01', '2026-05-15'])
    assert.equal(payload.expirations[0].dte, 7)
    assert.match(payload.expirations[0].label, /May 1, 2026/)
  })

  it('splits call and put open interest by strike and sorts strikes ascending', () => {
    const payload = buildOpenInterestPayload({
      ticker: 'AAPL',
      spot: 209.35,
      asOf: new Date('2026-04-24T12:00:00Z'),
      selectedExpiration: '2026-05-15',
      expirationDates: [new Date('2026-05-15T12:00:00Z')],
      chain: chain({
        expirationDate: '2026-05-15',
        calls: [
          contract({ strike: 215, openInterest: 100 }),
          contract({ strike: 210, openInterest: 1200, contractSymbol: 'AAPL260515C00210000' }),
          contract({ strike: 205, openInterest: 0 }),
        ],
        puts: [
          contract({ strike: 210, openInterest: 800, contractSymbol: 'AAPL260515P00210000' }),
          contract({ strike: 200, openInterest: 400 }),
          contract({ strike: 190, openInterest: 500, contractSize: 'MINI' }),
        ],
      }),
    })

    assert.equal(payload.ok, true)
    assert.deepEqual(payload.strikes.map((row) => row.strike), [200, 210, 215])
    assert.deepEqual(payload.strikes.find((row) => row.strike === 210), {
      strike: 210,
      callOpenInterest: 1200,
      putOpenInterest: 800,
      totalOpenInterest: 2000,
      callContractSymbol: 'AAPL260515C00210000',
      putContractSymbol: 'AAPL260515P00210000',
    })
  })

  it('keeps selected-expiration put quote fields for strategy pricing', () => {
    const payload = buildOpenInterestPayload({
      ticker: 'AAPL',
      spot: 209.35,
      asOf: new Date('2026-04-24T12:00:00Z'),
      selectedExpiration: '2026-05-15',
      expirationDates: [new Date('2026-05-15T12:00:00Z')],
      chain: chain({
        expirationDate: '2026-05-15',
        puts: [
          contract({
            strike: 200,
            openInterest: 400,
            contractSymbol: 'AAPL260515P00200000',
            bid: 3.4,
            ask: 3.8,
            lastPrice: 3.55,
            impliedVolatility: 0.31,
            delta: -0.28,
            gamma: 0.02,
            theta: -0.04,
            vega: 0.12,
          }),
        ],
      }),
    })

    assert.equal(payload.ok, true)
    assert.deepEqual(payload.strikes[0].putQuote, {
      contractSymbol: 'AAPL260515P00200000',
      bid: 3.4,
      ask: 3.8,
      lastPrice: 3.55,
      mid: 3.6,
      impliedVolatility: 0.31,
      delta: -0.28,
      gamma: 0.02,
      theta: -0.04,
      vega: 0.12,
    })
  })

  it('returns an empty payload when no strike has usable open interest', () => {
    const payload = buildOpenInterestPayload({
      ticker: 'AAPL',
      spot: 209.35,
      asOf: new Date('2026-04-24T12:00:00Z'),
      expirationDates: [new Date('2026-05-15T12:00:00Z')],
      chain: chain({
        expirationDate: '2026-05-15',
        calls: [contract({ strike: 210, openInterest: 0 })],
        puts: [contract({ strike: 205, openInterest: null })],
      }),
    })

    assert.equal(payload.ok, false)
    assert.equal(payload.message, 'No useful open interest data')
    assert.deepEqual(payload.strikes, [])
  })
})

describe('createOptionsOpenInterestService', () => {
  it('defaults to the nearest monthly expiration when no expiration is requested', async () => {
    const calls = []
    const client = {
      async options(_ticker, query = {}) {
        calls.push(query.date ? query.date.toISOString().slice(0, 10) : 'initial')
        if (!query.date) {
          return chain({
            spot: 209.35,
            expirationDates: ['2026-05-01', '2026-05-08', '2026-05-15', '2026-05-22'],
            expirationDate: '2026-05-01',
            calls: [contract({ strike: 210, openInterest: 50 })],
          })
        }
        return chain({
          spot: 209.35,
          expirationDate: query.date.toISOString().slice(0, 10),
          calls: [contract({ strike: 210, openInterest: 1200 })],
          puts: [contract({ strike: 210, openInterest: 800 })],
        })
      },
    }

    const service = createOptionsOpenInterestService({
      client,
      now: () => new Date('2026-04-24T12:00:00Z'),
      cacheTtlMs: 1,
    })

    const payload = await service.getOpenInterest('aapl')

    assert.equal(payload.ok, true)
    assert.equal(payload.selectedExpiration, '2026-05-15')
    assert.deepEqual(calls, ['initial', '2026-05-15'])
  })

  it('returns a fresh Supabase cache hit before calling Yahoo', async () => {
    const cachedPayload = {
      ok: true,
      ticker: 'AMZN',
      spot: 186.1,
      asOf: '2026-04-24T12:00:00.000Z',
      source: 'yahoo_options_open_interest',
      quotesIncluded: true,
      selectedExpiration: '2026-05-01',
      expirations: [{ date: '2026-05-01', label: 'May 1, 2026', dte: 7 }],
      strikes: [{ strike: 185, callOpenInterest: 100, putOpenInterest: 50, totalOpenInterest: 150 }],
      message: null,
    }
    const storeCalls = []
    const store = {
      async getCachedPayload(ticker, cacheKey) {
        storeCalls.push({ type: 'get', ticker, cacheKey })
        return cachedPayload
      },
      async savePayload(payload, cacheKey) {
        storeCalls.push({ type: 'save', ticker: payload.ticker, cacheKey })
      },
    }
    const client = {
      async options() {
        throw new Error('Yahoo should not be called on a fresh Supabase cache hit')
      },
    }

    const service = createOptionsOpenInterestService({
      client,
      store,
      now: () => new Date('2026-04-24T12:00:00Z'),
      cacheTtlMs: 1,
    })

    const payload = await service.getOpenInterest('amzn')

    assert.equal(payload, cachedPayload)
    assert.deepEqual(storeCalls, [{ type: 'get', ticker: 'AMZN', cacheKey: 'default' }])
  })

  it('ignores a default cached payload when a monthly expiration is available but not selected', async () => {
    const storeCalls = []
    const store = {
      async getCachedPayload(ticker, cacheKey) {
        storeCalls.push({ type: 'get', ticker, cacheKey })
        return {
          ok: true,
          ticker,
          spot: 186.1,
          asOf: '2026-04-24T12:00:00.000Z',
          source: 'yahoo_options_open_interest',
          quotesIncluded: true,
          selectedExpiration: '2026-05-01',
          expirations: [
            { date: '2026-05-01', label: 'May 1, 2026', dte: 7 },
            { date: '2026-05-15', label: 'May 15, 2026', dte: 21 },
          ],
          strikes: [{ strike: 185, callOpenInterest: 100, putOpenInterest: 50, totalOpenInterest: 150 }],
          message: null,
        }
      },
      async savePayload(payload, cacheKey) {
        storeCalls.push({ type: 'save', ticker: payload.ticker, cacheKey, selectedExpiration: payload.selectedExpiration })
      },
    }
    const yahooCalls = []
    const client = {
      async options(_ticker, query = {}) {
        yahooCalls.push(query.date ? query.date.toISOString().slice(0, 10) : 'initial')
        if (!query.date) {
          return chain({
            spot: 186.1,
            expirationDates: ['2026-05-01', '2026-05-15'],
            expirationDate: '2026-05-01',
            calls: [contract({ strike: 185, openInterest: 25 })],
          })
        }
        return chain({
          spot: 186.1,
          expirationDate: query.date.toISOString().slice(0, 10),
          calls: [contract({ strike: 185, openInterest: 100 })],
        })
      },
    }

    const service = createOptionsOpenInterestService({
      client,
      store,
      now: () => new Date('2026-04-24T12:00:00Z'),
      cacheTtlMs: 1,
    })

    const payload = await service.getOpenInterest('amzn')

    assert.equal(payload.selectedExpiration, '2026-05-15')
    assert.deepEqual(yahooCalls, ['initial', '2026-05-15'])
    assert.deepEqual(storeCalls, [
      { type: 'get', ticker: 'AMZN', cacheKey: 'default' },
      { type: 'save', ticker: 'AMZN', cacheKey: 'default', selectedExpiration: '2026-05-15' },
    ])
  })

  it('ignores older cached payloads that do not include option quotes', async () => {
    const storeCalls = []
    const store = {
      async getCachedPayload(ticker, cacheKey) {
        storeCalls.push({ type: 'get', ticker, cacheKey })
        return {
          ok: true,
          ticker,
          spot: 186.1,
          asOf: '2026-04-24T12:00:00.000Z',
          source: 'yahoo_options_open_interest',
          selectedExpiration: '2026-05-01',
          expirations: [{ date: '2026-05-01', label: 'May 1, 2026', dte: 7 }],
          strikes: [{ strike: 185, callOpenInterest: 100, putOpenInterest: 50, totalOpenInterest: 150 }],
          message: null,
        }
      },
      async savePayload(payload, cacheKey) {
        storeCalls.push({ type: 'save', ticker: payload.ticker, cacheKey, quotesIncluded: payload.quotesIncluded })
      },
    }
    const yahooCalls = []
    const client = {
      async options(_ticker, query = {}) {
        yahooCalls.push(query.date ? query.date.toISOString().slice(0, 10) : 'initial')
        if (!query.date) {
          return chain({
            spot: 186.1,
            expirationDates: ['2026-05-01'],
            expirationDate: '2026-05-01',
            puts: [contract({ strike: 185, openInterest: 10 })],
          })
        }
        return chain({
          spot: 186.1,
          expirationDate: '2026-05-01',
          puts: [
            contract({
              strike: 185,
              openInterest: 50,
              bid: 4.8,
              ask: 5.2,
              lastPrice: 5,
              impliedVolatility: 0.28,
            }),
          ],
        })
      },
    }

    const service = createOptionsOpenInterestService({
      client,
      store,
      now: () => new Date('2026-04-24T12:00:00Z'),
      cacheTtlMs: 1,
    })

    const payload = await service.getOpenInterest('amzn')

    assert.equal(payload.ok, true)
    assert.equal(payload.quotesIncluded, true)
    assert.equal(payload.strikes[0].putQuote.mid, 5)
    assert.deepEqual(yahooCalls, ['initial', '2026-05-01'])
    assert.deepEqual(storeCalls, [
      { type: 'get', ticker: 'AMZN', cacheKey: 'default' },
      { type: 'save', ticker: 'AMZN', cacheKey: 'default', quotesIncluded: true },
    ])
  })

  it('fetches Yahoo on Supabase miss and saves the payload back to Supabase', async () => {
    const storeCalls = []
    const store = {
      async getCachedPayload(ticker, cacheKey) {
        storeCalls.push({ type: 'get', ticker, cacheKey })
        return null
      },
      async savePayload(payload, cacheKey) {
        storeCalls.push({
          type: 'save',
          ticker: payload.ticker,
          cacheKey,
          selectedExpiration: payload.selectedExpiration,
        })
      },
    }
    const yahooCalls = []
    const client = {
      async options(_ticker, query = {}) {
        yahooCalls.push(query.date ? query.date.toISOString().slice(0, 10) : 'initial')
        if (!query.date) {
          return chain({
            spot: 186.1,
            expirationDates: ['2026-05-01', '2026-05-15'],
            expirationDate: '2026-05-01',
            calls: [contract({ strike: 185, openInterest: 25 })],
          })
        }
        return chain({
          spot: 186.1,
          expirationDate: query.date.toISOString().slice(0, 10),
          calls: [contract({ strike: 185, openInterest: 100 })],
          puts: [contract({ strike: 185, openInterest: 50 })],
        })
      },
    }

    const service = createOptionsOpenInterestService({
      client,
      store,
      now: () => new Date('2026-04-24T12:00:00Z'),
      cacheTtlMs: 1,
    })

    const payload = await service.getOpenInterest('amzn')

    assert.equal(payload.ok, true)
    assert.equal(payload.selectedExpiration, '2026-05-15')
    assert.deepEqual(yahooCalls, ['initial', '2026-05-15'])
    assert.deepEqual(storeCalls, [
      { type: 'get', ticker: 'AMZN', cacheKey: 'default' },
      { type: 'save', ticker: 'AMZN', cacheKey: 'default', selectedExpiration: '2026-05-15' },
    ])
  })

  it('fetches the initial expiration list and refetches the selected expiration', async () => {
    const calls = []
    const client = {
      async options(_ticker, query = {}) {
        calls.push(query.date ? query.date.toISOString().slice(0, 10) : 'initial')
        if (!query.date) {
          return chain({
            spot: 209.35,
            expirationDates: ['2026-05-01', '2026-05-15'],
            expirationDate: '2026-05-01',
            calls: [contract({ strike: 210, openInterest: 50 })],
          })
        }
        return chain({
          spot: 209.35,
          expirationDate: query.date.toISOString().slice(0, 10),
          calls: [contract({ strike: 210, openInterest: 1200 })],
          puts: [contract({ strike: 210, openInterest: 800 })],
        })
      },
    }

    const service = createOptionsOpenInterestService({
      client,
      now: () => new Date('2026-04-24T12:00:00Z'),
      cacheTtlMs: 1,
    })

    const payload = await service.getOpenInterest('aapl', { expiration: '2026-05-15' })

    assert.equal(payload.ok, true)
    assert.equal(payload.selectedExpiration, '2026-05-15')
    assert.deepEqual(calls, ['initial', '2026-05-15'])
    assert.equal(payload.strikes[0].totalOpenInterest, 2000)
  })

  it('requests selected expirations at midnight UTC for Yahoo compatibility', async () => {
    const requestedDates = []
    const client = {
      async options(_ticker, query = {}) {
        if (query.date) requestedDates.push(query.date.toISOString())
        if (!query.date) {
          return chain({
            spot: 209.35,
            expirationDates: ['2026-04-27'],
            expirationDate: '2026-04-27',
            calls: [contract({ strike: 210, openInterest: 50 })],
          })
        }
        return chain({
          spot: 209.35,
          expirationDate: '2026-04-27',
          calls: [contract({ strike: 210, openInterest: 1200 })],
        })
      },
    }

    const service = createOptionsOpenInterestService({
      client,
      now: () => new Date('2026-04-24T12:00:00Z'),
      cacheTtlMs: 1,
    })

    await service.getOpenInterest('aapl', { expiration: '2026-04-27' })

    assert.deepEqual(requestedDates, ['2026-04-27T00:00:00.000Z'])
  })

  it('filters fresh Yahoo OI strikes to a 2σ band from Supabase daily bars scaled to expiration DTE', async () => {
    const returns = Array.from({ length: 64 }, (_, index) => (index % 2 === 0 ? 0.0125 : -0.0125))
    const client = {
      async options(_ticker, query = {}) {
        if (!query.date) {
          return chain({
            spot: 100,
            expirationDates: ['2026-05-01'],
            expirationDate: '2026-05-01',
            calls: [contract({ strike: 100, openInterest: 1 })],
          })
        }
        return chain({
          spot: 100,
          expirationDate: '2026-05-01',
          calls: [
            contract({ strike: 90, openInterest: 100 }),
            contract({ strike: 95, openInterest: 100 }),
            contract({ strike: 100, openInterest: 100 }),
            contract({ strike: 105, openInterest: 100 }),
            contract({ strike: 110, openInterest: 100 }),
          ],
        })
      },
    }

    const service = createOptionsOpenInterestService({
      client,
      store: null,
      getBars: async () => barsFromLogReturns(returns),
      now: () => new Date('2026-04-24T12:00:00Z'),
      cacheTtlMs: 1,
    })

    const payload = await service.getOpenInterest('msft')

    assert.equal(payload.ok, true)
    assert.deepEqual(payload.strikes.map((row) => row.strike), [95, 100, 105])
    assert.equal(payload.strikeBand.sigmaMultiplier, 2)
    assert.equal(payload.strikeBand.dte, 7)
    assert.equal(payload.strikeBand.source, 'supabase_bars_realized_volatility')
    assert.ok(payload.strikeBand.lower < 95)
    assert.ok(payload.strikeBand.upper > 105)
  })

  it('keeps all useful OI strikes when Supabase bars are unavailable', async () => {
    const client = {
      async options(_ticker, query = {}) {
        if (!query.date) {
          return chain({
            spot: 100,
            expirationDates: ['2026-05-01'],
            expirationDate: '2026-05-01',
            calls: [contract({ strike: 100, openInterest: 1 })],
          })
        }
        return chain({
          spot: 100,
          expirationDate: '2026-05-01',
          calls: [
            contract({ strike: 90, openInterest: 100 }),
            contract({ strike: 100, openInterest: 100 }),
            contract({ strike: 110, openInterest: 100 }),
          ],
        })
      },
    }

    const service = createOptionsOpenInterestService({
      client,
      store: null,
      getBars: async () => null,
      now: () => new Date('2026-04-24T12:00:00Z'),
      cacheTtlMs: 1,
    })

    const payload = await service.getOpenInterest('msft')

    assert.equal(payload.ok, true)
    assert.deepEqual(payload.strikes.map((row) => row.strike), [90, 100, 110])
    assert.equal(payload.strikeBand, null)
  })
})
