import assert from 'node:assert';
import { describe, it } from 'node:test';

import { createMemoryCache, isCacheFresh, readThroughMemoryCache } from './memoryCache.js';

describe('memoryCache', () => {
  it('creates an empty cache entry', () => {
    assert.deepEqual(createMemoryCache(), { value: null, at: 0, promise: null });
  });

  it('reads through loader and caches the value', async () => {
    const entry = createMemoryCache();
    let loadCount = 0;
    const loader = async () => {
      loadCount += 1;
      return { ok: true };
    };

    const first = await readThroughMemoryCache(entry, 5_000, loader);
    const second = await readThroughMemoryCache(entry, 5_000, loader);

    assert.deepEqual(first, { ok: true });
    assert.deepEqual(second, { ok: true });
    assert.equal(loadCount, 1);
  });

  it('shares an in-flight promise across concurrent callers', async () => {
    const entry = createMemoryCache();
    let loadCount = 0;
    const loader = async () => {
      loadCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return 'value';
    };

    const [a, b] = await Promise.all([
      readThroughMemoryCache(entry, 5_000, loader),
      readThroughMemoryCache(entry, 5_000, loader),
    ]);

    assert.equal(a, 'value');
    assert.equal(b, 'value');
    assert.equal(loadCount, 1);
    assert.equal(isCacheFresh(entry, 5_000), true);
  });
});
