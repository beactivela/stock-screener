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
} from './optionsStrategy.ts'

describe('options strategy helpers', () => {
  it('picks a usable option mid from bid/ask before falling back to last price', () => {
    assert.equal(pickOptionMid({ bid: 7.8, ask: 8.2, lastPrice: 8.5 }), 8)
    assert.equal(pickOptionMid({ bid: 0, ask: 3.1, lastPrice: 2.8 }), 2.8)
    assert.equal(pickOptionMid({ bid: 2.5, ask: 0, lastPrice: 2.75 }), 2.75)
    assert.equal(pickOptionMid({ bid: null, ask: null, lastPrice: null }), null)
  })

  it('uses breakeven = short strike minus per-share net credit (matches contract credit / 100)', () => {
    const a = calculateBullPutSpreadMetrics({
      shortPut: { strike: 242.5, bid: 2.42, ask: 2.44, lastPrice: null },
      longPut: { strike: 225, bid: 0.11, ask: 0.13, lastPrice: null },
    })
    assert.ok(a != null)
    assert.equal(a.netCredit, 2.31)
    assert.equal(a.breakEven, 240.19)
    assert.equal(a.netCredit * 100, 231)

    const b = calculateBullPutSpreadMetrics({
      shortPut: { strike: 232.5, bid: 1.12, ask: 1.14, lastPrice: null },
      longPut: { strike: 220, bid: 0.1, ask: 0.12, lastPrice: null },
    })
    assert.ok(b != null)
    assert.equal(b.netCredit, 1.02)
    assert.equal(b.breakEven, 231.48)
    assert.equal(b.netCredit * 100, 102)
  })

  it('calculates bull put credit spread risk metrics from live put mids', () => {
    const metrics = calculateBullPutSpreadMetrics({
      shortPut: { strike: 250, bid: 7.8, ask: 8.2, lastPrice: 8.1 },
      longPut: { strike: 230, bid: 2.8, ask: 3.2, lastPrice: 3.1 },
    })

    assert.deepEqual(metrics, {
      strategy: 'put_credit_spread',
      contractMultiplier: 100,
      shortStrike: 250,
      longStrike: 230,
      shortPremium: 8,
      longPremium: 3,
      netCredit: 5,
      maxProfit: 500,
      maxLoss: 1500,
      estimatedMargin: 1500,
      breakEven: 245,
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

  it('calculates long call metrics and payoff knots (diagram-capped max profit)', () => {
    const m = calculateLongCallMetrics({
      call: { strike: 250, bid: 4.9, ask: 5.1, lastPrice: null },
      priceMin: 200,
      priceMax: 300,
    })
    assert.ok(m != null)
    assert.equal(m.strategy, 'long_call')
    assert.equal(m.strike, 250)
    assert.equal(m.premium, 5)
    assert.equal(m.maxLoss, 500)
    assert.equal(m.breakEven, 255)
    assert.ok(m.maxProfitAtCap > 0)
    const knots = buildLongCallPayoffKnots(m)
    assert.ok(knots.length >= 3)
    assert.equal(knots.find((p) => p.price === m.strike)?.profitLoss, -500)
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
    assert.equal(m.netDebit, 3)
    assert.equal(m.width, 20)
    assert.equal(m.maxLoss, 300)
    assert.equal(m.maxProfit, 1700)
    assert.equal(m.breakEven, 247)
  })

  it('calculates bear call spread metrics (credit, breakeven = short + credit)', () => {
    const m = calculateBearCallSpreadMetrics({
      shortCall: { strike: 240, bid: 5, ask: 5.2, lastPrice: null },
      longCall: { strike: 260, bid: 2.8, ask: 3, lastPrice: null },
    })
    assert.ok(m != null)
    assert.equal(m.strategy, 'bear_call_spread')
    assert.equal(m.netCredit, 2.2)
    assert.equal(m.maxProfit, 220)
    assert.equal(m.maxLoss, 1780)
    assert.equal(m.breakEven, 242.2)
  })

  it('calculates cash secured put metrics and payoff knots', () => {
    const m = calculateCashSecuredPutMetrics({
      shortPut: { strike: 200, bid: 3.4, ask: 3.6, lastPrice: null },
      priceMin: 160,
      priceMax: 240,
    })
    assert.ok(m != null)
    assert.equal(m.strategy, 'cash_secured_put')
    assert.equal(m.premium, 3.5)
    assert.equal(m.breakEven, 196.5)
    assert.equal(m.maxProfit, 350)
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
})
