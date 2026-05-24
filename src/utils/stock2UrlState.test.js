import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildStock2SearchParams,
  DEFAULT_EMA_PERIOD_1,
  DEFAULT_EMA_PERIOD_2,
  parseEmaPeriod,
  parseStock2SearchParams,
  parseTrades,
  serializeStrategy,
  serializeTrades,
} from './stock2UrlState.ts'

describe('stock2UrlState', () => {
  it('parses TradeVision-style query params', () => {
    const params = new URLSearchParams(
      'expiration=2026-06-26&strategy=bull-put-spread&axisOverlay=OpenInterest&trades=385PB1_420PS1&indicators=false&interval=1D&commission=0.00',
    )
    const state = parseStock2SearchParams(params)
    assert.equal(state.expiration, '2026-06-26')
    assert.equal(state.strategy, 'put_credit_spread')
    assert.equal(state.interval, '1d')
    assert.equal(state.indicators, false)
    assert.equal(state.axisOverlay, 'OpenInterest')
    assert.equal(state.commission, '0.00')
    assert.deepEqual(state.trades, { shortStrike: 420, longStrike: 385 })
  })

  it('parses trades legs PB=buy put (long), PS=sell put (short)', () => {
    assert.deepEqual(parseTrades('385PB1_420PS1'), { shortStrike: 420, longStrike: 385 })
    assert.equal(parseTrades('invalid'), null)
  })

  it('serializes strategy and trades for shareable URLs', () => {
    const built = buildStock2SearchParams({
      expiration: '2026-06-26',
      strategy: 'put_credit_spread',
      interval: '1d',
      indicators: false,
      shortStrike: 420,
      longStrike: 385,
      axisOverlay: 'OpenInterest',
      commission: '0.00',
    })
    assert.equal(built.get('strategy'), 'bull-put-spread')
    assert.equal(built.get('interval'), '1D')
    assert.equal(built.get('trades'), '385PB1_420PS1')
    assert.equal(serializeStrategy('put_credit_spread'), 'bull-put-spread')
    assert.equal(serializeTrades(420, 385, 'put_credit_spread'), '385PB1_420PS1')
  })

  it('defaults EMA periods to 63 and 79 when URL omits them', () => {
    const state = parseStock2SearchParams(new URLSearchParams('interval=1D'))
    assert.equal(state.ema1, DEFAULT_EMA_PERIOD_1)
    assert.equal(state.ema2, DEFAULT_EMA_PERIOD_2)
  })

  it('parses custom EMA periods and rejects invalid values', () => {
    assert.equal(parseEmaPeriod('21', DEFAULT_EMA_PERIOD_1), 21)
    assert.equal(parseEmaPeriod('0', DEFAULT_EMA_PERIOD_1), DEFAULT_EMA_PERIOD_1)
    assert.equal(parseEmaPeriod('abc', DEFAULT_EMA_PERIOD_2), DEFAULT_EMA_PERIOD_2)
    assert.equal(parseEmaPeriod('9999', DEFAULT_EMA_PERIOD_2), DEFAULT_EMA_PERIOD_2)

    const state = parseStock2SearchParams(new URLSearchParams('ema1=55&ema2=89'))
    assert.equal(state.ema1, 55)
    assert.equal(state.ema2, 89)
  })

  it('serializes non-default EMA periods into shareable URLs', () => {
    const built = buildStock2SearchParams({
      interval: '1d',
      ema1: 55,
      ema2: 89,
    })
    assert.equal(built.get('ema1'), '55')
    assert.equal(built.get('ema2'), '89')

    const defaults = buildStock2SearchParams({ interval: '1d' })
    assert.equal(defaults.get('ema1'), null)
    assert.equal(defaults.get('ema2'), null)
  })

  it('defaults EMA distance indicator on and allows opt-out via emaDist=false', () => {
    assert.equal(parseStock2SearchParams(new URLSearchParams('interval=1D')).emaDistance, true)
    assert.equal(parseStock2SearchParams(new URLSearchParams('emaDist=false')).emaDistance, false)

    const built = buildStock2SearchParams({ interval: '1d', emaDistance: false })
    assert.equal(built.get('emaDist'), 'false')
    assert.equal(buildStock2SearchParams({ interval: '1d' }).get('emaDist'), null)
  })

  it('round-trips parse then build', () => {
    const initial = new URLSearchParams(
      'expiration=2026-06-26&strategy=bull-put-spread&trades=385PB1_420PS1&indicators=true&interval=1W',
    )
    const parsed = parseStock2SearchParams(initial)
    const rebuilt = buildStock2SearchParams({
      expiration: parsed.expiration,
      strategy: parsed.strategy,
      interval: parsed.interval,
      indicators: parsed.indicators,
      shortStrike: parsed.trades?.shortStrike ?? null,
      longStrike: parsed.trades?.longStrike ?? null,
    })
    assert.equal(rebuilt.get('expiration'), '2026-06-26')
    assert.equal(rebuilt.get('strategy'), 'bull-put-spread')
    assert.equal(rebuilt.get('interval'), '1W')
    assert.equal(rebuilt.get('indicators'), 'true')
    assert.equal(rebuilt.get('trades'), '385PB1_420PS1')
  })
})
