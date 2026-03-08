import test from 'node:test'
import assert from 'node:assert/strict'

import {
  clearLocalDataCache,
  readLocalDataCache,
  writeLocalDataCache,
} from './localDataCache.js'

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
  }
}

test('readLocalDataCache returns null when storage is empty', () => {
  globalThis.localStorage = createLocalStorageMock()
  assert.equal(readLocalDataCache('missing-key'), null)
})

test('writeLocalDataCache stores payload with fetchedAt timestamp', () => {
  globalThis.localStorage = createLocalStorageMock()

  const ok = writeLocalDataCache('dashboard-cache', { results: ['AAPL'] }, { now: 1_000 })
  const entry = readLocalDataCache('dashboard-cache', { ttlMs: 5_000, now: 2_000 })

  assert.equal(ok, true)
  assert.deepEqual(entry, {
    payload: { results: ['AAPL'] },
    fetchedAt: 1_000,
    ageMs: 1_000,
    isFresh: true,
  })
})

test('readLocalDataCache can return stale data for fast initial paint', () => {
  globalThis.localStorage = createLocalStorageMock()
  writeLocalDataCache('agents-cache', { enabled: true }, { now: 1_000 })

  const entry = readLocalDataCache('agents-cache', { ttlMs: 500, now: 2_000, allowStale: true })

  assert.deepEqual(entry, {
    payload: { enabled: true },
    fetchedAt: 1_000,
    ageMs: 1_000,
    isFresh: false,
  })
})

test('readLocalDataCache rejects stale data when allowStale is false', () => {
  globalThis.localStorage = createLocalStorageMock()
  writeLocalDataCache('agents-cache', { enabled: true }, { now: 1_000 })

  const entry = readLocalDataCache('agents-cache', { ttlMs: 500, now: 2_000, allowStale: false })

  assert.equal(entry, null)
})

test('clearLocalDataCache removes cached value', () => {
  globalThis.localStorage = createLocalStorageMock()
  writeLocalDataCache('industry-cache', { industries: [] }, { now: 1_000 })

  clearLocalDataCache('industry-cache')

  assert.equal(readLocalDataCache('industry-cache'), null)
})

test('invalid JSON is treated as cache miss', () => {
  globalThis.localStorage = createLocalStorageMock()
  globalThis.localStorage.setItem('broken-cache', '{bad json')

  assert.equal(readLocalDataCache('broken-cache'), null)
})
