/**
 * Unit tests for Harry Historian freshness/coverage helpers.
 * Run: node --test server/agents/harryHistorian.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  checkDataFreshness,
  resolveActiveAgents,
  buildTopDownFilterProfile,
  applyTopDownSignalFilter,
  resolveSignalCacheTimestamp,
  runBatchLearningLoop,
  buildRegimeLeaderboard,
  buildRegimeProfile,
  buildSectorRsPercentileByTicker,
  resolveValidationTiersForCycle,
} from './harryHistorian.js';

describe('resolveSignalCacheTimestamp', () => {
  it('prefers explicit scanDate when present', () => {
    const out = resolveSignalCacheTimestamp({
      scanDate: '2026-02-20T10:00:00.000Z',
      created_at: '2026-02-19T10:00:00.000Z',
      entryDate: '2026-02-18',
      entry_date: '2026-02-17',
    });
    assert.equal(out, '2026-02-20T10:00:00.000Z');
  });

  it('falls back to created_at, then entryDate, then entry_date', () => {
    assert.equal(
      resolveSignalCacheTimestamp({
        created_at: '2026-02-19T10:00:00.000Z',
        entryDate: '2026-02-18',
        entry_date: '2026-02-17',
      }),
      '2026-02-19T10:00:00.000Z'
    );

    assert.equal(
      resolveSignalCacheTimestamp({
        entryDate: '2026-02-18',
        entry_date: '2026-02-17',
      }),
      '2026-02-18'
    );

    assert.equal(
      resolveSignalCacheTimestamp({
        entry_date: '2026-02-17',
      }),
      '2026-02-17'
    );
  });

  it('returns null when no usable timestamp exists', () => {
    assert.equal(resolveSignalCacheTimestamp({}), null);
    assert.equal(resolveSignalCacheTimestamp(null), null);
  });
});

describe('checkDataFreshness', () => {
  const now = Date.now();

  it('returns fresh=true when data is < 30 days old and all tickers covered', () => {
    const signals = [
      { ticker: 'AAPL', entryDate: new Date(now - 5 * 86400_000).toISOString() },
      { ticker: 'NVDA', entryDate: new Date(now - 10 * 86400_000).toISOString() },
      { ticker: 'MSFT', entryDate: new Date(now - 3 * 86400_000).toISOString() },
    ];
    const tickerList = ['AAPL', 'NVDA', 'MSFT'];

    const result = checkDataFreshness(signals, tickerList);
    assert.strictEqual(result.isFresh, true);
    assert.strictEqual(result.coveragePct, 100);
    assert.strictEqual(result.missingTickers.length, 0);
    assert.ok(result.ageDays < 30);
  });

  it('returns fresh=false when data is > 30 days old', () => {
    const signals = [
      { ticker: 'AAPL', entryDate: new Date(now - 45 * 86400_000).toISOString() },
    ];
    const tickerList = ['AAPL'];

    const result = checkDataFreshness(signals, tickerList);
    assert.strictEqual(result.isFresh, false);
    assert.ok(result.ageDays >= 30);
  });

  it('returns fresh=false when coverage is below threshold', () => {
    const signals = [
      { ticker: 'AAPL', entryDate: new Date(now - 2 * 86400_000).toISOString() },
    ];
    const tickerList = ['AAPL', 'NVDA', 'MSFT', 'GOOG', 'AMZN', 'META', 'TSLA', 'AMD', 'AVGO', 'CRM'];

    const result = checkDataFreshness(signals, tickerList);
    assert.strictEqual(result.isFresh, false);
    assert.strictEqual(result.coveragePct, 10);
    assert.strictEqual(result.missingTickers.length, 9);
  });

  it('handles empty signals gracefully', () => {
    const result = checkDataFreshness([], ['AAPL', 'NVDA']);
    assert.strictEqual(result.isFresh, false);
    assert.strictEqual(result.coveragePct, 0);
    assert.strictEqual(result.missingTickers.length, 2);
    assert.strictEqual(result.ageDays, Infinity);
  });

  it('handles empty ticker list gracefully', () => {
    const result = checkDataFreshness([], []);
    assert.strictEqual(result.isFresh, false);
    assert.strictEqual(result.coveragePct, 0);
  });

  it('uses entry_date fallback field', () => {
    const signals = [
      { ticker: 'AAPL', entry_date: new Date(now - 5 * 86400_000).toISOString() },
    ];
    const tickerList = ['AAPL'];

    const result = checkDataFreshness(signals, tickerList);
    assert.strictEqual(result.isFresh, true);
    assert.ok(result.ageDays < 30);
  });

  it('respects custom maxAgeDays parameter', () => {
    const signals = [
      { ticker: 'AAPL', entryDate: new Date(now - 10 * 86400_000).toISOString() },
    ];
    const tickerList = ['AAPL'];

    const fresh7 = checkDataFreshness(signals, tickerList, { maxAgeDays: 7 });
    assert.strictEqual(fresh7.isFresh, false);

    const fresh15 = checkDataFreshness(signals, tickerList, { maxAgeDays: 15 });
    assert.strictEqual(fresh15.isFresh, true);
  });

  it('respects custom minCoveragePct parameter', () => {
    const signals = [
      { ticker: 'AAPL', entryDate: new Date(now - 2 * 86400_000).toISOString() },
    ];
    const tickerList = ['AAPL', 'NVDA'];

    const strict = checkDataFreshness(signals, tickerList, { minCoveragePct: 80 });
    assert.strictEqual(strict.isFresh, false);

    const relaxed = checkDataFreshness(signals, tickerList, { minCoveragePct: 40 });
    assert.strictEqual(relaxed.isFresh, true);
  });

  it('deduplicates tickers from signals', () => {
    const signals = [
      { ticker: 'AAPL', entryDate: new Date(now - 2 * 86400_000).toISOString() },
      { ticker: 'AAPL', entryDate: new Date(now - 5 * 86400_000).toISOString() },
      { ticker: 'NVDA', entryDate: new Date(now - 3 * 86400_000).toISOString() },
    ];
    const tickerList = ['AAPL', 'NVDA'];

    const result = checkDataFreshness(signals, tickerList);
    assert.strictEqual(result.isFresh, true);
    assert.strictEqual(result.coveragePct, 100);
  });
});

describe('resolveActiveAgents', () => {
  const agents = [
    { agentType: 'momentum_scout', name: 'Momentum Scout' },
    { agentType: 'base_hunter', name: 'Base Hunter' },
    { agentType: 'breakout_tracker', name: 'Breakout Tracker' },
  ];

  const budgets = {
    momentum_scout: 0.25,
    base_hunter: 0,
    breakout_tracker: 0.2,
  };

  it('returns only agents with positive budgets when agentTypes is null', () => {
    const result = resolveActiveAgents(agents, budgets, null);
    assert.deepStrictEqual(result.map((a) => a.agentType), ['momentum_scout', 'breakout_tracker']);
  });

  it('returns requested agents even when budget is zero', () => {
    const result = resolveActiveAgents(agents, budgets, ['base_hunter']);
    assert.deepStrictEqual(result.map((a) => a.agentType), ['base_hunter']);
  });

  it('ignores unknown agentTypes', () => {
    const result = resolveActiveAgents(agents, budgets, ['momentum_scout', 'unknown_agent']);
    assert.deepStrictEqual(result.map((a) => a.agentType), ['momentum_scout']);
  });
});

describe('buildTopDownFilterProfile', () => {
  it('uses stricter sector and VCP gates in BULL', () => {
    const profile = buildTopDownFilterProfile('BULL');
    assert.equal(profile.maxSectorRankPct, 35);
    assert.equal(profile.requireVcpValid, true);
    assert.ok(profile.minRelativeStrength >= 80);
  });

  it('uses looser sector gate in CORRECTION', () => {
    const profile = buildTopDownFilterProfile('CORRECTION');
    assert.equal(profile.maxSectorRankPct, 65);
    assert.equal(profile.requireVcpValid, true);
    assert.ok(profile.minRelativeStrength <= 70);
  });
});

describe('applyTopDownSignalFilter', () => {
  it('filters by sector rank + VCP validity + regime profile', () => {
    const signals = [
      {
        ticker: 'AAPL',
        context: { vcpValid: true, relativeStrength: 92, patternConfidence: 78 },
      },
      {
        ticker: 'MSFT',
        context: { vcpValid: true, relativeStrength: 88, patternConfidence: 74 },
      },
      {
        ticker: 'XOM',
        context: { vcpValid: false, relativeStrength: 90, patternConfidence: 75 },
      },
      {
        ticker: 'IBM',
        context: { vcpValid: true, relativeStrength: 60, patternConfidence: 58 },
      },
    ];

    const filtered = applyTopDownSignalFilter(signals, {
      regime: { regime: 'BULL' },
      profile: buildTopDownFilterProfile('BULL'),
      sectorRankByTicker: {
        AAPL: 22,
        MSFT: 44,
        XOM: 19,
        IBM: 28,
      },
    });

    assert.deepEqual(filtered.map((s) => s.ticker), ['AAPL']);
  });
});

describe('runBatchLearningLoop', () => {
  it('runs N cycles with checkpoint callback and returns leaderboard', async () => {
    const checkpoints = [];
    let callCount = 0;

    const result = await runBatchLearningLoop({
      runId: 'test-run-1',
      agentTypes: ['momentum_scout', 'base_hunter'],
      cyclesPerAgent: 3,
      runCycle: async ({ cycle }) => {
        callCount += 1;
        return {
          regime: { regime: cycle % 2 === 0 ? 'CORRECTION' : 'BULL' },
          agentResults: [
            {
              agentType: 'momentum_scout',
              success: true,
              abComparison: { promoted: cycle % 2 === 1, delta: { expectancy: cycle } },
            },
            {
              agentType: 'base_hunter',
              success: true,
              abComparison: { promoted: false, delta: { expectancy: cycle - 0.5 } },
            },
          ],
        };
      },
      onCheckpoint: async (cp) => {
        checkpoints.push(cp);
      },
    });

    assert.equal(callCount, 3);
    assert.equal(checkpoints.length, 3);
    assert.equal(result.cyclesCompleted, 3);
    assert.equal(result.totalAgentExecutions, 6);
    assert.ok(result.leaderboardByRegime.BULL);
    assert.ok(result.leaderboardByRegime.CORRECTION);
  });

  it('resumes from a checkpointed cycle window', async () => {
    let callCount = 0;
    const existingCycles = [
      { cycle: 1, success: true, regime: { regime: 'BULL' }, agentResults: [] },
      { cycle: 2, success: true, regime: { regime: 'BULL' }, agentResults: [] },
    ];

    const result = await runBatchLearningLoop({
      runId: 'resume-test',
      agentTypes: ['momentum_scout'],
      cyclesPerAgent: 4,
      startCycle: 3,
      existingCycles,
      runCycle: async ({ cycle }) => {
        callCount += 1;
        return {
          regime: { regime: cycle === 3 ? 'UNCERTAIN' : 'CORRECTION' },
          agentResults: [
            {
              agentType: 'momentum_scout',
              success: true,
              abComparison: { promoted: false, delta: { expectancy: 0.1 } },
            },
          ],
        };
      },
    });

    assert.equal(callCount, 2);
    assert.equal(result.cyclesCompleted, 4);
    assert.equal(result.cycles.length, 4);
  });

  it('forwards in-cycle progress events during batch execution', async () => {
    const progressEvents = [];

    await runBatchLearningLoop({
      runId: 'progress-forwarding-test',
      agentTypes: ['momentum_scout'],
      cyclesPerAgent: 1,
      runCycle: async ({ emitProgress }) => {
        emitProgress?.({
          phase: 'agents_starting',
          message: 'Deploying agents',
        });
        emitProgress?.({
          phase: 'agent_iteration',
          agent: 'momentum_scout',
          agentName: 'Momentum Scout',
          iteration: 4,
          maxIterations: 20,
          message: 'Iteration 4/20',
        });

        return {
          regime: { regime: 'BULL' },
          agentResults: [
            {
              agentType: 'momentum_scout',
              success: true,
              abComparison: { promoted: false, delta: { expectancy: 0.1 } },
            },
          ],
        };
      },
      onProgress: (event) => progressEvents.push(event),
    });

    assert.ok(progressEvents.some((event) =>
      event.phase === 'agents_starting' && event.cycle === 1 && event.cyclesPerAgent === 1
    ));
    assert.ok(progressEvents.some((event) =>
      event.phase === 'agent_iteration' &&
      event.agent === 'momentum_scout' &&
      event.iteration === 4 &&
      event.cycle === 1 &&
      event.cyclesPerAgent === 1
    ));
  });

  it('runs scheduled hierarchy validation tiers on promoted agents', async () => {
    const validations = [];

    const result = await runBatchLearningLoop({
      runId: 'validation-test',
      agentTypes: ['momentum_scout', 'base_hunter'],
      cyclesPerAgent: 3,
      validationPolicy: {
        enabled: true,
        wfoEveryNCycles: 2,
        wfoMcEveryNCycles: 3,
        holdoutOnFinalCycle: true,
        validatePromotedOnly: true,
      },
      runCycle: async ({ cycle }) => ({
        regime: { regime: 'BULL' },
        agentResults: [
          {
            agentType: 'momentum_scout',
            success: true,
            abComparison: { promoted: true, delta: { expectancy: 0.8 + cycle } },
          },
          {
            agentType: 'base_hunter',
            success: true,
            abComparison: { promoted: false, delta: { expectancy: 0.2 } },
          },
        ],
      }),
      runValidation: async (payload) => {
        validations.push({ cycle: payload.cycle, tier: payload.tier, agentType: payload.agentType });
        return { validated: true, tier: payload.tier, objectiveDelta: 0.9 };
      },
    });

    // cycle 2 => wfo, cycle 3 => wfo_mc + holdout; promoted-only => momentum only
    assert.deepEqual(validations, [
      { cycle: 2, tier: 'wfo', agentType: 'momentum_scout' },
      { cycle: 3, tier: 'wfo_mc', agentType: 'momentum_scout' },
      { cycle: 3, tier: 'holdout', agentType: 'momentum_scout' },
    ]);
    assert.equal(result.validationSummary.totalValidations, 3);
    assert.equal(result.cycles[1].validations.length, 1);
    assert.equal(result.cycles[2].validations.length, 2);
  });

  it('loads shared resources once and reuses them across cycles', async () => {
    let sharedLoadCount = 0;
    const sharedSignalPool = [{ ticker: 'AAPL', entryDate: '2026-01-01' }];
    const sharedSectorRankByTicker = { AAPL: 12.3 };
    const seen = [];

    const result = await runBatchLearningLoop({
      runId: 'shared-resources-test',
      agentTypes: ['momentum_scout'],
      cyclesPerAgent: 3,
      loadSharedResources: async () => {
        sharedLoadCount += 1;
        return {
          rawSignalPool: sharedSignalPool,
          sectorRankByTicker: sharedSectorRankByTicker,
        };
      },
      runCycle: async ({ cycle, sharedSignalPool: seenPool, sharedSectorRankByTicker: seenSector }) => {
        seen.push({ cycle, seenPool, seenSector });
        return {
          regime: { regime: 'BULL' },
          agentResults: [
            {
              agentType: 'momentum_scout',
              success: true,
              abComparison: { promoted: false, delta: { expectancy: 0.1 } },
            },
          ],
        };
      },
    });

    assert.equal(sharedLoadCount, 1);
    assert.equal(result.cyclesCompleted, 3);
    assert.equal(seen.length, 3);
    assert.ok(seen.every((row) => row.seenPool === sharedSignalPool));
    assert.ok(seen.every((row) => row.seenSector === sharedSectorRankByTicker));
  });
});

describe('resolveValidationTiersForCycle', () => {
  it('returns scheduled tiers for cycle milestones', () => {
    const policy = {
      enabled: true,
      wfoEveryNCycles: 2,
      wfoMcEveryNCycles: 5,
      holdoutOnFinalCycle: true,
    };
    assert.deepEqual(resolveValidationTiersForCycle(1, 5, policy), []);
    assert.deepEqual(resolveValidationTiersForCycle(2, 5, policy), ['wfo']);
    assert.deepEqual(resolveValidationTiersForCycle(5, 5, policy), ['wfo_mc', 'holdout']);
  });
});

describe('buildRegimeLeaderboard', () => {
  it('aggregates expectancy deltas and promotion rates by regime and agent', () => {
    const leaderboard = buildRegimeLeaderboard([
      {
        regime: { regime: 'BULL' },
        agentResults: [
          { agentType: 'momentum_scout', success: true, abComparison: { promoted: true, delta: { expectancy: 1.2 } } },
          { agentType: 'base_hunter', success: true, abComparison: { promoted: false, delta: { expectancy: 0.2 } } },
        ],
      },
      {
        regime: { regime: 'BULL' },
        agentResults: [
          { agentType: 'momentum_scout', success: true, abComparison: { promoted: false, delta: { expectancy: 0.4 } } },
        ],
      },
    ]);

    assert.equal(leaderboard.BULL.momentum_scout.runs, 2);
    assert.equal(leaderboard.BULL.momentum_scout.promotions, 1);
    assert.equal(leaderboard.BULL.momentum_scout.avgDeltaExpectancy, 0.8);
    assert.equal(leaderboard.BULL.base_hunter.avgDeltaExpectancy, 0.2);
  });
});

describe('buildRegimeProfile', () => {
  it('aggregates top-down filter stats by regime', () => {
    const profile = buildRegimeProfile([
      {
        regime: { regime: 'BULL' },
        topDown: {
          input: 100,
          output: 40,
          removedBySector: 30,
          removedByVcp: 10,
          removedByRs: 12,
          removedByPattern: 5,
          removedByContractions: 3,
        },
      },
      {
        regime: { regime: 'BULL' },
        topDown: {
          input: 80,
          output: 32,
          removedBySector: 20,
          removedByVcp: 8,
          removedByRs: 10,
          removedByPattern: 6,
          removedByContractions: 4,
        },
      },
      {
        regime: { regime: 'CORRECTION' },
        topDown: {
          input: 90,
          output: 18,
          removedBySector: 20,
          removedByVcp: 25,
          removedByRs: 12,
          removedByPattern: 10,
          removedByContractions: 5,
        },
      },
    ]);

    assert.equal(profile.BULL.cycles, 2);
    assert.equal(profile.BULL.avgInputSignals, 90);
    assert.equal(profile.BULL.avgOutputSignals, 36);
    assert.equal(profile.BULL.avgSurvivalRatePct, 40);
    assert.equal(profile.BULL.avgRemovedBySector, 25);
    assert.equal(profile.BULL.avgRemovedByVcp, 9);

    assert.equal(profile.CORRECTION.cycles, 1);
    assert.equal(profile.CORRECTION.avgInputSignals, 90);
    assert.equal(profile.CORRECTION.avgOutputSignals, 18);
    assert.equal(profile.CORRECTION.avgSurvivalRatePct, 20);
  });
});

describe('buildSectorRsPercentileByTicker', () => {
  it('maps ticker industry performance into RS percentiles', () => {
    const tvPayload = {
      returnsMap: new Map([
        ['software', { perf3M: 22 }],
        ['semiconductors', { perf3M: 12 }],
        ['utilities', { perf3M: -8 }],
      ]),
      tickerToTvIndustry: new Map([
        ['MSFT', 'software'],
        ['NVDA', 'semiconductors'],
        ['DUK', 'utilities'],
      ]),
    };

    const out = buildSectorRsPercentileByTicker(tvPayload);
    assert.equal(out.MSFT, 100);
    assert.equal(out.NVDA, 50);
    assert.equal(out.DUK, 0);
  });
});
