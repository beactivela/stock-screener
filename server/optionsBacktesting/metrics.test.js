import assert from 'node:assert/strict'
import test from 'node:test'

import { computeCagrPct, computeMaxDrawdownPct, computeSetupMetrics, computeSharpeFromEquityCurve } from './metrics.js'

test('computeMaxDrawdownPct derives drawdown from equity curve', () => {
  const value = computeMaxDrawdownPct([
    { equity: 100000 },
    { equity: 110000 },
    { equity: 90000 },
    { equity: 95000 },
  ])
  assert.equal(value, 18.18)
})

test('computeSharpeFromEquityCurve returns positive sharpe on rising equity curve', () => {
  const sharpe = computeSharpeFromEquityCurve([
    { equity: 100000 },
    { equity: 101000 },
    { equity: 103000 },
    { equity: 104000 },
    { equity: 106500 },
  ])
  assert.ok(sharpe > 0)
})

test('computeSetupMetrics returns expected summary fields', () => {
  const metrics = computeSetupMetrics({
    trades: [
      { pnlUsd: 1000, daysHeld: 30, annualizedRoyPct: 12 },
      { pnlUsd: -200, daysHeld: 20, annualizedRoyPct: -2 },
    ],
    equityCurve: [
      { equity: 100000 },
      { equity: 100500 },
      { equity: 100800 },
      { equity: 100700 },
    ],
    initialCapital: 100000,
  })
  assert.equal(metrics.totalProfitUsd, 800)
  assert.equal(metrics.tradeCount, 2)
  assert.equal(metrics.winRatePct, 50)
  assert.equal(metrics.avgTradeAnnualizedRoyPct, 5)
  assert.ok(Number.isFinite(metrics.cagrPct))
  assert.equal(metrics.sharpeDailyRf0, metrics.sharpe)
})

test('computeCagrPct annualizes account growth across the equity curve window', () => {
  const cagr = computeCagrPct([
    { time: '2024-01-01', equity: 100000 },
    { time: '2025-01-01', equity: 110000 },
  ])
  assert.ok(cagr > 9.9 && cagr < 10.1)
})
