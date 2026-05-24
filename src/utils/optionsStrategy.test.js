import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildBullPutSpreadPayoffCurve,
  filterBullPutSpreadSlopeCurve,
  splitPayoffCurveByProfit,
  calculateBullPutSpreadMetrics,
  calculateBearPutSpreadMetrics,
  calculateBearCallSpreadMetrics,
  calculateCashSecuredPutMetrics,
  calculateLongCallMetrics,
  buildLongCallPayoffKnots,
  buildBearPutSpreadSlopedSegmentKnots,
  buildBearCallSpreadSlopedSegmentKnots,
  buildCashSecuredPutPayoffKnots,
  estimateBullPutChanceOfProfit,
  estimateChancePriceBelowAtExpiry,
  estimateChancePriceAboveAtExpiry,
  estimateBearPutChanceOfProfit,
  pickOptionMid,
  xForSymmetricPayoffPnL,
  buildBullPutSpreadSlopedSegmentKnots,
  mapSlopedSpreadScreenX,
  slopedSpreadScreenPointsCollinear,
  buildLossFillPathBelowPolyline,
} from './optionsStrategy.ts'

describe('options strategy helpers', () => {
  it('picks a usable option mid from bid/ask before falling back to last price', () => {
    assert.equal(pickOptionMid({ bid: 7.8, ask: 8.2, lastPrice: 8.5 }), 8)
    assert.equal(pickOptionMid({ bid: 0, ask: 3.1, lastPrice: 2.8 }), 2.8)
    assert.equal(pickOptionMid({ bid: 2.5, ask: 0, lastPrice: 2.75 }), 2.75)
    assert.equal(pickOptionMid({ bid: null, ask: null, lastPrice: null }), null)
  })

  it('uses breakeven = short strike minus per-share net credit (short bid − long ask)', () => {
    const a = calculateBullPutSpreadMetrics({
      shortPut: { strike: 242.5, bid: 2.42, ask: 2.44, lastPrice: null },
      longPut: { strike: 225, bid: 0.11, ask: 0.13, lastPrice: null },
    })
    assert.ok(a != null)
    assert.equal(a.netCredit, 2.29)
    assert.equal(a.breakEven, 240.21)
    assert.equal(a.netCredit * 100, 229)

    const b = calculateBullPutSpreadMetrics({
      shortPut: { strike: 232.5, bid: 1.12, ask: 1.14, lastPrice: null },
      longPut: { strike: 220, bid: 0.1, ask: 0.12, lastPrice: null },
    })
    assert.ok(b != null)
    assert.equal(b.netCredit, 1)
    assert.equal(b.breakEven, 231.5)
    assert.equal(b.netCredit * 100, 100)
  })

  it('matches TradeVision-style bull put breakeven using short bid and long ask', () => {
    const m = calculateBullPutSpreadMetrics({
      shortPut: { strike: 390, bid: 19.35, ask: 20.05, lastPrice: null },
      longPut: { strike: 340, bid: 6.2, ask: 6.74, lastPrice: null },
    })
    assert.ok(m != null)
    assert.equal(m.netCredit, 12.61)
    assert.equal(m.breakEven, 377.39)
    assert.equal(m.maxProfit, 1261)
    assert.equal(m.maxLoss, 3739)
  })

  it('calculates bull put credit spread risk metrics from natural bid/ask fills', () => {
    const metrics = calculateBullPutSpreadMetrics({
      shortPut: { strike: 250, bid: 7.8, ask: 8.2, lastPrice: 8.1 },
      longPut: { strike: 230, bid: 2.8, ask: 3.2, lastPrice: 3.1 },
    })

    assert.deepEqual(metrics, {
      strategy: 'put_credit_spread',
      contractMultiplier: 100,
      shortStrike: 250,
      longStrike: 230,
      shortPremium: 7.8,
      longPremium: 3.2,
      netCredit: 4.6,
      maxProfit: 460,
      maxLoss: 1540,
      estimatedMargin: 1540,
      breakEven: 245.4,
      width: 20,
    })
  })

  it('builds an expiration payoff curve with capped loss and capped profit', () => {
    const curve = buildBullPutSpreadPayoffCurve({
      shortStrike: 250,
      longStrike: 230,
      netCredit: 5,
      pricePoints: [220, 230, 245, 250, 260],
    })

    assert.deepEqual(curve, [
      { price: 220, profitLoss: -1500 },
      { price: 230, profitLoss: -1500 },
      { price: 245, profitLoss: 0 },
      { price: 250, profitLoss: 500 },
      { price: 260, profitLoss: 500 },
    ])
  })

  it('splits the payoff curve into red loss and green profit segments at breakeven', () => {
    const curve = buildBullPutSpreadPayoffCurve({
      shortStrike: 250,
      longStrike: 230,
      netCredit: 5,
      pricePoints: [220, 230, 245, 250, 260],
    })

    assert.deepEqual(splitPayoffCurveByProfit(curve), {
      loss: [
        { price: 220, profitLoss: -1500 },
        { price: 230, profitLoss: -1500 },
        { price: 245, profitLoss: 0 },
      ],
      profit: [
        { price: 245, profitLoss: 0 },
        { price: 250, profitLoss: 500 },
        { price: 260, profitLoss: 500 },
      ],
    })
  })

  it('inserts an interpolated breakeven point when the sampled curve crosses zero between points', () => {
    assert.deepEqual(
      splitPayoffCurveByProfit([
        { price: 240, profitLoss: -500 },
        { price: 250, profitLoss: 500 },
      ]),
      {
        loss: [
          { price: 240, profitLoss: -500 },
          { price: 245, profitLoss: 0 },
        ],
        profit: [
          { price: 245, profitLoss: 0 },
          { price: 250, profitLoss: 500 },
        ],
      },
    )
  })

  it('filters a bull put payoff curve to the single sloping spread segment for price-aligned graphing', () => {
    const curve = buildBullPutSpreadPayoffCurve({
      shortStrike: 250,
      longStrike: 230,
      netCredit: 5,
      pricePoints: [220, 230, 245, 250, 260],
    })

    assert.deepEqual(filterBullPutSpreadSlopeCurve(curve, { longStrike: 230, shortStrike: 250 }), [
      { price: 230, profitLoss: -1500 },
      { price: 245, profitLoss: 0 },
      { price: 250, profitLoss: 500 },
    ])
  })

  it('estimates chance of profit only when IV, DTE, spot, and breakeven are usable', () => {
    const chance = estimateBullPutChanceOfProfit({
      spot: 250,
      breakEven: 245,
      impliedVolatility: 0.24,
      dte: 30,
    })

    assert.ok(chance != null)
    assert.ok(chance > 0.55)
    assert.ok(chance < 0.65)
    assert.equal(
      estimateBullPutChanceOfProfit({
        spot: 250,
        breakEven: 245,
        impliedVolatility: null,
        dte: 30,
      }),
      null,
    )
  })

  it('builds three analytic knots for the bull put sloped payoff segment', () => {
    assert.deepEqual(
      buildBullPutSpreadSlopedSegmentKnots({
        longStrike: 230,
        shortStrike: 250,
        breakEven: 245,
        maxLoss: 1500,
        maxProfit: 500,
      }),
      [
        { price: 230, profitLoss: -1500 },
        { price: 245, profitLoss: 0 },
        { price: 250, profitLoss: 500 },
      ],
    )
  })

  it('maps bull put sloped leg X linearly in strike so 320P–390P stays one straight screen segment', () => {
    const width = 158
    const maxLoss = 5433
    const maxProfit = 1567
    const longStrike = 320
    const shortStrike = 390
    const breakEven = 374.33
    const xAtLong = 0
    const xAtShort = width
    const yAtLong = 400
    const yAtShort = 200
    const yAtBreakEven = yAtLong + ((breakEven - longStrike) / (shortStrike - longStrike)) * (yAtShort - yAtLong)

    const low = { x: xAtLong, y: yAtLong }
    const mid = {
      x: mapSlopedSpreadScreenX(breakEven, longStrike, shortStrike, xAtLong, xAtShort),
      y: yAtBreakEven,
    }
    const high = { x: xAtShort, y: yAtShort }

    assert.ok(slopedSpreadScreenPointsCollinear(low, mid, high))
    assert.ok(mid.x > width / 2, 'breakeven X sits past center when BE is above strike midpoint')
  })

  it('calculates long call metrics and payoff knots (diagram-capped max profit)', () => {
    const m = calculateLongCallMetrics({
      call: { strike: 250, bid: 4.9, ask: 5.1, lastPrice: null },
      priceMin: 200,
      priceMax: 300,
    })
    assert.ok(m != null)
    assert.equal(m.strategy, 'long_call')
    assert.equal(m.strike, 250)
    assert.equal(m.premium, 5.1)
    assert.equal(m.maxLoss, 510)
    assert.equal(m.breakEven, 255.1)
    assert.ok(m.maxProfitAtCap > 0)
    const knots = buildLongCallPayoffKnots(m)
    assert.ok(knots.length >= 3)
    assert.equal(knots.find((p) => p.price === m.strike)?.profitLoss, -510)
    assert.equal(knots.find((p) => p.price === m.breakEven)?.profitLoss, 0)
  })

  it('maps payoff P&L to equal-width loss (left) and profit (right) halves', () => {
    const width = 200
    const half = width / 2
    const maxLoss = 1998
    const maxProfit = 2
    const map = (pl) => xForSymmetricPayoffPnL(pl, { maxLoss, maxProfit, width })

    assert.equal(map(0), half)
    assert.equal(map(-maxLoss), 0)
    assert.equal(map(maxProfit), width)
    assert.ok(map(-maxLoss / 2) > 0 && map(-maxLoss / 2) < half)
    assert.ok(map(maxProfit / 2) > half && map(maxProfit / 2) < width)
  })

  it('calculates bear put spread metrics (debit, long > short, breakeven = long − debit)', () => {
    const m = calculateBearPutSpreadMetrics({
      shortPut: { strike: 230, bid: 1.5, ask: 1.7, lastPrice: null },
      longPut: { strike: 250, bid: 4.5, ask: 4.7, lastPrice: null },
    })
    assert.ok(m != null)
    assert.equal(m.strategy, 'bear_put_spread')
    assert.equal(m.shortStrike, 230)
    assert.equal(m.longStrike, 250)
    assert.equal(m.netDebit, 3.2)
    assert.equal(m.width, 20)
    assert.equal(m.maxLoss, 320)
    assert.equal(m.maxProfit, 1680)
    assert.equal(m.breakEven, 246.8)
  })

  it('calculates bear call spread metrics (credit, breakeven = short + credit)', () => {
    const m = calculateBearCallSpreadMetrics({
      shortCall: { strike: 240, bid: 5, ask: 5.2, lastPrice: null },
      longCall: { strike: 260, bid: 2.8, ask: 3, lastPrice: null },
    })
    assert.ok(m != null)
    assert.equal(m.strategy, 'bear_call_spread')
    assert.equal(m.netCredit, 2)
    assert.equal(m.maxProfit, 200)
    assert.equal(m.maxLoss, 1800)
    assert.equal(m.breakEven, 242)
  })

  it('calculates cash secured put metrics and payoff knots', () => {
    const m = calculateCashSecuredPutMetrics({
      shortPut: { strike: 200, bid: 3.4, ask: 3.6, lastPrice: null },
      priceMin: 160,
      priceMax: 240,
    })
    assert.ok(m != null)
    assert.equal(m.strategy, 'cash_secured_put')
    assert.equal(m.premium, 3.4)
    assert.equal(m.breakEven, 196.6)
    assert.equal(m.maxProfit, 340)
    assert.ok(m.maxLossAtLow < 0)
    const knots = buildCashSecuredPutPayoffKnots(m)
    assert.equal(knots.find((p) => p.price === m.breakEven)?.profitLoss, 0)
    assert.equal(knots.find((p) => p.price === m.strike)?.profitLoss, m.maxProfit)
  })

  it('builds bear put and bear call sloped segment knots in strike order', () => {
    assert.deepEqual(
      buildBearPutSpreadSlopedSegmentKnots({
        shortStrike: 230,
        longStrike: 250,
        breakEven: 247,
        maxLoss: 300,
        maxProfit: 1700,
      }),
      [
        { price: 230, profitLoss: 1700 },
        { price: 247, profitLoss: 0 },
        { price: 250, profitLoss: -300 },
      ],
    )
    assert.deepEqual(
      buildBearCallSpreadSlopedSegmentKnots({
        shortStrike: 240,
        longStrike: 260,
        breakEven: 242.2,
        maxLoss: 1780,
        maxProfit: 220,
      }),
      [
        { price: 240, profitLoss: 220 },
        { price: 242.2, profitLoss: 0 },
        { price: 260, profitLoss: -1780 },
      ],
    )
  })

  it('estimateChancePriceBelowAtExpiry complements above at same threshold', () => {
    const args = { spot: 100, threshold: 105, impliedVolatility: 0.3, dte: 45 }
    const below = estimateChancePriceBelowAtExpiry(args)
    const above = estimateChancePriceAboveAtExpiry(args)
    assert.ok(below != null && above != null)
    assert.ok(Math.abs(below + above - 1) < 1e-6)
    const bearPut = estimateBearPutChanceOfProfit({
      spot: 100,
      breakEven: 105,
      impliedVolatility: 0.3,
      dte: 45,
    })
    assert.equal(bearPut, below)
  })

  it('buildLossFillPathBelowPolyline fills only below the loss polyline, not a full-width breakeven rectangle', () => {
    const path = buildLossFillPathBelowPolyline(
      [
        { x: 20, y: 100 },
        { x: 80, y: 200 },
      ],
      400,
    )
    assert.ok(path)
    assert.match(path, /^M 20\.00 100\.00/)
    assert.doesNotMatch(path, /M 0\.00 400\.00/)
    assert.match(path, /L 80\.00 200\.00 L 80\.00 400\.00 L 20\.00 400\.00 Z$/)
  })
})
