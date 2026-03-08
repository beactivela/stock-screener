import test from 'node:test'
import assert from 'node:assert/strict'
import { getIndexStackOrder } from '../indexOrder.js'

test('getIndexStackOrder keeps default order when no selection', () => {
  const tickers = ['^GSPC', '^IXIC', '^RUT', '^DJI']
  assert.deepEqual(getIndexStackOrder(null, tickers), tickers)
})

test('getIndexStackOrder moves selected ticker to front', () => {
  const tickers = ['^GSPC', '^IXIC', '^RUT', '^DJI']
  assert.deepEqual(getIndexStackOrder('^RUT', tickers), ['^RUT', '^GSPC', '^IXIC', '^DJI'])
})

test('getIndexStackOrder ignores unknown selection', () => {
  const tickers = ['^GSPC', '^IXIC', '^RUT', '^DJI']
  assert.deepEqual(getIndexStackOrder('^UNKNOWN', tickers), tickers)
})
