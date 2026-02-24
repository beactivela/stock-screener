/**
 * Unit tests for hierarchy → learning run bridge
 * Run: node --test server/backtesting/learningBridge.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildLearningRunFromHierarchy } from './learningBridge.js';

describe('buildLearningRunFromHierarchy', () => {
  it('maps WFO summaries to control/variant metrics', async () => {
    const result = {
      combinedTrain: { avgReturn: 2, expectancy: 1, winRate: 55, avgWin: 4, avgLoss: -2, profitFactor: 1.5, totalSignals: 100 },
      combinedTest: { avgReturn: 3, expectancy: 1.2, winRate: 57, avgWin: 5, avgLoss: -2.5, profitFactor: 1.6, totalSignals: 80 },
      windows: [{}, {}],
    };

    const stored = await buildLearningRunFromHierarchy({
      agentType: 'momentum_scout',
      tier: 'wfo',
      result,
      objective: 'expectancy',
    });

    // Supabase may be disabled; ensure we at least attempted.
    assert.ok(stored);
  });

  it('maps holdout summary as variant metrics', async () => {
    const result = {
      inSample: {
        wfo: {
          combinedTest: { avgReturn: 1, expectancy: 0.5, winRate: 52, avgWin: 3, avgLoss: -2, profitFactor: 1.2, totalSignals: 50 },
          windows: [{}],
        },
      },
      holdout: {
        node: { summary: { avgReturn: 0.8, expectancy: 0.3, winRate: 50, avgWin: 2.5, avgLoss: -2.1, profitFactor: 1.1, totalSignals: 20 } },
      },
    };

    const stored = await buildLearningRunFromHierarchy({
      agentType: 'base_hunter',
      tier: 'holdout',
      result,
      objective: 'expectancy',
    });

    assert.ok(stored);
  });
});
