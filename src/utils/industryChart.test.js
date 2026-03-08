import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  buildIndustrySparklineAreaPath,
  buildIndustrySparklineMonthlyPoints,
  buildIndustrySparklinePath,
  buildIndustrySparklinePoints,
  buildIndustryStackSegments,
  getIndustryChartDomain,
  getIndustryLastMonthSegmentColor,
  getIndustrySparklineRowDomain,
  getIndustrySparklineDomain,
  isIndustrySparklineDowntrend,
  sparklineXToMonthOffset,
  valueToPct,
} from './industryChart.js'

describe('industryChart utils', () => {
  it('builds default 1M, 1M->3M, and 3M->6M stacked segments', () => {
    const segments = buildIndustryStackSegments({ perf1M: 5, perf3M: 12, perf6M: 30 })
    assert.deepEqual(segments, [
      { id: 'perf1M', start: 0, end: 5 },
      { id: 'perf1MTo3M', start: 5, end: 12 },
      { id: 'perf3MTo6M', start: 12, end: 30 },
    ])
  })

  it('supports cross-zero transitions across 1M/3M/6M', () => {
    const segments = buildIndustryStackSegments({ perf1M: 2, perf3M: -6, perf6M: 4 })
    assert.deepEqual(segments, [
      { id: 'perf1M', start: 0, end: 2 },
      { id: 'perf1MTo3M', start: 2, end: -6 },
      { id: 'perf3MTo6M', start: -6, end: 4 },
    ])
  })

  it('computes domain from all segment endpoints', () => {
    const rows = [
      { perf3M: 20, perf6M: 35 },
      { perf3M: -8, perf6M: -25 },
    ]
    assert.equal(getIndustryChartDomain(rows), 35)
  })

  it('maps values to centered percentage positions', () => {
    assert.equal(valueToPct(-20, 20), 0)
    assert.equal(valueToPct(0, 20), 50)
    assert.equal(valueToPct(20, 20), 100)
  })

  it('builds inferred 6M sparkline points from 1M/3M/6M snapshots', () => {
    const points = buildIndustrySparklinePoints({ perf1M: 5, perf3M: 12, perf6M: 30 })
    assert.equal(points[0].x, 0)
    assert.equal(points[0].y, 0)
    assert.equal(points[3].x, 1)
    assert.equal(points[3].y, 30)
    assert.ok(points[1].y > 15 && points[1].y < 17) // compounded value, not naive subtraction
    assert.ok(points[2].y > 23 && points[2].y < 24)
  })

  it('computes sparkline domain from inferred point amplitudes', () => {
    const rows = [
      { perf1M: 3, perf3M: 8, perf6M: 10 },
      { perf1M: -2, perf3M: -6, perf6M: -14 },
    ]
    assert.equal(getIndustrySparklineDomain(rows), 14)
  })

  it('builds svg path for sparkline rendering', () => {
    const points = buildIndustrySparklinePoints({ perf1M: 5, perf3M: 12, perf6M: 30 })
    const path = buildIndustrySparklinePath(points, { width: 100, height: 24, maxAbs: 30, paddingY: 2 })
    assert.ok(path.startsWith('M '))
    assert.ok(path.includes(' L '))
  })

  it('builds closed mountain area path from sparkline line path', () => {
    const points = buildIndustrySparklinePoints({ perf1M: 5, perf3M: 12, perf6M: 30 })
    const areaPath = buildIndustrySparklineAreaPath(points, { width: 100, height: 24, maxAbs: 30, paddingY: 2 })
    assert.ok(areaPath.startsWith('M '))
    assert.ok(areaPath.endsWith(' Z'))
  })

  it('builds inferred monthly points from -6 months to now', () => {
    const monthly = buildIndustrySparklineMonthlyPoints({ perf1M: 5, perf3M: 12, perf6M: 30 })
    assert.equal(monthly.length, 7)
    assert.deepEqual(monthly[0], { monthOffset: -6, x: 0, y: 0 })
    assert.deepEqual(monthly[6], { monthOffset: 0, x: 1, y: 30 })
  })

  it('uses compounded lookback math for 3M→6M alignment (Computer Peripherals case)', () => {
    const points = buildIndustrySparklinePoints({ perf1M: -13.77, perf3M: 2.96, perf6M: 80.27 })
    assert.equal(points[0].y, 0)
    assert.ok(Math.abs(points[1].y - 75.06) < 0.2)
    assert.ok(Math.abs(points[2].y - 109.06) < 0.25)
    assert.ok(Math.abs(points[3].y - 80.27) < 0.01)
  })

  it('maps x position to nearest month offset for hover', () => {
    assert.equal(sparklineXToMonthOffset(0), -6)
    assert.equal(sparklineXToMonthOffset(0.5), -3)
    assert.equal(sparklineXToMonthOffset(1), 0)
    assert.equal(sparklineXToMonthOffset(0.82), -1)
  })

  it('flags sparkline as downtrend when 1M return is negative', () => {
    assert.equal(isIndustrySparklineDowntrend({ perf1M: -0.01 }), true)
    assert.equal(isIndustrySparklineDowntrend({ perf1M: 0 }), false)
    assert.equal(isIndustrySparklineDowntrend({ perf1M: 2.5 }), false)
    assert.equal(isIndustrySparklineDowntrend({}), false)
  })

  it('colors last month segment by zero-axis and monthly trend rules', () => {
    assert.equal(getIndustryLastMonthSegmentColor({ perf1M: 2, perf6M: 10 }), 'blue') // value > 0 + trending up
    assert.equal(getIndustryLastMonthSegmentColor({ perf1M: -2, perf6M: 10 }), 'red') // value > 0 + trending down
    assert.equal(getIndustryLastMonthSegmentColor({ perf1M: -1, perf6M: -5 }), 'red') // value < 0 + trending down
    assert.equal(getIndustryLastMonthSegmentColor({ perf1M: 1, perf6M: -5 }), 'blue') // value < 0 + trending up
  })

  it('computes row-level sparkline domain from its own movement', () => {
    const row = { perf1M: -13.77, perf3M: 2.96, perf6M: 80.27 }
    const domain = getIndustrySparklineRowDomain(row)
    assert.ok(domain > 100 && domain < 111)
  })
})
