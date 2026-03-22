import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runUniverseBarsRefresh } from './cronRefreshBars.js';

describe('runUniverseBarsRefresh', () => {
  const prevLimit = process.env.SCAN_LIMIT;

  beforeEach(() => {
    delete process.env.SCAN_LIMIT;
  });

  afterEach(() => {
    if (prevLimit === undefined) delete process.env.SCAN_LIMIT;
    else process.env.SCAN_LIMIT = prevLimit;
  });

  it('returns not ok when ticker list is empty', async () => {
    const out = await runUniverseBarsRefresh({
      loadTickers: async () => [],
      getBarsBatch: async () => [],
      dateRange: () => ({ from: '2025-01-01', to: '2025-06-01' }),
    });
    assert.equal(out.ok, false);
    assert.match(out.message, /no tickers/i);
  });

  it('chunks bar requests and aggregates cache vs yahoo counts', async () => {
    const batchSizes = [];
    const out = await runUniverseBarsRefresh({
      loadTickers: async () => ['A', 'B', 'C', 'D'],
      chunkSize: 2,
      dateRange: () => ({ from: '2025-01-01', to: '2025-06-01' }),
      getBarsBatch: async (reqs) => {
        batchSizes.push(reqs.length);
        assert.ok(reqs.every((r) => r.from === '2025-01-01' && r.to === '2025-06-01' && r.interval === '1d'));
        return [
          { status: 'fulfilled', source: 'cache', bars: [{ t: 1 }] },
          { status: 'fulfilled', source: 'yahoo', bars: [{ t: 2 }] },
        ];
      },
    });
    assert.deepEqual(batchSizes, [2, 2]);
    assert.equal(out.ok, true);
    assert.equal(out.tickers, 4);
    assert.equal(out.cacheHits, 2);
    assert.equal(out.yahooFetched, 2);
    assert.equal(out.failures, 0);
  });

  it('respects SCAN_LIMIT when set', async () => {
    process.env.SCAN_LIMIT = '2';
    let lastReqLen = 0;
    await runUniverseBarsRefresh({
      loadTickers: async () => ['A', 'B', 'C', 'D'],
      chunkSize: 10,
      dateRange: () => ({ from: 'a', to: 'b' }),
      getBarsBatch: async (reqs) => {
        lastReqLen = reqs.length;
        return reqs.map(() => ({ status: 'fulfilled', source: 'cache', bars: [1] }));
      },
    });
    assert.equal(lastReqLen, 2);
  });
});
