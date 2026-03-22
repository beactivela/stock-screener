import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapOpus45CacheRow,
  buildOpus45CacheInsertRow,
  mergeOpus45AllScoresWithSignals,
} from './opus45.js';

describe('opus45 cache row mapping', () => {
  it('maps all_scores from DB row into allScores payload', () => {
    const mapped = mapOpus45CacheRow({
      signals: [{ ticker: 'AAA' }],
      all_scores: [{ ticker: 'AAA', opus45Confidence: 74, opus45Grade: 'B' }],
      stats: { total: 1 },
      total: 1,
      computed_at: '2026-03-22T00:00:00.000Z',
    });
    assert.deepEqual(mapped.allScores, [{ ticker: 'AAA', opus45Confidence: 74, opus45Grade: 'B' }]);
    assert.equal(mapped.computedAt, '2026-03-22T00:00:00.000Z');
  });

  it('builds insert row with all_scores payload', () => {
    const row = buildOpus45CacheInsertRow({
      signals: [{ ticker: 'AAA' }],
      allScores: [{ ticker: 'AAA', opus45Confidence: 91, opus45Grade: 'A' }],
      stats: { total: 1 },
      total: 1,
      computedAt: '2026-03-22T00:00:00.000Z',
    });
    assert.deepEqual(row.all_scores, [{ ticker: 'AAA', opus45Confidence: 91, opus45Grade: 'A' }]);
    assert.equal(row.total, 1);
  });

  it('backfills missing trade fields from signals into allScores rows', () => {
    const merged = mergeOpus45AllScoresWithSignals(
      [
        { ticker: 'AAA', opus45Confidence: 91, opus45Grade: 'A' },
        { ticker: 'BBB', opus45Confidence: 67, opus45Grade: 'C', entryDate: '2026-03-20' },
      ],
      [
        {
          ticker: 'AAA',
          entryDate: '2026-03-21',
          daysSinceBuy: 1,
          pctChange: 2.4,
          entryPrice: 100,
          stopLossPrice: 93,
          riskRewardRatio: 2.5,
        },
      ],
    );

    assert.deepEqual(merged, [
      {
        ticker: 'AAA',
        opus45Confidence: 91,
        opus45Grade: 'A',
        entryDate: '2026-03-21',
        daysSinceBuy: 1,
        pctChange: 2.4,
        entryPrice: 100,
        stopLossPrice: 93,
        riskRewardRatio: 2.5,
      },
      { ticker: 'BBB', opus45Confidence: 67, opus45Grade: 'C', entryDate: '2026-03-20' },
    ]);
  });

  it('appends signal rows missing from allScores', () => {
    const merged = mergeOpus45AllScoresWithSignals(
      [{ ticker: 'AAA', opus45Confidence: 70, opus45Grade: 'B' }],
      [
        { ticker: 'AAA', entryDate: '2026-03-21' },
        { ticker: 'ZZZ', entryDate: '2026-03-22', daysSinceBuy: 0, pctChange: 1.2 },
      ],
    );

    assert.deepEqual(merged, [
      { ticker: 'AAA', opus45Confidence: 70, opus45Grade: 'B', entryDate: '2026-03-21' },
      { ticker: 'ZZZ', entryDate: '2026-03-22', daysSinceBuy: 0, pctChange: 1.2 },
    ]);
  });
});
