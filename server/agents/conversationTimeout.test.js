/**
 * LLM timeout helper tests
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolveLlmTimeoutMs } from './conversationOrchestrator.js';

describe('resolveLlmTimeoutMs', () => {
  it('defaults to 30000ms when unset', () => {
    const prev = process.env.AGENT_DIALOGUE_TIMEOUT_MS;
    delete process.env.AGENT_DIALOGUE_TIMEOUT_MS;
    const ms = resolveLlmTimeoutMs();
    assert.equal(ms, 30000);
    if (prev != null) process.env.AGENT_DIALOGUE_TIMEOUT_MS = prev;
  });

  it('uses AGENT_DIALOGUE_TIMEOUT_MS when set', () => {
    const prev = process.env.AGENT_DIALOGUE_TIMEOUT_MS;
    process.env.AGENT_DIALOGUE_TIMEOUT_MS = '15000';
    const ms = resolveLlmTimeoutMs();
    assert.equal(ms, 15000);
    if (prev != null) process.env.AGENT_DIALOGUE_TIMEOUT_MS = prev;
    else delete process.env.AGENT_DIALOGUE_TIMEOUT_MS;
  });
});
