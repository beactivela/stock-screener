import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapOpus45CacheRow,
  buildOpus45CacheInsertRow,
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
});
