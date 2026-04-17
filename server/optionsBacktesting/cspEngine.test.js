import assert from 'node:assert/strict'
import test from 'node:test'

import { runCashSecuredPutBacktest } from './cspEngine.js'
import { deriveIvSurfaceProxy } from './volatility.js'

function buildWeekdayBars({ startDate, count }) {
  const bars = []
  const cursor = new Date(`${startDate}T12:00:00Z`)
  let index = 0
  while (bars.length < count) {
    const day = cursor.getUTCDay()
    if (day !== 0 && day !== 6) {
      bars.push({
        t: cursor.getTime(),
        o: 100 + index * 0.35,
        h: 101 + index * 0.35,
        l: 99 + index * 0.35,
        c: 100 + index * 0.35 + Math.sin(index / 7),
        v: 1000000,
      })
      index += 1
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return bars
}

test('runCashSecuredPutBacktest produces ranked setups and trades', async () => {
  const bars = buildWeekdayBars({ startDate: '2020-01-01', count: 260 })

  const result = await runCashSecuredPutBacktest(
    {
      ticker: 'TEST',
      deltaTargets: [0.1, 0.2],
      dteTargets: [90],
      profitTargetPct: 50,
      closeDte: 21,
      startDate: '2020-03-01',
      endDate: '2020-09-01',
    },
    {
      getBars: async () => bars,
    },
  )

  assert.equal(result.setups.length, 2)
  assert.ok(result.setups[0].metrics.tradeCount >= 1)
  assert.ok(Number.isFinite(result.setups[0].metrics.cagrPct))
  assert.ok(Number.isFinite(result.setups[0].metrics.avgTradeAnnualizedRoyPct))
  assert.equal(result.assumptions.maxConcurrentPositions, 10)
  const firstTrade = result.setups[0].trades[0]
  assert.ok(firstTrade.premiumOpenMid >= firstTrade.premiumOpen)
  assert.ok(firstTrade.premiumCloseMid <= firstTrade.premiumClose)
  assert.match(result.assumptions.stopLossRule, /2x/i)
  assert.match(result.assumptions.marginReferenceExample, /\$1,250/)
  assert.match(result.assumptions.entryCadence, /Monday/i)

  const setup = result.setups[0]
  const entryDates = setup.trades.map((trade) => trade.entryDate)
  assert.ok(entryDates.length >= 2)
  entryDates.forEach((entryDate) => {
    assert.equal(new Date(`${entryDate}T12:00:00Z`).getUTCDay(), 1)
  })
  const hasOverlap = setup.trades.some((trade, index) =>
    setup.trades.slice(index + 1).some((otherTrade) => otherTrade.entryDate < trade.exitDate)
  )
  assert.ok(hasOverlap)
  const stopLossTrades = setup.trades.filter((trade) => trade.exitReason.includes('stop_loss_'))
  stopLossTrades.forEach((trade) => {
    assert.ok(trade.pnlUsd >= -(trade.premiumOpen * 200) - 0.01)
  })
})

test('deriveIvSurfaceProxy adds a transient premium around the August 2024 stress window', () => {
  function makeBars(startDate, closes) {
    const bars = []
    const d = new Date(`${startDate}T12:00:00Z`)
    for (const close of closes) {
      bars.push({ t: d.getTime(), c: close })
      d.setUTCDate(d.getUTCDate() + 1)
    }
    return bars
  }

  const calm = makeBars('2024-06-01', Array.from({ length: 70 }, (_, i) => 420 + Math.sin(i / 6) * 3))
  const stressed = makeBars(
    '2024-06-01',
    Array.from({ length: 62 }, (_, i) => 420 + Math.sin(i / 6) * 3).concat([405, 392, 380, 395, 410, 422, 430, 438]),
  )

  const calmIv = deriveIvSurfaceProxy({ recentBars: calm, targetDelta: 0.15, entryDte: 365, spot: 430, strike: 390 })
  const stressedIv = deriveIvSurfaceProxy({
    recentBars: stressed,
    targetDelta: 0.15,
    entryDte: 365,
    spot: 438,
    strike: 395,
  })

  assert.ok(stressedIv > calmIv + 0.1)
})
