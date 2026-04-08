import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  createInitialAiPortfolioState,
  runAiPortfolioDailyCycle,
} from './simulationEngine.js'

describe('aiPortfolio simulation engine', () => {
  it('opens a valid stock position and keeps 20% cash reserve', async () => {
    const initial = createInitialAiPortfolioState({ asOfDate: '2026-04-06' })

    const result = await runAiPortfolioDailyCycle({
      state: initial,
      asOfDate: '2026-04-07',
      suggestEntry: async ({ managerId }) => {
        if (managerId !== 'claude') return { action: 'no_trade' }
        return {
          action: 'enter',
          instrumentType: 'stock',
          strategy: 'stock',
          ticker: 'AAPL',
          stopLossPct: 0.08,
        }
      },
      getStockMark: async (ticker) => {
        if (ticker === 'SPY') return { ok: true, mark: 510, asOf: '2026-04-07T20:00:00Z' }
        return { ok: true, mark: 100, asOf: '2026-04-07T20:00:00Z' }
      },
      getOptionMark: async () => ({ ok: false, error: 'not-needed' }),
    })

    const claude = result.state.managers.claude
    assert.equal(claude.positions.length, 1)
    assert.equal(claude.positions[0].ticker, 'AAPL')
    assert.ok(claude.positions[0].exposureUsd <= 5000)
    assert.ok(claude.availableCashUsd >= claude.equityUsd * 0.2)
  })

  it('rejects a trade when requested quantity breaks risk rules', async () => {
    const initial = createInitialAiPortfolioState({ asOfDate: '2026-04-06' })

    const result = await runAiPortfolioDailyCycle({
      state: initial,
      asOfDate: '2026-04-07',
      suggestEntry: async ({ managerId }) => {
        if (managerId !== 'gpt') return { action: 'no_trade' }
        return {
          action: 'enter',
          instrumentType: 'stock',
          strategy: 'stock',
          ticker: 'NVDA',
          stopLossPct: 0.15,
          quantity: 200,
        }
      },
      getStockMark: async (ticker) => {
        if (ticker === 'SPY') return { ok: true, mark: 510, asOf: '2026-04-07T20:00:00Z' }
        return { ok: true, mark: 120, asOf: '2026-04-07T20:00:00Z' }
      },
      getOptionMark: async () => ({ ok: false, error: 'not-needed' }),
    })

    const gpt = result.state.managers.gpt
    assert.equal(gpt.positions.length, 0)
    assert.equal(gpt.rejectedTrades.length, 1)
    assert.ok(gpt.rejectedTrades[0].violations.length >= 1)
  })

  it('closes a stock position when the model returns action exit', async () => {
    const initial = createInitialAiPortfolioState({ asOfDate: '2026-04-06' })

    const afterBuy = await runAiPortfolioDailyCycle({
      state: initial,
      asOfDate: '2026-04-07',
      suggestEntry: async ({ managerId }) => {
        if (managerId !== 'claude') return { action: 'no_trade' }
        return {
          action: 'enter',
          instrumentType: 'stock',
          strategy: 'stock',
          ticker: 'AAPL',
          stopLossPct: 0.08,
        }
      },
      getStockMark: async (ticker) => {
        if (ticker === 'SPY') return { ok: true, mark: 510, asOf: '2026-04-07T20:00:00Z' }
        return { ok: true, mark: 100, asOf: '2026-04-07T20:00:00Z' }
      },
      getOptionMark: async () => ({ ok: false, error: 'not-needed' }),
    })

    assert.equal(afterBuy.state.managers.claude.positions.length, 1)

    const afterExit = await runAiPortfolioDailyCycle({
      state: afterBuy.state,
      asOfDate: '2026-04-08',
      suggestEntry: async ({ managerId }) => {
        if (managerId !== 'claude') return { action: 'no_trade' }
        return { action: 'exit', exitTicker: 'AAPL', reason: 'book_review' }
      },
      getStockMark: async (ticker) => {
        if (ticker === 'SPY') return { ok: true, mark: 512, asOf: '2026-04-08T20:00:00Z' }
        return { ok: true, mark: 105, asOf: '2026-04-08T20:00:00Z' }
      },
      getOptionMark: async () => ({ ok: false, error: 'not-needed' }),
    })

    const claude = afterExit.state.managers.claude
    assert.equal(claude.positions.length, 0)
    assert.equal(claude.recentTrades[0]?.status, 'closed')
    assert.ok(Number(claude.realizedPnlUsd) !== 0 || Number(claude.cashUsd) > 0)
  })

  it('records a rejected exit when ticker is not in the book', async () => {
    const initial = createInitialAiPortfolioState({ asOfDate: '2026-04-06' })

    const result = await runAiPortfolioDailyCycle({
      state: initial,
      asOfDate: '2026-04-07',
      suggestEntry: async ({ managerId }) => {
        if (managerId !== 'claude') return { action: 'no_trade' }
        return { action: 'exit', exitTicker: 'ZZZZ', reason: 'test' }
      },
      getStockMark: async (ticker) => {
        if (ticker === 'SPY') return { ok: true, mark: 510, asOf: '2026-04-07T20:00:00Z' }
        return { ok: true, mark: 1, asOf: '2026-04-07T20:00:00Z' }
      },
      getOptionMark: async () => ({ ok: false, error: 'not-needed' }),
    })

    const insight = result.state.managers.claude.lastLlmInsight
    assert.ok(String(insight?.executionNote || '').includes('no matching'))
    assert.equal(result.state.managers.claude.positions.length, 0)
  })
})

