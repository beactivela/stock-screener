import test from 'node:test'
import assert from 'node:assert/strict'

import {
  WATCHLIST_STORAGE_KEY,
  readWatchlist,
  upsertWatchlistItem,
  removeWatchlistItem,
  isTickerInWatchlist,
  getWatchlistItem,
  getWatchlistTickersSet,
} from './watchlistStorage.js'

function createLocalStorageMock() {
  const store = new Map()
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null
    },
    setItem(key, value) {
      store.set(key, String(value))
    },
    removeItem(key) {
      store.delete(key)
    },
    clear() {
      store.clear()
    },
  }
}

test('readWatchlist returns empty array on invalid JSON', () => {
  globalThis.localStorage = createLocalStorageMock()
  globalThis.localStorage.setItem(WATCHLIST_STORAGE_KEY, '{nope')
  assert.deepEqual(readWatchlist(), [])
})

test('upsertWatchlistItem adds ticker with optional note', () => {
  globalThis.localStorage = createLocalStorageMock()

  const created = upsertWatchlistItem('aapl', { note: 'Leader name' })

  assert.equal(created.ticker, 'AAPL')
  assert.equal(created.note, 'Leader name')
  assert.ok(created.createdAt)
  assert.ok(created.updatedAt)
  assert.equal(isTickerInWatchlist('AAPL'), true)
})

test('upsertWatchlistItem updates note and preserves createdAt', () => {
  globalThis.localStorage = createLocalStorageMock()

  const initial = upsertWatchlistItem('NVDA', { note: 'first' })
  const updated = upsertWatchlistItem('nvda', { note: 'second' })

  assert.equal(updated.ticker, 'NVDA')
  assert.equal(updated.note, 'second')
  assert.equal(updated.createdAt, initial.createdAt)
  assert.equal(Date.parse(updated.updatedAt) >= Date.parse(initial.updatedAt), true)
})

test('noteUpdatedAt only changes when explicitly saved', () => {
  globalThis.localStorage = createLocalStorageMock()

  const created = upsertWatchlistItem('TSLA', { note: 'first' })
  assert.equal(created.noteUpdatedAt, null)

  const updatedNoTimestamp = upsertWatchlistItem('tsla', { note: 'second' })
  assert.equal(updatedNoTimestamp.noteUpdatedAt, null)

  const updatedWithTimestamp = upsertWatchlistItem('tsla', { note: 'third', setNoteTimestamp: true })
  assert.ok(updatedWithTimestamp.noteUpdatedAt)
  assert.equal(Date.parse(updatedWithTimestamp.noteUpdatedAt) <= Date.parse(updatedWithTimestamp.updatedAt), true)

  const updatedAgainNoTimestamp = upsertWatchlistItem('TSLA', { note: 'fourth' })
  assert.equal(updatedAgainNoTimestamp.noteUpdatedAt, updatedWithTimestamp.noteUpdatedAt)
})

test('removeWatchlistItem removes an entry', () => {
  globalThis.localStorage = createLocalStorageMock()
  upsertWatchlistItem('MSFT')

  removeWatchlistItem('msft')

  assert.equal(isTickerInWatchlist('MSFT'), false)
  assert.equal(getWatchlistItem('MSFT'), null)
})

test('getWatchlistTickersSet returns normalized symbols', () => {
  globalThis.localStorage = createLocalStorageMock()
  upsertWatchlistItem('shop')
  upsertWatchlistItem('amd')

  const tickers = getWatchlistTickersSet()
  assert.equal(tickers.has('SHOP'), true)
  assert.equal(tickers.has('AMD'), true)
})
