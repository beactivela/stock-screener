/**
 * @import { extractJsonArrayAfter } from './extractJsonArray.js'
 * @import { parsePoliticianPageEmbedded } from './parsePoliticianHtml.js'
 * @import { parseGraphDataStrategy } from './parseStrategyGraphHtml.js'
 * @import { horizonReturnsFromGraph } from './computeHorizonReturns.js'
 * @import { filterTradesLastDays } from './tradeRows.js'
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { extractJsonArrayAfter } from './extractJsonArray.js'
import { parsePoliticianPageEmbedded } from './parsePoliticianHtml.js'
import { parseGraphDataStrategy } from './parseStrategyGraphHtml.js'
import { horizonReturnsFromGraph } from './computeHorizonReturns.js'
import { filterTradesLastDays } from './tradeRows.js'

test('extractJsonArrayAfter parses embedded tradeData', () => {
  const html = `
    let bioguideID = "P000197";
    let tradeData = [["AB", "Purchase", "2026-01-23T00:00:00", "2026-01-16T00:00:00"]];
    let x = 1;
  `
  const arr = extractJsonArrayAfter(html, 'let tradeData = ')
  assert.deepEqual(arr, [['AB', 'Purchase', '2026-01-23T00:00:00', '2026-01-16T00:00:00']])
})

test('parsePoliticianPageEmbedded reads bioguide and tradeData', () => {
  const html = `
    let bioguideID = "C001098";
    let directOrderName = "Ted Cruz";
    let tradeData = [["NVDA", "Sale", "2025-01-01T00:00:00", "2024-12-01T00:00:00"]];
  `
  const p = parsePoliticianPageEmbedded(html)
  assert.equal(p?.bioguideId, 'C001098')
  assert.equal(p?.directOrderName, 'Ted Cruz')
  assert.equal(p?.tradeRows.length, 1)
})

test('parseGraphDataStrategy reads cumulative series', () => {
  const html = `
    graphDataStrategy = [
      {"date":"2020-01-01","close":100000000.0},
      {"date":"2021-01-01","close":110000000.0}
    ];
    graphDataSPY = [];
  `
  const g = parseGraphDataStrategy(html)
  assert.equal(g?.length, 2)
  assert.equal(g?.[1].close, 110000000)
})

test('horizonReturnsFromGraph computes simple window return', () => {
  const points = [
    { date: '2019-01-01', close: 100_000_000 },
    { date: '2020-01-01', close: 110_000_000 },
    { date: '2021-01-01', close: 121_000_000 },
  ]
  const asOf = new Date('2021-01-01T12:00:00Z')
  const h = horizonReturnsFromGraph(points, asOf, [1])
  assert.ok(h.perf_1y_pct != null)
  assert.ok(Math.abs(/** @type {number} */ (h.perf_1y_pct) - 10) < 0.01)
})

test('filterTradesLastDays keeps rows in window', () => {
  const asOf = new Date('2026-04-04T00:00:00Z')
  const rows = [
    ['A', 'Buy', '2026-04-01', '2026-03-20', 'x'],
    ['B', 'Sell', '2025-01-01', '2025-01-01', 'y'],
  ]
  const f = filterTradesLastDays(rows, 90, asOf)
  assert.equal(f.length, 1)
  assert.equal(f[0].symbol, 'A')
})
