import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  clampTopN,
  computeAgentRange,
  topNSelectOptions,
  topWeightedAgentEntries,
} from './atlasAgentWeights.js'

describe('atlasAgentWeights (Atlas web UI logic)', () => {
  it('computeAgentRange caps at 25 and floors minAgents for small counts', () => {
    assert.deepEqual(computeAgentRange(0), { maxAgents: 0, minAgents: 0 })
    assert.deepEqual(computeAgentRange(2), { maxAgents: 2, minAgents: 2 })
    assert.deepEqual(computeAgentRange(10), { maxAgents: 10, minAgents: 3 })
    assert.deepEqual(computeAgentRange(100), { maxAgents: 25, minAgents: 3 })
  })

  it('clampTopN respects agent range', () => {
    const r = { maxAgents: 10, minAgents: 3 }
    assert.equal(clampTopN(8, r), 8)
    assert.equal(clampTopN(1, r), 3)
    assert.equal(clampTopN(99, r), 10)
  })

  it('topWeightedAgentEntries returns sorted slice', () => {
    const weights = { a: 1, b: 3, c: 2 }
    const range = { maxAgents: 3, minAgents: 3 }
    const entries = topWeightedAgentEntries(weights, 8, range)
    assert.deepEqual(entries, [
      ['b', 3],
      ['c', 2],
      ['a', 1],
    ])
  })

  it('topNSelectOptions lists inclusive range', () => {
    assert.deepEqual(topNSelectOptions({ maxAgents: 5, minAgents: 3 }), [3, 4, 5])
  })
})
