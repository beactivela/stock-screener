import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  computeReturnPct,
  computeOutperformancePct,
  isOutperformanceTargetMet,
  summarizeBenchmarkProgress,
} from './benchmark.js'

describe('aiPortfolio benchmark math', () => {
  it('computes return percent from start and current marks', () => {
    assert.equal(computeReturnPct({ startValue: 100, currentValue: 112 }), 12)
    assert.equal(computeReturnPct({ startValue: 100, currentValue: 85 }), -15)
  })

  it('computes outperformance vs SPY', () => {
    const diff = computeOutperformancePct({ managerReturnPct: 13.5, spyReturnPct: 8.1 })
    assert.equal(diff, 5.4)
  })

  it('checks target of beating SPY by at least 5%', () => {
    assert.equal(isOutperformanceTargetMet({ outperformancePct: 5 }), true)
    assert.equal(isOutperformanceTargetMet({ outperformancePct: 4.99 }), false)
  })

  it('builds summary payload for dashboard goal tracking', () => {
    const summary = summarizeBenchmarkProgress({
      startingCapitalUsd: 50000,
      currentEquityUsd: 57500,
      spyStartPrice: 500,
      spyCurrentPrice: 525,
      targetOutperformancePct: 5,
    })

    assert.equal(summary.managerReturnPct, 15)
    assert.equal(summary.spyReturnPct, 5)
    assert.equal(summary.outperformancePct, 10)
    assert.equal(summary.targetMet, true)
  })
})

