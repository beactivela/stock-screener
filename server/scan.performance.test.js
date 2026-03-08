import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { measureScanDuration } from './scan.js';

describe('measureScanDuration', () => {
  it('measures scan time for 10 tickers', async () => {
    let callCount = 0;
    let now = 0;
    const nowFn = () => now;
    const scanFn = async () => {
      callCount += 1;
      now += 50;
      return [];
    };

    const result = await measureScanDuration({
      tickers: Array.from({ length: 10 }, (_, i) => `T${i}`),
      scanFn,
      nowFn,
      delayMs: 0,
    });

    assert.equal(callCount, 10);
    assert.equal(result.tickersScanned, 10);
    assert.equal(result.durationMs, 500);
    assert.equal(result.avgPerTickerMs, 50);
  });
});
