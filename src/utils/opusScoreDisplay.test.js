import assert from 'assert'
import { describe, it } from 'node:test'
import { getOpusDisplayState } from './opusScoreDisplay.js'

describe('getOpusDisplayState', () => {
  it('treats fallback 0/F with no trade metadata as no active setup', () => {
    const state = getOpusDisplayState({
      opus45Confidence: 0,
      opus45Grade: 'F',
    })

    assert.deepEqual(state, {
      hasActiveSetup: false,
      label: '–',
      confidence: 0,
      grade: 'F',
    })
  })

  it('treats positive confidence as active setup', () => {
    const state = getOpusDisplayState({
      opus45Confidence: 87,
      opus45Grade: 'A',
    })

    assert.equal(state.hasActiveSetup, true)
    assert.equal(state.label, '87% A')
    assert.equal(state.confidence, 87)
    assert.equal(state.grade, 'A')
  })

  it('treats trade metadata as active even with low/zero confidence', () => {
    const state = getOpusDisplayState({
      opus45Confidence: 0,
      opus45Grade: 'F',
      daysSinceBuy: 2,
    })

    assert.equal(state.hasActiveSetup, true)
    assert.equal(state.label, '0% F')
  })

  it('shows non-F grades even when confidence is zero', () => {
    const state = getOpusDisplayState({
      opus45Confidence: 0,
      opus45Grade: 'C',
    })

    assert.equal(state.hasActiveSetup, true)
    assert.equal(state.label, '0% C')
  })
})
