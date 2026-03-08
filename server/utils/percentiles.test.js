import { describe, it } from 'node:test';
import assert from 'node:assert';
import { percentile, summarizePercentiles } from './percentiles.js';

describe('percentile', () => {
  it('returns expected values for simple arrays', () => {
    const values = [0, 1, 2, 3, 4];
    assert.strictEqual(percentile(values, 0), 0);
    assert.strictEqual(percentile(values, 50), 2);
    assert.strictEqual(percentile(values, 100), 4);
  });
});

describe('summarizePercentiles', () => {
  it('computes avg and requested percentiles', () => {
    const values = [0, 1, 2, 3, 4];
    const summary = summarizePercentiles(values, [50, 90]);
    assert.strictEqual(summary.count, 5);
    assert.strictEqual(summary.avg, 2);
    assert.strictEqual(summary.p50, 2);
    assert.strictEqual(summary.p90, 3);
  });
});
