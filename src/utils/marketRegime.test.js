import { describe, it } from 'node:test'
import assert from 'node:assert'
import { classifyMovingAverageRegime } from './marketRegime.js'

describe('marketRegime helper - simplified 3-state classification', () => {
  it('classifies Risk ON when 50 MA angle > 20 degrees', () => {
    // Strong upward slope
    const recentMa50 = [100, 102, 104, 106, 108, 110, 112, 114, 116, 118]
    assert.equal(
      classifyMovingAverageRegime({ ma50: 118, recentMa50 }),
      'Risk ON'
    )
  })

  it('classifies Cautious when 50 MA angle > 5 and <= 20 degrees', () => {
    // Moderate upward slope (3% gain)
    const recentMa50 = [100, 100.33, 100.66, 101, 101.33, 101.66, 102, 102.33, 102.66, 103]
    assert.equal(
      classifyMovingAverageRegime({ ma50: 103, recentMa50 }),
      'Cautious'
    )
  })

  it('classifies Risk OFF when 50 MA angle <= 5 degrees (slight upward)', () => {
    // Slight upward slope (~0.5% gain)
    const recentMa50 = [100, 100.05, 100.1, 100.15, 100.2, 100.25, 100.3, 100.35, 100.4, 100.5]
    assert.equal(
      classifyMovingAverageRegime({ ma50: 100.5, recentMa50 }),
      'Risk OFF'
    )
  })

  it('classifies Risk OFF when 50 MA angle is 0 degrees (flat)', () => {
    // Flat market
    const recentMa50 = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100]
    assert.equal(
      classifyMovingAverageRegime({ ma50: 100, recentMa50 }),
      'Risk OFF'
    )
  })

  it('classifies Risk OFF when 50 MA angle is negative (declining)', () => {
    // Downward slope
    const recentMa50 = [100, 99.7, 99.4, 99.1, 98.8, 98.5, 98.2, 97.9, 97.6, 97]
    assert.equal(
      classifyMovingAverageRegime({ ma50: 97, recentMa50 }),
      'Risk OFF'
    )
  })

  it('classifies Risk OFF when 50 MA angle is strongly negative', () => {
    // Strong downward slope
    const recentMa50 = [118, 116, 114, 112, 110, 108, 106, 104, 102, 100]
    assert.equal(
      classifyMovingAverageRegime({ ma50: 100, recentMa50 }),
      'Risk OFF'
    )
  })

  it('returns Risk OFF when insufficient data (less than 10 points)', () => {
    const recentMa50 = [100, 101, 102]
    assert.equal(
      classifyMovingAverageRegime({ ma50: 102, recentMa50 }),
      'Risk OFF'
    )
  })

  it('returns Risk OFF when ma50 is null', () => {
    assert.equal(
      classifyMovingAverageRegime({ ma50: null, recentMa50: [100, 101, 102] }),
      'Risk OFF'
    )
  })

  it('returns Risk OFF when recentMa50 is empty', () => {
    assert.equal(
      classifyMovingAverageRegime({ ma50: 100, recentMa50: [] }),
      'Risk OFF'
    )
  })
})
