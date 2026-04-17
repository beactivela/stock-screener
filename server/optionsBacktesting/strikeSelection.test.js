import assert from 'node:assert/strict'
import test from 'node:test'

import { selectStrikeForTargetDelta } from './strikeSelection.js'

test('selectStrikeForTargetDelta finds a modeled strike near target delta', () => {
  const selected = selectStrikeForTargetDelta({
    spot: 100,
    targetDelta: 0.2,
    entryDte: 45,
    volatility: 0.3,
  })
  assert.ok(selected.strike > 0)
  assert.ok(Math.abs(Math.abs(selected.delta) - 0.2) < 0.08)
  assert.ok(selected.premium > 0)
})
