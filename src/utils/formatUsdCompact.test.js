import test from 'node:test'
import assert from 'node:assert/strict'
import { formatUsdCompact } from './formatUsdCompact.ts'

test('formatUsdCompact millions truncates toward zero', () => {
  assert.equal(formatUsdCompact(-952_869_955), '−$952M')
  assert.equal(formatUsdCompact(952_869_955), '$952M')
})

test('formatUsdCompact billions and thousands', () => {
  assert.equal(formatUsdCompact(2_500_000_000), '$2B')
  assert.equal(formatUsdCompact(12_400), '$12K')
  assert.equal(formatUsdCompact(400), '$400')
})
