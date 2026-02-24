/**
 * Unit tests for backtesting hierarchy helpers
 * Run: node --test server/backtesting/hierarchy.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { splitHoldoutRange, buildWalkForwardWindows } from './windows.js';
import { runMonteCarloSimulations } from './monteCarlo.js';
import { normalizeEngineResult } from './engineContracts.js';
import { scoreSummary, combineSummaries } from './scoring.js';
import { filterSignalsByDate } from './signalUtils.js';
import { runWalkForwardOnSignals } from './walkForward.js';

describe('splitHoldoutRange', () => {
  it('splits last 20% as holdout (inclusive dates)', () => {
    const result = splitHoldoutRange({
      startDate: '2021-01-01',
      endDate: '2021-01-31',
      holdoutPct: 0.2,
    });

    assert.deepStrictEqual(result.inSample, {
      from: '2021-01-01',
      to: '2021-01-25',
    });
    assert.deepStrictEqual(result.holdout, {
      from: '2021-01-26',
      to: '2021-01-31',
    });
    assert.strictEqual(result.meta.totalDays, 31);
    assert.strictEqual(result.meta.holdoutDays, 6);
  });

  it('throws when holdoutPct is invalid', () => {
    assert.throws(() => splitHoldoutRange({
      startDate: '2021-01-01',
      endDate: '2021-01-31',
      holdoutPct: 0.9,
    }));
  });
});

describe('buildWalkForwardWindows', () => {
  it('builds rolling train/test windows', () => {
    const windows = buildWalkForwardWindows({
      startDate: '2021-01-01',
      endDate: '2021-05-31',
      trainMonths: 2,
      testMonths: 1,
      stepMonths: 1,
    });

    assert.strictEqual(windows.length, 3);
    assert.deepStrictEqual(windows[0], {
      index: 0,
      train: { from: '2021-01-01', to: '2021-02-28' },
      test: { from: '2021-03-01', to: '2021-03-31' },
    });
    assert.deepStrictEqual(windows[1], {
      index: 1,
      train: { from: '2021-02-01', to: '2021-03-31' },
      test: { from: '2021-04-01', to: '2021-04-30' },
    });
    assert.deepStrictEqual(windows[2], {
      index: 2,
      train: { from: '2021-03-01', to: '2021-04-30' },
      test: { from: '2021-05-01', to: '2021-05-31' },
    });
  });
});

describe('runMonteCarloSimulations', () => {
  it('is deterministic with a fixed seed', () => {
    const returns = [0.1, -0.05, 0.02, 0.03, -0.01];
    const first = runMonteCarloSimulations({ returns, trials: 5, seed: 123 });
    const second = runMonteCarloSimulations({ returns, trials: 5, seed: 123 });

    assert.deepStrictEqual(first.summary, second.summary);
    assert.deepStrictEqual(first.results, second.results);
  });

  it('computes summary stats', () => {
    const returns = [0.1, -0.05, 0.02];
    const result = runMonteCarloSimulations({ returns, trials: 10, seed: 42 });

    assert.strictEqual(result.results.length, 10);
    assert.ok(typeof result.summary.meanEndingEquity === 'number');
    assert.ok(typeof result.summary.worstEndingEquity === 'number');
    assert.ok(typeof result.summary.bestEndingEquity === 'number');
  });
});

describe('normalizeEngineResult', () => {
  it('normalizes vectorbt output to a common shape', () => {
    const normalized = normalizeEngineResult({
      engine: 'vectorbt',
      raw: {
        metrics: {
          total_return_pct: 25,
          cagr_pct: 12,
          sharpe: 1.4,
          max_drawdown_pct: -18,
          win_rate_pct: 55,
        },
      },
      meta: { tier: 'simple' },
    });

    assert.strictEqual(normalized.engine, 'vectorbt');
    assert.strictEqual(normalized.summary.totalReturnPct, 25);
    assert.strictEqual(normalized.summary.cagrPct, 12);
    assert.strictEqual(normalized.summary.maxDrawdownPct, -18);
    assert.strictEqual(normalized.meta.tier, 'simple');
  });

  it('throws for missing metrics', () => {
    assert.throws(() => normalizeEngineResult({
      engine: 'vectorbt',
      raw: {},
      meta: {},
    }));
  });
});

describe('scoreSummary', () => {
  it('scores by selected metric', () => {
    const summary = { expectancy: 1.5, avgReturn: 3, winRate: 55, totalSignals: 10 };
    assert.strictEqual(scoreSummary(summary, 'expectancy'), 1.5);
    assert.strictEqual(scoreSummary(summary, 'avgReturn'), 3);
    assert.strictEqual(scoreSummary(summary, 'winRate'), 55);
  });
});

describe('combineSummaries', () => {
  it('combines summaries weighted by signal count', () => {
    const combined = combineSummaries([
      { totalSignals: 10, expectancy: 2, avgReturn: 4, winRate: 60 },
      { totalSignals: 5, expectancy: 1, avgReturn: 2, winRate: 40 },
    ]);

    assert.strictEqual(combined.totalSignals, 15);
    assert.strictEqual(combined.expectancy, 1.67);
    assert.strictEqual(combined.avgReturn, 3.33);
    assert.strictEqual(combined.winRate, 53.33);
  });
});

describe('filterSignalsByDate', () => {
  it('filters signals by entryDate range', () => {
    const signals = [
      { entryDate: '2021-01-05', returnPct: 2 },
      { entryDate: '2021-02-15', returnPct: 3 },
      { entryDate: '2021-03-10', returnPct: -1 },
    ];

    const filtered = filterSignalsByDate(signals, '2021-02-01', '2021-02-28');
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].entryDate, '2021-02-15');
  });
});

describe('runWalkForwardOnSignals', () => {
  it('builds windows and aggregates test signals', async () => {
    const signals = [
      { entryDate: '2021-01-05', returnPct: 2 },
      { entryDate: '2021-02-15', returnPct: 3 },
      { entryDate: '2021-03-10', returnPct: -1 },
      { entryDate: '2021-04-10', returnPct: 1 },
      { entryDate: '2021-05-10', returnPct: 2 },
    ];

    const result = await runWalkForwardOnSignals({
      signals,
      startDate: '2021-01-01',
      endDate: '2021-05-31',
      trainMonths: 2,
      testMonths: 1,
      stepMonths: 1,
    });

    assert.strictEqual(result.windows.length, 3);
    assert.strictEqual(result.combinedTest.totalSignals, 3);
  });
});
