/**
 * LLM adapter tests (config + validation only, no network calls)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  resolveDialogueConfig,
  resolveExpertsInsightsConfig,
  normalizeProvider,
  DEFAULT_EXPERTS_OPENROUTER_MODEL,
} from './index.js';

const INSIGHTS_ENV_KEYS = [
  'EXPERTS_INSIGHTS_PROVIDER',
  'OPENROUTER_API_KEY',
  'EXPERTS_INSIGHTS_MODEL',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'AGENT_DIALOGUE_PROVIDER',
];

function stashInsightsEnv() {
  const prev = {};
  for (const k of INSIGHTS_ENV_KEYS) {
    prev[k] = process.env[k];
    delete process.env[k];
  }
  return prev;
}

function restoreInsightsEnv(prev) {
  for (const k of INSIGHTS_ENV_KEYS) {
    if (prev[k] === undefined) delete process.env[k];
    else process.env[k] = prev[k];
  }
}

describe('resolveDialogueConfig', () => {
  it('defaults to anthropic provider when unset', () => {
    const cfg = resolveDialogueConfig({});
    assert.equal(cfg.provider, 'anthropic');
    assert.ok(cfg.modelStrong);
    assert.ok(cfg.modelFast);
  });

  it('accepts explicit provider and models', () => {
    const cfg = resolveDialogueConfig({
      provider: 'openai',
      modelStrong: 'gpt-4.1',
      modelFast: 'gpt-4.1-mini',
    });
    assert.equal(cfg.provider, 'openai');
    assert.equal(cfg.modelStrong, 'gpt-4.1');
    assert.equal(cfg.modelFast, 'gpt-4.1-mini');
  });
});

describe('resolveExpertsInsightsConfig', () => {
  it('prefers OpenRouter and Kimi K2.5 when OPENROUTER_API_KEY is set', () => {
    const prev = stashInsightsEnv();
    try {
      process.env.OPENROUTER_API_KEY = 'sk-or-test';
      const cfg = resolveExpertsInsightsConfig();
      assert.equal(cfg.provider, 'openrouter');
      assert.equal(cfg.model, DEFAULT_EXPERTS_OPENROUTER_MODEL);
    } finally {
      restoreInsightsEnv(prev);
    }
  });

  it('respects EXPERTS_INSIGHTS_MODEL with OpenRouter', () => {
    const prev = stashInsightsEnv();
    try {
      process.env.OPENROUTER_API_KEY = 'sk-or-test';
      process.env.EXPERTS_INSIGHTS_MODEL = 'custom/model';
      const cfg = resolveExpertsInsightsConfig();
      assert.equal(cfg.provider, 'openrouter');
      assert.equal(cfg.model, 'custom/model');
    } finally {
      restoreInsightsEnv(prev);
    }
  });

  it('forces Anthropic when EXPERTS_INSIGHTS_PROVIDER=anthropic', () => {
    const prev = stashInsightsEnv();
    try {
      process.env.OPENROUTER_API_KEY = 'sk-or-test';
      process.env.EXPERTS_INSIGHTS_PROVIDER = 'anthropic';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      const cfg = resolveExpertsInsightsConfig();
      assert.equal(cfg.provider, 'anthropic');
    } finally {
      restoreInsightsEnv(prev);
    }
  });
});

describe('normalizeProvider', () => {
  it('normalizes provider names and rejects unknown', () => {
    assert.equal(normalizeProvider('Anthropic'), 'anthropic');
    assert.equal(normalizeProvider('openai'), 'openai');
    assert.equal(normalizeProvider('OpenRouter'), 'openrouter');
    assert.throws(() => normalizeProvider('random-provider'));
  });
});
