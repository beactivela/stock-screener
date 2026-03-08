import assert from 'assert';
import { describe, it } from 'node:test';
import { assignIBDRelativeStrengthRatings, calculateRelativeStrength, checkVCP } from './vcp.js';

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

function buildBarsFromCloses(closes) {
  const bars = [];
  const startTime = new Date('2024-01-01T00:00:00Z').getTime();
  for (let i = 0; i < closes.length; i++) {
    const close = closes[i];
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

describe('calculateRelativeStrength (IBD RS raw)', () => {
  it('weights 3m twice vs 6/9/12m', () => {
    const closes = Array.from({ length: 260 }, () => 200);
    const lastIdx = closes.length - 1;
    closes[lastIdx - 63] = 100;  // 3m change = 100%
    closes[lastIdx - 126] = 150; // 6m change = 33.333%
    closes[lastIdx - 189] = 160; // 9m change = 25%
    closes[lastIdx - 252] = 200; // 12m change = 0%

    const bars = buildBarsFromCloses(closes);
    const rs = calculateRelativeStrength(bars);

    assert.ok(rs, 'Expected RS result');
    const expected = (2 * 100 + (50 / 1.5) + 25 + 0) / 5;
    assert.ok(Math.abs(rs.rsRaw - expected) < 0.01, `Expected ${expected}, got ${rs.rsRaw}`);
    assert.ok(Math.abs(rs.change3m - 100) < 0.01);
    assert.ok(Math.abs(rs.change6m - 33.3333) < 0.01);
    assert.ok(Math.abs(rs.change9m - 25) < 0.01);
    assert.ok(Math.abs(rs.change12m - 0) < 0.01);
  });

  it('returns null when less than 12 months of data', () => {
    const bars = buildBars({ days: 200, start: 100, step: 0.5 });
    const rs = calculateRelativeStrength(bars);
    assert.equal(rs, null);
  });
});

describe('assignIBDRelativeStrengthRatings', () => {
  it('maps strongest to 99 and weakest to 1', () => {
    const rows = [
      { ticker: 'AAA', rsData: { rsRaw: 140.1 } },
      { ticker: 'BBB', rsData: { rsRaw: 115.7 } },
      { ticker: 'CCC', rsData: { rsRaw: 101.2 } },
      { ticker: 'DDD', rsData: { rsRaw: 92.4 } },
    ];
    const rated = assignIBDRelativeStrengthRatings(rows);
    const byTicker = Object.fromEntries(rated.map((r) => [r.ticker, r]));

    assert.equal(byTicker.AAA.relativeStrength, 99);
    assert.equal(byTicker.DDD.relativeStrength, 1);
    assert.ok(byTicker.BBB.relativeStrength > byTicker.CCC.relativeStrength);
  });

  it('preserves null for rows missing RS', () => {
    const rows = [
      { ticker: 'AAA', rsData: { rsRaw: 130 } },
      { ticker: 'BBB', relativeStrength: null },
      { ticker: 'CCC', rsData: { rsRaw: 95 } },
    ];
    const rated = assignIBDRelativeStrengthRatings(rows);
    const bbb = rated.find((r) => r.ticker === 'BBB');
    assert.equal(bbb.relativeStrength, null);
  });
});
