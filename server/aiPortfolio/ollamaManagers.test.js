import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import {
  getManagerModelMap,
  resolveAiPortfolioLlmProvider,
  sanitizeAiPortfolioSuggestion,
} from './ollamaManagers.js'

describe('AI portfolio LLM (OpenRouter router)', () => {
  const saved = {}

  beforeEach(() => {
    for (const key of [
      'AI_PORTFOLIO_LLM_PROVIDER',
      'AI_PORTFOLIO_MODEL_CLAUDE',
      'AI_PORTFOLIO_MODEL_GPT',
      'AI_PORTFOLIO_MODEL_GEMINI',
      'AI_PORTFOLIO_MODEL_DEEPSEEK',
    ]) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const [key, val] of Object.entries(saved)) {
      if (val === undefined) delete process.env[key]
      else process.env[key] = val
    }
  })

  it('resolveAiPortfolioLlmProvider defaults to openrouter', () => {
    assert.equal(resolveAiPortfolioLlmProvider(), 'openrouter')
  })

  it('resolveAiPortfolioLlmProvider respects AI_PORTFOLIO_LLM_PROVIDER', () => {
    process.env.AI_PORTFOLIO_LLM_PROVIDER = 'ollama'
    assert.equal(resolveAiPortfolioLlmProvider(), 'ollama')
    process.env.AI_PORTFOLIO_LLM_PROVIDER = 'OPENROUTER'
    assert.equal(resolveAiPortfolioLlmProvider(), 'openrouter')
  })

  it('getManagerModelMap uses OpenRouter-style defaults when env unset', () => {
    const map = getManagerModelMap()
    assert.equal(map.claude.includes('anthropic/'), true)
    assert.equal(map.gpt.includes('openai/'), true)
    assert.equal(map.gemini.includes('google/'), true)
    assert.equal(map.deepseek.includes('deepseek/'), true)
  })

  it('getManagerModelMap applies per-manager env overrides', () => {
    process.env.AI_PORTFOLIO_MODEL_CLAUDE = 'anthropic/claude-3-haiku'
    process.env.AI_PORTFOLIO_MODEL_GPT = 'openai/gpt-4o-mini'
    const map = getManagerModelMap()
    assert.equal(map.claude, 'anthropic/claude-3-haiku')
    assert.equal(map.gpt, 'openai/gpt-4o-mini')
  })

  it('sanitizeAiPortfolioSuggestion parses exit with exitTicker', () => {
    const s = sanitizeAiPortfolioSuggestion({
      action: 'exit',
      exitTicker: 'msft',
      reason: 'trim',
    })
    assert.equal(s.action, 'exit')
    assert.equal(s.exitTicker, 'MSFT')
  })

  it('sanitizeAiPortfolioSuggestion rejects exit without target', () => {
    const s = sanitizeAiPortfolioSuggestion({ action: 'exit', reason: 'x' })
    assert.equal(s.action, 'no_trade')
    assert.equal(s.reason, 'exit_missing_target')
  })
})
