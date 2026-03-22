import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MIN_DAILY_BARS_FOR_IBD_RS, longRangeExpectsIbdrs } from './barHistoryLimits.js';

describe('barHistoryLimits', () => {
  it('exports RS bar floor', () => {
    assert.equal(MIN_DAILY_BARS_FOR_IBD_RS, 253);
  });

  it('longRangeExpectsIbdrs is true for scan-like spans', () => {
    assert.equal(longRangeExpectsIbdrs('2025-01-01', '2026-03-22'), true);
  });

  it('longRangeExpectsIbdrs is false for chart-sized spans', () => {
    assert.equal(longRangeExpectsIbdrs('2025-10-01', '2026-03-01'), false);
  });
});
