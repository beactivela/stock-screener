import assert from 'node:assert/strict'
import test from 'node:test'

import { buildLineSeriesWithTimeline, buildPaddedIndicatorSeries, rsi, vcpStage2Indicator } from './chartIndicators.ts'

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

test('buildPaddedIndicatorSeries keeps one point per bar for stacked chart alignment', () => {
  const bars = buildBarsFromCloses(Array.from({ length: 20 }, (_, index) => 100 + index))
  const toTime = (t) => Math.floor(t / 1000)
  const values = Array.from({ length: bars.length }, (_, index) => (index < 14 ? null : 50 + index))
  const series = buildPaddedIndicatorSeries(bars, values, toTime)

  assert.equal(series.length, bars.length)
  assert.equal(series[0].time, toTime(bars[0].t))
  assert.equal(series[13].time, toTime(bars[13].t))
  assert.equal(series[13].value, series[14].value)
  assert.equal(series.at(-1).value, 50 + bars.length - 1)
})

test('rsi matches Wilder smoothing reference values', () => {
  const closes = [
    44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1,
    45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28,
    46.28, 46, 46.03, 46.41, 46.22, 45.64, 46.21,
  ]
  const actual = rsi(closes, 14)
  const expected = [
    null, null, null, null, null, null, null,
    null, null, null, null, null, null, null,
    70.464135, 66.249619, 66.480942, 69.346853, 66.294713, 57.915021, 62.880718,
  ]

  assert.equal(actual.length, expected.length)
  expected.forEach((value, index) => {
    if (value == null) {
      assert.equal(actual[index], null)
      return
    }
    assert.ok(actual[index] != null, `expected RSI at index ${index}`)
    assert.ok(Math.abs(actual[index] - value) < 0.0005, `RSI mismatch at index ${index}`)
  })
})

test('rsi keeps Wilder smoothing memory after large single-bar move', () => {
  const closes = [
    100, 101, 102, 103, 104, 105, 106, 107, 108, 109,
    110, 111, 112, 113, 114, 95, 96, 97, 98, 99, 100,
  ]
  const values = rsi(closes, 14)
  assert.equal(values[14], 100)
  assert.ok(values[15] < 50, 'single large down bar should reset RSI sharply')
  assert.ok(values[16] > values[15], 'subsequent gains should recover RSI gradually')
  assert.ok(values[16] < 50, 'Wilder smoothing should not snap back immediately')
})
