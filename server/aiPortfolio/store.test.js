import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createAiPortfolioStore } from './store.js'

function createLatestRunQueryStub(result) {
  return {
    select() {
      return this
    },
    eq() {
      return this
    },
    order() {
      return this
    },
    limit() {
      return this
    },
    async maybeSingle() {
      return result
    },
  }
}

function createSupabaseStubForLoad(result) {
  return {
    from(tableName) {
      if (tableName !== 'ai_portfolio_runs') throw new Error(`Unexpected table: ${tableName}`)
      return createLatestRunQueryStub(result)
    },
  }
}

describe('aiPortfolio store', () => {
  it('fails closed when Supabase is not configured', async () => {
    const store = createAiPortfolioStore({ supabaseClient: null })
    await assert.rejects(
      () => store.loadState(),
      /AI Portfolio requires Supabase/,
    )
  })

  it('returns initialized state when no completed run exists', async () => {
    const store = createAiPortfolioStore({
      supabaseClient: createSupabaseStubForLoad({ data: null, error: null }),
    })
    const state = await store.loadState()
    assert.ok(state)
    assert.equal(state.lastRunDate, null)
    assert.equal(typeof state.managers, 'object')
  })

  it('throws explicit errors when Supabase load fails', async () => {
    const store = createAiPortfolioStore({
      supabaseClient: createSupabaseStubForLoad({
        data: null,
        error: { message: 'permission denied' },
      }),
    })
    await assert.rejects(
      () => store.loadState(),
      /Failed to load AI Portfolio run state: permission denied/,
    )
  })
})
