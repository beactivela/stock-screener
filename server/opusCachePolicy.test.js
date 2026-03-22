import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldUseCachedOpusForScan } from './opusCachePolicy.js';

describe('shouldUseCachedOpusForScan', () => {
  it('uses cache when computedAt is current for scan timestamp', () => {
    const usable = shouldUseCachedOpusForScan(
      { scannedAt: '2026-03-22T16:00:00.000Z' },
      { computedAt: '2026-03-22T16:01:00.000Z', signals: [] },
    );
    assert.equal(usable, true);
  });

  it('uses stale cache during short post-scan recompute window', () => {
    const usable = shouldUseCachedOpusForScan(
      { scannedAt: '2026-03-22T16:00:00.000Z' },
      { computedAt: '2026-03-22T15:58:00.000Z', signals: [{ ticker: 'AAA' }] },
    );
    assert.equal(usable, true);
  });

  it('does not use stale cache beyond fallback window', () => {
    const usable = shouldUseCachedOpusForScan(
      { scannedAt: '2026-03-22T16:00:00.000Z' },
      { computedAt: '2026-03-22T12:00:00.000Z', signals: [{ ticker: 'AAA' }] },
      { staleFallbackMs: 5 * 60 * 1000 },
    );
    assert.equal(usable, false);
  });

  it('does not use stale cache if it has no score payload', () => {
    const usable = shouldUseCachedOpusForScan(
      { scannedAt: '2026-03-22T16:00:00.000Z' },
      { computedAt: '2026-03-22T15:58:00.000Z', signals: [], allScores: [] },
    );
    assert.equal(usable, false);
  });
});
