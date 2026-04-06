import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildPortfolioSnapshot,
  evaluateEntryRules,
  sumReservedCashUsd,
} from './riskRules.js'

describe('aiPortfolio risk rules', () => {
  it('allows a stock entry inside all hard limits', () => {
    const portfolio = buildPortfolioSnapshot({
      equityUsd: 50000,
      cashUsd: 50000,
      positions: [],
    })

    const result = evaluateEntryRules({
      portfolio,
      candidate: {
        ticker: 'AAPL',
        underlying: 'AAPL',
        exposureUsd: 4500,
        cashRequiredUsd: 4500,
        maxLossUsd: 900,
        instrumentType: 'stock',
        strategy: 'stock',
        isUsMarket: true,
        isLongOnly: true,
      },
    })

    assert.equal(result.ok, true)
    assert.equal(result.violations.length, 0)
  })

  it('rejects entries above 10% concentration limit', () => {
    const portfolio = buildPortfolioSnapshot({
      equityUsd: 50000,
      cashUsd: 45000,
      positions: [{ underlying: 'AAPL', exposureUsd: 3000 }],
    })

    const result = evaluateEntryRules({
      portfolio,
      candidate: {
        ticker: 'AAPL',
        underlying: 'AAPL',
        exposureUsd: 3000,
        cashRequiredUsd: 3000,
        maxLossUsd: 300,
        instrumentType: 'stock',
        strategy: 'stock',
        isUsMarket: true,
        isLongOnly: true,
      },
    })

    assert.equal(result.ok, false)
    assert.ok(result.violations.some((v) => v.code === 'MAX_CONCENTRATION_10'))
  })

  it('rejects entries above 2% max risk per trade', () => {
    const portfolio = buildPortfolioSnapshot({
      equityUsd: 50000,
      cashUsd: 50000,
      positions: [],
    })

    const result = evaluateEntryRules({
      portfolio,
      candidate: {
        ticker: 'MSFT',
        underlying: 'MSFT',
        exposureUsd: 4000,
        cashRequiredUsd: 4000,
        maxLossUsd: 1500,
        instrumentType: 'stock',
        strategy: 'stock',
        isUsMarket: true,
        isLongOnly: true,
      },
    })

    assert.equal(result.ok, false)
    assert.ok(result.violations.some((v) => v.code === 'MAX_RISK_2'))
  })

  it('rejects entries that breach 80% max deployed cap', () => {
    const portfolio = buildPortfolioSnapshot({
      equityUsd: 50000,
      cashUsd: 15000,
      positions: [{ underlying: 'NVDA', exposureUsd: 35000 }],
    })

    const result = evaluateEntryRules({
      portfolio,
      candidate: {
        ticker: 'AMD',
        underlying: 'AMD',
        exposureUsd: 6000,
        cashRequiredUsd: 6000,
        maxLossUsd: 900,
        instrumentType: 'stock',
        strategy: 'stock',
        isUsMarket: true,
        isLongOnly: true,
      },
    })

    assert.equal(result.ok, false)
    assert.ok(result.violations.some((v) => v.code === 'MAX_DEPLOYED_80'))
  })

  it('rejects entries that breach 20% minimum cash reserve', () => {
    const portfolio = buildPortfolioSnapshot({
      equityUsd: 50000,
      cashUsd: 13000,
      positions: [{ underlying: 'TSLA', exposureUsd: 34000, reservedUsd: 2000 }],
    })

    const result = evaluateEntryRules({
      portfolio,
      candidate: {
        ticker: 'META',
        underlying: 'META',
        exposureUsd: 2500,
        cashRequiredUsd: 2500,
        maxLossUsd: 250,
        instrumentType: 'stock',
        strategy: 'stock',
        isUsMarket: true,
        isLongOnly: true,
      },
    })

    assert.equal(result.ok, false)
    assert.ok(result.violations.some((v) => v.code === 'MIN_CASH_20'))
  })

  it('sums reserved collateral from option positions', () => {
    const reserved = sumReservedCashUsd([
      { strategy: 'cash_secured_put', reservedUsd: 4500 },
      { strategy: 'bull_put_spread', reservedUsd: 1200 },
      { strategy: 'stock', reservedUsd: 0 },
    ])
    assert.equal(reserved, 5700)
  })
})

