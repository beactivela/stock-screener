/**
 * Curated Congress Trades leaderboard — shape and ordering invariants.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { CONGRESS_TRADES_LEADERBOARD } from './congressTradesLeaderboard.ts'

test('CONGRESS_TRADES_LEADERBOARD has 20 rows with ranks 1–20 and required fields', () => {
  assert.equal(CONGRESS_TRADES_LEADERBOARD.length, 20)
  CONGRESS_TRADES_LEADERBOARD.forEach((row, i) => {
    assert.equal(row.rank, i + 1, `rank at index ${i}`)
    assert.ok(typeof row.name === 'string' && row.name.trim().length > 0, `name at index ${i}`)
    assert.ok(typeof row.perf1y === 'string' && row.perf1y.trim().length > 0, `perf1y at index ${i}`)
  })
})
