import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeChartWindow } from './yahoo.js';

describe('normalizeChartWindow', () => {
  it('keeps a valid ascending date range unchanged', () => {
    const window = normalizeChartWindow('2026-01-01', '2026-02-01');
    assert.equal(window.period1, '2026-01-01');
    assert.equal(window.period2, '2026-02-01');
  });

  it('bumps period2 by one day when period1 equals period2', () => {
    const window = normalizeChartWindow('2026-02-24', '2026-02-24');
    assert.equal(window.period1, '2026-02-24');
    assert.equal(window.period2, '2026-02-25');
  });

  it('bumps period2 by one day when period2 is before period1', () => {
    const window = normalizeChartWindow('2026-02-24', '2026-02-20');
    assert.equal(window.period1, '2026-02-24');
    assert.equal(window.period2, '2026-02-25');
  });
});
