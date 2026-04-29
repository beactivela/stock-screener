import { describe, it } from 'node:test'
import assert from 'node:assert'
import { classifyMovingAverageRegime } from './marketRegime.js'

describe('marketRegime helper - MA alignment classification', () => {
  it('classifies Risk ON when close is above the 20 MA and the 10 MA is above the 50 MA', () => {
    assert.equal(
      classifyMovingAverageRegime({ close: 105, ma10: 103, ma20: 100, ma50: 98 }),
      'Risk ON'
    )
  })

  it('classifies Risk OFF when close is not above the 20 MA', () => {
    assert.equal(
      classifyMovingAverageRegime({ close: 99, ma10: 103, ma20: 100, ma50: 98 }),
      'Risk OFF'
    )
  })

  it('classifies Risk OFF when the 10 MA is not above the 50 MA', () => {
    assert.equal(
      classifyMovingAverageRegime({ close: 105, ma10: 97, ma20: 100, ma50: 98 }),
      'Risk OFF'
    )
  })

  it('returns Risk OFF when required values are missing', () => {
    assert.equal(
      classifyMovingAverageRegime({ close: 105, ma10: 103, ma20: null, ma50: 98 }),
      'Risk OFF'
    )
  })
})
