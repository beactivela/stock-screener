/**
 * Conversation schema tests (TradeCard, Challenge, Decision)
 * Run: node --test server/agents/conversationSchemas.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  validateTradeCard,
  validateChallenge,
  validateDecision,
} from './conversationSchemas.js';

describe('validateTradeCard', () => {
  it('accepts a well-formed TradeCard', () => {
    const card = {
      id: 'card_1',
      agentType: 'momentum_scout',
      ticker: 'NVDA',
      direction: 'LONG',
      timeframe: 'swing',
      entry: { trigger: 'Close above pivot on volume', price: 980.5, rationale: 'VCP breakout' },
      invalidation: { price: 915.0, rule: 'Close below 10MA 3 days' },
      targets: [{ price: 1100, rationale: '52w high extension' }],
      confidence: 78,
      failureModes: ['Market regime flips to BEAR', 'Breakout fails on low volume'],
      evidence: { signalType: 'STRONG', opus45Confidence: 86, riskRewardRatio: 2.4, regime: 'BULL' },
      notes: 'Fresh signal within 2 days',
    };
    const result = validateTradeCard(card);
    assert.equal(result.ok, true);
    assert.equal(result.errors.length, 0);
  });

  it('rejects a TradeCard missing required fields', () => {
    const bad = { ticker: 'NVDA', direction: 'LONG' };
    const result = validateTradeCard(bad);
    assert.equal(result.ok, false);
    assert.ok(result.errors.length > 0);
  });
});

describe('validateChallenge', () => {
  it('accepts a well-formed Challenge', () => {
    const challenge = {
      id: 'ch_1',
      fromAgent: 'base_hunter',
      toAgent: 'momentum_scout',
      ticker: 'NVDA',
      assumption: 'Breakout volume will sustain',
      risk: 'Volume fades on day 2',
      testableRule: 'If volume < 0.9x 50d avg on day 2, invalidate',
      confidenceImpact: -12,
    };
    const result = validateChallenge(challenge);
    assert.equal(result.ok, true);
    assert.equal(result.errors.length, 0);
  });
});

describe('validateDecision', () => {
  it('accepts a well-formed Decision', () => {
    const decision = {
      id: 'dec_1',
      ticker: 'NVDA',
      action: 'TAKE',
      sizingPct: 5,
      entryPlan: 'Buy on close above pivot with 1.4x volume',
      stopLoss: { price: 915, rule: 'Hard stop 7%' },
      targets: [{ price: 1100, rationale: 'Measured move' }],
      killCriteria: ['Regime flips to BEAR', 'Breakout fails within 2 days'],
      rationale: 'Consensus supports breakout; strong risk-reward',
      dissentingAgents: ['base_hunter'],
    };
    const result = validateDecision(decision);
    assert.equal(result.ok, true);
    assert.equal(result.errors.length, 0);
  });

  it('rejects a Decision with invalid action', () => {
    const bad = {
      id: 'dec_2',
      ticker: 'NVDA',
      action: 'MAYBE',
      sizingPct: 5,
      entryPlan: 'Buy on close',
      stopLoss: { price: 915, rule: 'Hard stop' },
      targets: [{ price: 1100, rationale: 'Measured move' }],
      killCriteria: ['Regime flips'],
      rationale: 'Not sure',
      dissentingAgents: [],
    };
    const result = validateDecision(bad);
    assert.equal(result.ok, false);
    assert.ok(result.errors.length > 0);
  });
});
