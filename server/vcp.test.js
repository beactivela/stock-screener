import assert from 'assert';
import { describe, it } from 'node:test';
import { checkVCP } from './vcp.js';

function buildBars({ days = 240, start = 100, step = 0.5 }) {
  const bars = [];
  const startTime = new Date('2024-01-01T00:00:00Z').getTime();
  for (let i = 0; i < days; i++) {
    const close = start + i * step;
    bars.push({
      t: startTime + i * 24 * 60 * 60 * 1000,
      o: close - 0.5,
      h: close + 1,
      l: close - 1,
      c: close,
      v: 1_000_000 + i * 1_000,
    });
  }
  return bars;
}

describe('checkVCP', () => {
  it('computes ma10Above20 for downstream 10-20 classifier', () => {
    const bars = buildBars({ days: 240, start: 100, step: 0.5 });
    const result = checkVCP(bars);

    assert.equal(typeof result.ma10Above20, 'boolean');
    assert.equal(result.ma10Above20, true);
  });
});
