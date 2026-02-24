/**
 * Conversation orchestrator tests (uses a mock LLM)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { runConversationForSignal } from './conversationOrchestrator.js';

describe('runConversationForSignal', () => {
  it('returns a decision and transcript in order', async () => {
    const calls = [];
    const mockLlm = async ({ purpose }) => {
      calls.push(purpose);
      if (purpose === 'round1') {
        return JSON.stringify({
          id: 'card_1',
          agentType: 'momentum_scout',
          ticker: 'NVDA',
          direction: 'LONG',
          timeframe: 'swing',
          entry: { trigger: 'Close above pivot', price: 980, rationale: 'VCP breakout' },
          invalidation: { price: 915, rule: 'Hard stop 7%' },
          targets: [{ price: 1100, rationale: 'Measured move' }],
          confidence: 78,
          failureModes: ['Regime flip', 'Low volume follow-through'],
          evidence: { signalType: 'STRONG', opus45Confidence: 86, riskRewardRatio: 2.4, regime: 'BULL' },
        });
      }
      if (purpose === 'round2') {
        return JSON.stringify({
          id: 'ch_1',
          fromAgent: 'base_hunter',
          toAgent: 'momentum_scout',
          ticker: 'NVDA',
          assumption: 'Breakout volume sustains',
          risk: 'Volume fades',
          testableRule: 'If volume < 0.9x 50d avg on day 2, invalidate',
          confidenceImpact: -12,
        });
      }
      return JSON.stringify({
        id: 'dec_1',
        ticker: 'NVDA',
        action: 'TAKE',
        sizingPct: 5,
        entryPlan: 'Buy on close above pivot with volume',
        stopLoss: { price: 915, rule: 'Hard stop 7%' },
        targets: [{ price: 1100, rationale: 'Measured move' }],
        killCriteria: ['Regime flips', 'Breakout fails within 2 days'],
        rationale: 'Strong signal with acceptable risk-reward',
        dissentingAgents: [],
      });
    };

    const signal = {
      ticker: 'NVDA',
      signalType: 'STRONG',
      opus45Confidence: 86,
      riskRewardRatio: 2.4,
      metrics: { relativeStrength: 92, patternConfidence: 75 },
    };

    const result = await runConversationForSignal(signal, {
      regime: 'BULL',
      llmGenerate: mockLlm,
      specialists: [{ agentType: 'momentum_scout', name: 'Momentum Scout' }],
      challengers: [{ agentType: 'base_hunter', name: 'Base Hunter' }],
    });

    assert.equal(result.decision.action, 'TAKE');
    assert.equal(result.transcript.rounds.length, 3);
    assert.deepEqual(calls, ['round1', 'round2', 'round3']);
  });
});
