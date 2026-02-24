/**
 * LLM adapter tests (config + validation only, no network calls)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  resolveDialogueConfig,
  normalizeProvider,
} from './index.js';

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

describe('normalizeProvider', () => {
  it('normalizes provider names and rejects unknown', () => {
    assert.equal(normalizeProvider('Anthropic'), 'anthropic');
    assert.equal(normalizeProvider('openai'), 'openai');
    assert.throws(() => normalizeProvider('random-provider'));
  });
});
