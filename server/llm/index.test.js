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
  DEFAULT_EXPERTS_OLLAMA_MODEL,
  resolveOllamaOpenAiBaseUrl,
  assistantTextFromChatMessage,
} from './index.js';

const INSIGHTS_ENV_KEYS = [
  'EXPERTS_INSIGHTS_PROVIDER',
  'OLLAMA_API_KEY',
  'OLLAMA_BASE_URL',
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
  it('prefers Ollama when OLLAMA_API_KEY is set (over OpenRouter)', () => {
    const prev = stashInsightsEnv();
    try {
      process.env.OLLAMA_API_KEY = 'ok-test';
      process.env.OPENROUTER_API_KEY = 'sk-or-test';
      const cfg = resolveExpertsInsightsConfig();
      assert.equal(cfg.provider, 'ollama');
      assert.equal(cfg.model, DEFAULT_EXPERTS_OLLAMA_MODEL);
    } finally {
      restoreInsightsEnv(prev);
    }
  });

  it('uses OpenRouter when only OPENROUTER_API_KEY is set', () => {
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

  it('forces Ollama when EXPERTS_INSIGHTS_PROVIDER=ollama', () => {
    const prev = stashInsightsEnv();
    try {
      process.env.EXPERTS_INSIGHTS_PROVIDER = 'ollama';
      process.env.OPENROUTER_API_KEY = 'sk-or-test';
      const cfg = resolveExpertsInsightsConfig();
      assert.equal(cfg.provider, 'ollama');
      assert.equal(cfg.model, DEFAULT_EXPERTS_OLLAMA_MODEL);
    } finally {
      restoreInsightsEnv(prev);
    }
  });
});

describe('resolveOllamaOpenAiBaseUrl', () => {
  it('uses OLLAMA_BASE_URL when set', () => {
    const prev = stashInsightsEnv();
    try {
      process.env.OLLAMA_BASE_URL = 'https://example.com/v1';
      delete process.env.OLLAMA_API_KEY;
      assert.equal(resolveOllamaOpenAiBaseUrl(), 'https://example.com/v1');
    } finally {
      restoreInsightsEnv(prev);
    }
  });

  it('defaults to ollama.com/v1 when OLLAMA_API_KEY is set and base URL unset', () => {
    const prev = stashInsightsEnv();
    try {
      process.env.OLLAMA_API_KEY = 'key';
      delete process.env.OLLAMA_BASE_URL;
      assert.equal(resolveOllamaOpenAiBaseUrl(), 'https://ollama.com/v1');
    } finally {
      restoreInsightsEnv(prev);
    }
  });

  it('defaults to localhost when no key and no base URL', () => {
    const prev = stashInsightsEnv();
    try {
      delete process.env.OLLAMA_API_KEY;
      delete process.env.OLLAMA_BASE_URL;
      assert.equal(resolveOllamaOpenAiBaseUrl(), 'http://127.0.0.1:11434/v1');
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
    assert.equal(normalizeProvider('ollama'), 'ollama');
    assert.throws(() => normalizeProvider('random-provider'));
  });
});

describe('assistantTextFromChatMessage', () => {
  it('handles string content', () => {
    assert.equal(assistantTextFromChatMessage({ content: '  hello  ' }), 'hello');
  });

  it('joins array text parts (OpenAI-compatible)', () => {
    assert.equal(
      assistantTextFromChatMessage({
        content: [
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' },
        ],
      }),
      'ab'
    );
  });

  it('falls back to reasoning when content empty', () => {
    assert.equal(
      assistantTextFromChatMessage({ content: '', reasoning: 'fallback' }),
      'fallback'
    );
  });

  it('skips reasoning when reasoningFallback is false', () => {
    assert.equal(
      assistantTextFromChatMessage({ content: '', reasoning: 'internal' }, { reasoningFallback: false }),
      ''
    );
  });
});
