import assert from 'assert';
import { describe, it } from 'node:test';
import { dateRange, resolveScanExecutionConfig, runScanStream } from './scan.js';

describe('scan dateRange', () => {
  it('defaults to enough history for 200 MA based criteria', () => {
    const { from, to } = dateRange();
    const fromDate = new Date(`${from}T00:00:00Z`);
    const toDate = new Date(`${to}T00:00:00Z`);
    const diffMs = toDate.getTime() - fromDate.getTime();
    const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));

    // allow 1-day variance due to local date rollover
    assert.ok(diffDays >= 419 && diffDays <= 421, `expected ~420 days, got ${diffDays}`);
  });
});

describe('runScanStream(preloadedTickers)', () => {
  it('with an empty list yields nothing (no network)', async () => {
    const yielded = [];
    for await (const row of runScanStream([])) {
      yielded.push(row);
    }
    assert.strictEqual(yielded.length, 0);
  });
});

describe('resolveScanExecutionConfig', () => {
  it('uses explicit SCAN_CONCURRENCY / SCAN_YAHOO_CONCURRENCY when set', () => {
    const c = resolveScanExecutionConfig({
      SCAN_CONCURRENCY: '7',
      SCAN_YAHOO_CONCURRENCY: '3',
      SCAN_BATCH_SIZE: '15',
      SCAN_DELAY_MS: '100',
    });
    assert.strictEqual(c.scanConcurrency, 7);
    assert.strictEqual(c.yahooConcurrency, 3);
    assert.strictEqual(c.batchSize, 15);
    assert.strictEqual(c.delayMs, 100);
  });

  it('defaults stay within 4..20 and are finite when env omits concurrency', () => {
    const c = resolveScanExecutionConfig({});
    assert.ok(Number.isFinite(c.scanConcurrency));
    assert.ok(Number.isFinite(c.yahooConcurrency));
    assert.ok(c.scanConcurrency >= 4 && c.scanConcurrency <= 20);
    assert.ok(c.yahooConcurrency >= 4 && c.yahooConcurrency <= 20);
    assert.strictEqual(c.batchSize, 20);
  });
});
