import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getLatestDailyBarsFetchedAt } from './bars.js';

describe('getLatestDailyBarsFetchedAt', () => {
  it('returns a consistent result shape', async () => {
    const r = await getLatestDailyBarsFetchedAt();
    assert.equal(typeof r.ok, 'boolean');
    if (r.ok) {
      assert.ok(r.lastFetchedAt && typeof r.lastFetchedAt === 'string');
      assert.ok(typeof r.dailyTickerCount === 'number' && r.dailyTickerCount > 0);
      assert.ok(!r.error);
    } else {
      assert.ok(r.error && typeof r.error === 'string');
      assert.equal(r.lastFetchedAt, null);
      assert.ok(typeof r.dailyTickerCount === 'number');
    }
  });
});
