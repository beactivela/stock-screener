import assert from 'node:assert/strict'
import test from 'node:test'
import { estimatePositionDollarDeltas } from './stockcircleActionDollars.ts'

test('new_holding uses full position as increase', () => {
  const r = estimatePositionDollarDeltas('new_holding', null, 1_000_000)
  assert.equal(r.increaseUsd, 1_000_000)
  assert.equal(r.decreaseUsd, null)
})

test('increased: delta from post-trade value and % increase in shares', () => {
  const V = 110_000
  const p = 10
  const r = estimatePositionDollarDeltas('increased', p, V)
  assert.ok(r.increaseUsd != null)
  assert.ok(Math.abs(r.increaseUsd - (V * p) / (100 + p)) < 1e-6)
  assert.equal(r.decreaseUsd, null)
})

test('sold: delta from post-trade value and % sold', () => {
  const V = 78_100
  const p = 21.9
  const r = estimatePositionDollarDeltas('sold', p, V)
  assert.equal(r.increaseUsd, null)
  assert.ok(r.decreaseUsd != null)
  assert.ok(Math.abs(r.decreaseUsd - (V * p) / (100 - p)) < 1)
})

test('sold 100% uses full position as decrease', () => {
  const r = estimatePositionDollarDeltas('sold', 100, 50_000)
  assert.equal(r.decreaseUsd, 50_000)
})

test('invalid inputs yield nulls', () => {
  assert.deepEqual(estimatePositionDollarDeltas('increased', 10, null), {
    increaseUsd: null,
    decreaseUsd: null,
  })
  assert.deepEqual(estimatePositionDollarDeltas('unknown', 10, 1000), {
    increaseUsd: null,
    decreaseUsd: null,
  })
})
