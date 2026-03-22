import assert from 'assert';
import { describe, it } from 'node:test';
import { dateRange, runScanStream } from './scan.js';

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
