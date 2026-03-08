import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { measureScanDuration, applyRatingsAndEnhancements } from './scan.js';
import { checkVCP, buildSignalSnapshots } from './vcp.js';

function buildBars({ days = 260, start = 100, step = 0.6 }) {
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

describe('applyRatingsAndEnhancements', () => {
  it('applies IBD RS rating and recomputes enhanced scores', () => {
    const bars = buildBars({});
    const vcp = checkVCP(bars);
    const results = [{ ticker: 'AAA', ...vcp }];
    const fundamentals = { AAA: { industry: 'Tech', qtrEarningsYoY: 30, pctHeldByInst: 45, profitMargin: 15, operatingMargin: 12 } };
    const industryRanks = { Tech: { rank: 1, totalCount: 5, return1Y: 20, return6Mo: 10 } };
    const barsByTicker = new Map([['AAA', bars]]);
    const snapshotsByTicker = new Map([['AAA', buildSignalSnapshots(bars, 5)]]);

    const rated = applyRatingsAndEnhancements({
      results,
      fundamentals,
      industryRanks,
      barsByTicker,
      snapshotsByTicker,
    });

    assert.equal(rated.length, 1);
    assert.equal(rated[0].relativeStrength, 99);
    assert.equal(rated[0].rsData?.rsRating, 99);
    assert.ok(typeof rated[0].enhancedScore === 'number');
    assert.ok(Array.isArray(rated[0].signalSetupsRecent));
  });
});
