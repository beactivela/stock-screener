import test from 'node:test'
import assert from 'node:assert/strict'
import { buildVolumeSeries } from '../volumeSeries.js'

test('buildVolumeSeries returns volume bars and 20-day MA', () => {
  const bars = [
    { t: 1_000, o: 10, c: 12, v: 10 },
    { t: 2_000, o: 12, c: 11, v: 30 },
    { t: 3_000, o: 11, c: 15, v: 50 },
  ]

  const { volumeData, volumeMaData } = buildVolumeSeries(bars, 2)

  assert.equal(volumeData.length, 3)
  assert.deepEqual(volumeData[0], { time: 1, value: 10, color: '#22c55e' })
  assert.deepEqual(volumeData[1], { time: 2, value: 30, color: '#ef4444' })
  assert.deepEqual(volumeData[2], { time: 3, value: 50, color: '#22c55e' })

  assert.deepEqual(volumeMaData, [
    { time: 2, value: 20 },
    { time: 3, value: 40 },
  ])
})
