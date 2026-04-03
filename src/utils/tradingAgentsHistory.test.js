import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  TRADING_AGENTS_HISTORY_LIMIT,
  appendHistoryEntry,
  createHistoryEntry,
  latestRowPerTicker,
  normalizeTicker,
  parseStoredHistory,
  serializeStoredHistory,
} from './tradingAgentsHistory.js'

describe('tradingAgentsHistory', () => {
  it('normalizeTicker uppercases and trims', () => {
    assert.equal(normalizeTicker('  nvda '), 'NVDA')
    assert.equal(normalizeTicker(''), '')
  })

  it('createHistoryEntry captures ticker metadata and decision', () => {
    const entry = createHistoryEntry({
      id: 'id-1',
      ticker: 'aapl',
      asOf: '2026-04-01',
      provider: 'openai',
      profile: 'fast',
      decision: { rating: 'BUY' },
      savedAt: '2026-04-02T00:00:00.000Z',
    })
    assert.equal(entry.id, 'id-1')
    assert.equal(entry.ticker, 'AAPL')
    assert.equal(entry.asOf, '2026-04-01')
    assert.equal(entry.provider, 'openai')
    assert.equal(entry.profile, 'fast')
    assert.equal(entry.decision.rating, 'BUY')
    assert.equal(entry.savedAt, '2026-04-02T00:00:00.000Z')
  })

  it('appendHistoryEntry prepends and enforces limit', () => {
    const make = (n) =>
      createHistoryEntry({
        id: `e${n}`,
        ticker: `T${n}`,
        asOf: '',
        provider: '',
        profile: '',
        decision: {},
        savedAt: `2026-01-${String(n).padStart(2, '0')}T00:00:00.000Z`,
      })
    const many = []
    for (let i = 0; i < TRADING_AGENTS_HISTORY_LIMIT + 5; i += 1) {
      many.push(make(i))
    }
    const base = []
    const withOne = appendHistoryEntry(base, make(99))
    assert.equal(withOne.length, 1)
    assert.equal(withOne[0].id, 'e99')

    const capped = many.reduce((acc, e) => appendHistoryEntry(acc, e), [])
    assert.equal(capped.length, TRADING_AGENTS_HISTORY_LIMIT)
    assert.equal(capped[0].id, `e${TRADING_AGENTS_HISTORY_LIMIT + 4}`)
  })

  it('latestRowPerTicker returns most recent per ticker', () => {
    const aOld = createHistoryEntry({
      id: '1',
      ticker: 'NVDA',
      asOf: '2026-04-01',
      provider: 'a',
      profile: 'full',
      decision: { rating: 'HOLD' },
      savedAt: '2026-04-01T10:00:00.000Z',
    })
    const b = createHistoryEntry({
      id: '2',
      ticker: 'META',
      asOf: '2026-04-01',
      provider: 'a',
      profile: 'full',
      decision: { rating: 'SELL' },
      savedAt: '2026-04-02T10:00:00.000Z',
    })
    const aNew = createHistoryEntry({
      id: '3',
      ticker: 'NVDA',
      asOf: '2026-04-02',
      provider: 'a',
      profile: 'fast',
      decision: { rating: 'BUY' },
      savedAt: '2026-04-02T12:00:00.000Z',
    })
    const rows = latestRowPerTicker([aOld, b, aNew])
    assert.equal(rows.length, 2)
    const bySym = Object.fromEntries(rows.map((r) => [r.ticker, r]))
    assert.equal(bySym.NVDA.id, '3')
    assert.equal(bySym.NVDA.decision.rating, 'BUY')
    assert.equal(bySym.META.id, '2')
  })

  it('parseStoredHistory accepts array or empty', () => {
    assert.deepEqual(parseStoredHistory(''), [])
    assert.deepEqual(parseStoredHistory(null), [])
    assert.deepEqual(parseStoredHistory('not json'), [])
    assert.deepEqual(parseStoredHistory('{}'), [])
    const one = [{ id: 'x', ticker: 'Z', decision: {} }]
    assert.deepEqual(parseStoredHistory(JSON.stringify(one)), one)
  })

  it('serializestoredHistory round-trips', () => {
    const e = createHistoryEntry({
      id: 'z',
      ticker: 'x',
      asOf: '',
      provider: '',
      profile: '',
      decision: { ok: true },
      savedAt: '2026-01-01T00:00:00.000Z',
    })
    const raw = serializeStoredHistory([e])
    const back = parseStoredHistory(raw)
    assert.equal(back.length, 1)
    assert.equal(back[0].ticker, 'X')
    assert.equal(back[0].decision.ok, true)
  })
})
