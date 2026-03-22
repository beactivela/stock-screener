import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { maybeClearStaleActiveScan } from './scanStaleLock.js';

describe('maybeClearStaleActiveScan', () => {
  it('does nothing when not running', () => {
    const activeScan = { running: false, progress: { startedAt: new Date(0).toISOString() } };
    assert.equal(maybeClearStaleActiveScan(activeScan, { VERCEL_ENV: 'production' }), false);
    assert.equal(activeScan.running, false);
  });

  it('clears Vercel stale lock after default threshold (45s)', () => {
    const oldStart = new Date(Date.now() - 46_000).toISOString();
    const activeScan = {
      running: true,
      progress: { index: 0, total: 0, vcpBullishCount: 0, startedAt: oldStart, completedAt: null },
    };
    assert.equal(maybeClearStaleActiveScan(activeScan, { VERCEL_ENV: 'production' }), true);
    assert.equal(activeScan.running, false);
    assert.ok(activeScan.progress.completedAt);
  });

  it('does not clear on Vercel before threshold', () => {
    const recent = new Date(Date.now() - 20_000).toISOString();
    const activeScan = {
      running: true,
      progress: { startedAt: recent, completedAt: null },
    };
    assert.equal(maybeClearStaleActiveScan(activeScan, { VERCEL_ENV: 'production' }), false);
    assert.equal(activeScan.running, true);
  });

  it('respects SCAN_STALE_LOCK_MS override (non-Vercel)', () => {
    const oldStart = new Date(Date.now() - 12_000).toISOString();
    const activeScan = {
      running: true,
      progress: { startedAt: oldStart, completedAt: null },
    };
    assert.equal(
      maybeClearStaleActiveScan(activeScan, { SCAN_STALE_LOCK_MS: '10000' }),
      true,
    );
    assert.equal(activeScan.running, false);
  });

  it('does not clear off-Vercel when SCAN_STALE_LOCK_MS unset', () => {
    const oldStart = new Date(Date.now() - 3600_000).toISOString();
    const activeScan = {
      running: true,
      progress: { startedAt: oldStart, completedAt: null },
    };
    assert.equal(maybeClearStaleActiveScan(activeScan, {}), false);
    assert.equal(activeScan.running, true);
  });
});
