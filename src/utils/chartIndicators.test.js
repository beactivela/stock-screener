import assert from 'node:assert/strict'
import test from 'node:test'

import { buildLineSeriesWithTimeline, vcpStage2Indicator } from './chartIndicators.ts'

function buildBarsFromCloses(closes) {
  const startTime = new Date('2024-01-01T00:00:00Z').getTime()
  return closes.map((close, index) => ({
    t: startTime + index * 24 * 60 * 60 * 1000,
    o: close - 1,
    h: close + 1.5,
    l: close - 1.5,
    c: close,
    v: 1_000_000 + index * 1_000,
  }))
}

function buildStrictStage2Closes() {
  const closes = []

  for (let i = 0; i < 170; i++) {
    closes.push(80 + i * 0.45)
  }

  closes.push(
    157, 159, 161, 163, 165, 163, 161, 159, 160, 162, 164,
    166, 168, 170, 168, 166, 164, 165, 167, 169, 171, 173,
    175, 174, 173, 172, 173, 175, 177, 179, 181, 183, 185,
  )

  return closes
}

test('vcpStage2Indicator returns 1 when strict Stage 2 conditions are satisfied', () => {
  const bars = buildBarsFromCloses(buildStrictStage2Closes())
  const series = vcpStage2Indicator(bars, { relativeStrengthRating: 90 })

  assert.equal(series.length, bars.length)
  assert.equal(series.at(-1), 1)
})

test('vcpStage2Indicator returns 0 when relative strength is not strong enough', () => {
  const bars = buildBarsFromCloses(buildStrictStage2Closes())
  const series = vcpStage2Indicator(bars, { relativeStrengthRating: 75 })

  assert.equal(series.at(-1), 0)
})

test('vcpStage2Indicator returns 0 when higher-high and higher-low structure fails', () => {
  const closes = buildStrictStage2Closes()
  closes.splice(-12, 12, 175, 173, 171, 168, 165, 162, 163, 164, 165, 166, 167, 168)

  const bars = buildBarsFromCloses(closes)
  const series = vcpStage2Indicator(bars, { relativeStrengthRating: 90 })

  assert.equal(series.at(-1), 0)
})

test('vcpStage2Indicator handles insufficient bars safely', () => {
  const bars = buildBarsFromCloses(Array.from({ length: 120 }, (_, index) => 100 + index * 0.5))
  const series = vcpStage2Indicator(bars, { relativeStrengthRating: 90 })

  assert.equal(series.length, bars.length)
  assert.equal(series.at(-1), null)
})

test('buildLineSeriesWithTimeline preserves dates when values have warmup nulls', () => {
  const bars = buildBarsFromCloses([100, 101, 102, 103])
  const series = buildLineSeriesWithTimeline(bars, [null, null, 1, 0])

  assert.equal(series.length, 4)
  assert.deepEqual(series[0], { time: Math.floor(bars[0].t / 1000) })
  assert.deepEqual(series[1], { time: Math.floor(bars[1].t / 1000) })
  assert.deepEqual(series[2], { time: Math.floor(bars[2].t / 1000), value: 1 })
  assert.deepEqual(series[3], { time: Math.floor(bars[3].t / 1000), value: 0 })
})

test('buildLineSeriesWithTimeline can replace null warmup values with a numeric fallback', () => {
  const bars = buildBarsFromCloses([100, 101, 102, 103])
  const series = buildLineSeriesWithTimeline(bars, [null, null, 1, 0], { fallbackValue: 0 })

  assert.equal(series.length, 4)
  assert.deepEqual(series[0], { time: Math.floor(bars[0].t / 1000), value: 0 })
  assert.deepEqual(series[1], { time: Math.floor(bars[1].t / 1000), value: 0 })
  assert.deepEqual(series[2], { time: Math.floor(bars[2].t / 1000), value: 1 })
  assert.deepEqual(series[3], { time: Math.floor(bars[3].t / 1000), value: 0 })
})
