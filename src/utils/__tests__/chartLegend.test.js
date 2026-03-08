import test from 'node:test'
import assert from 'node:assert/strict'
import { buildLegendSnapshot } from '../chartLegend.js'

test('buildLegendSnapshot returns values for matching time', () => {
  const barsByTime = new Map([
    [100, { o: 10, h: 12, l: 9, c: 11, v: 5000 }],
  ])
  const ma10ByTime = new Map([[100, 10.5]])
  const ma20ByTime = new Map()
  const ma50ByTime = new Map([[100, 9.9]])
  const volumeMaByTime = new Map([[100, 4200]])

  const snapshot = buildLegendSnapshot({
    time: 100,
    barsByTime,
    ma10ByTime,
    ma20ByTime,
    ma50ByTime,
    volumeMaByTime,
  })

  assert.deepEqual(snapshot, {
    time: 100,
    open: 10,
    high: 12,
    low: 9,
    close: 11,
    volume: 5000,
    ma10: 10.5,
    ma20: null,
    ma50: 9.9,
    volumeMa: 4200,
  })
})

test('buildLegendSnapshot returns null when bar is missing', () => {
  const snapshot = buildLegendSnapshot({
    time: 200,
    barsByTime: new Map(),
    ma10ByTime: new Map(),
    ma20ByTime: new Map(),
    ma50ByTime: new Map(),
    volumeMaByTime: new Map(),
  })

  assert.equal(snapshot, null)
})
