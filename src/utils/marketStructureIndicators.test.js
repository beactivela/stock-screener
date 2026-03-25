import assert from 'node:assert/strict'
import test from 'node:test'

import { ema } from './chartIndicators.ts'
import {
  alignBarsByTimestamp,
  alignThreeBarCloses,
  classifyStanceFromPriceVsMa,
  formatStructureSubtitle,
} from './marketStructureIndicators.ts'

test('ema matches seeded SMA warmup then recursive step', () => {
  const closes = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110]
  const e = ema(closes, 3)
  assert.equal(e[0], null)
  assert.equal(e[1], null)
  const seed = (100 + 101 + 102) / 3
  assert.ok(Math.abs(e[2] - seed) < 1e-9)
  const k = 2 / 4
  const next = closes[3] * k + seed * (1 - k)
  assert.ok(Math.abs(e[3] - next) < 1e-9)
})

test('alignBarsByTimestamp keeps only matching session times', () => {
  const a = [
    { t: 1, c: 10 },
    { t: 2, c: 11 },
    { t: 3, c: 12 },
  ]
  const b = [
    { t: 2, c: 20 },
    { t: 3, c: 21 },
    { t: 4, c: 22 },
  ]
  const out = alignBarsByTimestamp(a, b)
  assert.deepEqual(out, [
    { t: 2, c1: 11, c2: 20 },
    { t: 3, c1: 12, c2: 21 },
  ])
})

test('classifyStanceFromPriceVsMa: below MA is protect', () => {
  const recent = [100, 101, 102, 103, 104, 105]
  assert.equal(classifyStanceFromPriceVsMa(99, 100, recent), 'protect')
})

test('classifyStanceFromPriceVsMa: above MA and rising MA is grow', () => {
  const recent = [100, 101, 102, 103, 104, 110]
  assert.equal(classifyStanceFromPriceVsMa(115, 105, recent), 'grow')
})

test('classifyStanceFromPriceVsMa: above MA but flat MA is neutral', () => {
  const recent = [100, 100, 100, 100, 100, 100]
  assert.equal(classifyStanceFromPriceVsMa(105, 100, recent), 'neutral')
})

test('formatStructureSubtitle includes short date and stance hint', () => {
  const ts = Date.UTC(2026, 2, 6, 16, 0, 0)
  const s = formatStructureSubtitle(ts, 'protect')
  assert.match(s, /3\/6\/26/)
  assert.match(s, /DOWN/)
})

test('alignThreeBarCloses requires timestamps present in all three', () => {
  const g = [
    { t: 1, c: 1 },
    { t: 2, c: 2 },
  ]
  const q = [{ t: 2, c: 20 }]
  const s = [{ t: 2, c: 200 }]
  const out = alignThreeBarCloses(g, q, s)
  assert.deepEqual(out.times, [2])
  assert.deepEqual(out.gspc, [2])
  assert.deepEqual(out.qqq, [20])
  assert.deepEqual(out.spy, [200])
})
