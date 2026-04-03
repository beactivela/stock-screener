import test from 'node:test'
import assert from 'node:assert/strict'

import {
  validateTradingAgentsRunRequest,
  providerRequiredEnvVar,
  TRADING_AGENTS_PROVIDERS,
  TRADING_AGENTS_ANALYST_IDS,
  resolveAnalystsFromBody,
  normalizeTradingAgentsAnalysts,
} from './validation.js'

test('validateTradingAgentsRunRequest accepts valid input', () => {
  const out = validateTradingAgentsRunRequest({
    ticker: 'nvda',
    asOf: '2026-01-15',
    provider: 'openai',
  })
  assert.equal(out.ok, true)
  if (out.ok) {
    assert.deepEqual(out.value, {
      ticker: 'NVDA',
      asOf: '2026-01-15',
      provider: 'openai',
      analysts: [...TRADING_AGENTS_ANALYST_IDS],
    })
  }
})

test('validateTradingAgentsRunRequest profile fast yields two analysts', () => {
  const out = validateTradingAgentsRunRequest({
    ticker: 'AAPL',
    asOf: '2026-01-15',
    provider: 'openai',
    profile: 'fast',
  })
  assert.equal(out.ok, true)
  if (out.ok) {
    assert.deepEqual(out.value.analysts, ['market', 'fundamentals'])
  }
})

test('validateTradingAgentsRunRequest explicit analysts overrides profile', () => {
  const out = validateTradingAgentsRunRequest({
    ticker: 'AAPL',
    asOf: '2026-01-15',
    provider: 'openai',
    profile: 'fast',
    analysts: ['news'],
  })
  assert.equal(out.ok, true)
  if (out.ok) {
    assert.deepEqual(out.value.analysts, ['news'])
  }
})

test('resolveAnalystsFromBody rejects invalid profile', () => {
  const out = resolveAnalystsFromBody({ profile: 'nope' })
  assert.equal(out.ok, false)
})

test('normalizeTradingAgentsAnalysts dedupes and validates', () => {
  const out = normalizeTradingAgentsAnalysts(['market', 'MARKET', 'news'])
  assert.equal(out.ok, true)
  if (out.ok) {
    assert.deepEqual(out.value, ['market', 'news'])
  }
})


test('validateTradingAgentsRunRequest rejects bad ticker', () => {
  const out = validateTradingAgentsRunRequest({
    ticker: 'NVDA!!!',
    asOf: '2026-01-15',
    provider: 'openai',
  })
  assert.equal(out.ok, false)
})

test('validateTradingAgentsRunRequest rejects unknown provider', () => {
  const out = validateTradingAgentsRunRequest({
    ticker: 'AAPL',
    asOf: '2026-01-15',
    provider: 'foo',
  })
  assert.equal(out.ok, false)
})

test('validateTradingAgentsRunRequest rejects invalid date format', () => {
  const out = validateTradingAgentsRunRequest({
    ticker: 'AAPL',
    asOf: '01-15-2026',
    provider: 'openai',
  })
  assert.equal(out.ok, false)
})

test('providerRequiredEnvVar maps providers', () => {
  assert.equal(providerRequiredEnvVar('openai'), 'OPENAI_API_KEY')
  assert.equal(providerRequiredEnvVar('ollama'), null)
  assert.ok(TRADING_AGENTS_PROVIDERS.includes('anthropic'))
})
