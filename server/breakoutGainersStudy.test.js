import assert from 'assert';
import { describe, it } from 'node:test';

import {
  detectBreakoutCandidates,
  selectBestBreakout,
  buildCharacteristicsSummary,
} from './breakoutGainersStudy.js';

function makeBars(length, options = {}) {
  const {
    startPrice = 20,
    startTs = Date.UTC(2023, 0, 2),
    dayMs = 24 * 60 * 60 * 1000,
    volume = 100,
  } = options;
  return Array.from({ length }, (_, idx) => {
    const close = startPrice + idx * 0.01;
    return {
      t: startTs + idx * dayMs,
      o: close - 0.1,
      h: close + 0.2,
      l: close - 0.2,
      c: close,
      v: volume,
    };
  });
}

describe('breakout study algorithm', () => {
  it('detects a valid breakout with strict pre-breakout $10 filter', () => {
    const bars = makeBars(220, { startPrice: 18, volume: 100 });
    const breakoutIndex = 160;

    // Create a flat base under 21, then breakout.
    for (let i = breakoutIndex - 65; i < breakoutIndex; i++) {
      bars[i].h = 20.9;
      bars[i].c = 20.4;
      bars[i].v = 95;
    }
    bars[breakoutIndex - 1].c = 20.8;
    bars[breakoutIndex].c = 21.3;
    bars[breakoutIndex].h = 21.5;
    bars[breakoutIndex].v = 220;

    // Ensure a post-breakout run exists.
    bars[breakoutIndex + 5].c = 24.8;
    bars[breakoutIndex + 5].h = 25.0;

    const candidates = detectBreakoutCandidates(bars, {
      periodStart: '2023-01-01',
      periodEnd: '2023-12-31',
    });

    assert.ok(candidates.length > 0);
    const best = selectBestBreakout(candidates);
    assert.equal(best.breakoutIndex, breakoutIndex);
    assert.equal(best.passesMinPrice20d, true);
    assert.ok(best.gainPct > 15);
    assert.equal(best.aboveSma20, true);
    assert.equal(best.aboveSma50, true);
    assert.equal(best.aboveSma100, true);
  });

  it('rejects breakouts when any of previous 20 closes are below $10', () => {
    const bars = makeBars(220, { startPrice: 12, volume: 100 });
    const breakoutIndex = 170;

    for (let i = breakoutIndex - 65; i < breakoutIndex; i++) {
      bars[i].h = 14.9;
      bars[i].c = 14.5;
      bars[i].v = 90;
    }
    bars[breakoutIndex - 5].c = 9.8;
    bars[breakoutIndex].c = 15.2;
    bars[breakoutIndex].h = 15.4;
    bars[breakoutIndex].v = 300;

    const candidates = detectBreakoutCandidates(bars, {
      periodStart: '2023-01-01',
      periodEnd: '2023-12-31',
    });
    assert.equal(candidates.length, 0);
  });

  it('selects the breakout with highest realized gain in period', () => {
    const bars = makeBars(260, { startPrice: 30, volume: 120 });
    const firstBreakout = 150;
    const secondBreakout = 200;

    for (let i = firstBreakout - 65; i < firstBreakout; i++) {
      bars[i].h = 35.9;
      bars[i].c = 35.2;
      bars[i].v = 100;
    }
    bars[firstBreakout].c = 36.4;
    bars[firstBreakout].h = 36.6;
    bars[firstBreakout].v = 220;
    bars[firstBreakout + 8].c = 40.2;
    bars[firstBreakout + 8].h = 40.5;

    for (let i = secondBreakout - 65; i < secondBreakout; i++) {
      bars[i].h = 41.8;
      bars[i].c = 41.3;
      bars[i].v = 110;
    }
    bars[secondBreakout].c = 42.1;
    bars[secondBreakout].h = 42.3;
    bars[secondBreakout].v = 250;
    bars[secondBreakout + 15].c = 55.2;
    bars[secondBreakout + 15].h = 55.4;

    const candidates = detectBreakoutCandidates(bars, {
      periodStart: '2023-01-01',
      periodEnd: '2023-12-31',
    });
    const best = selectBestBreakout(candidates);
    assert.equal(best.breakoutIndex, secondBreakout);
    assert.ok(best.gainPct > 30);
  });
});

describe('characteristics summary', () => {
  it('builds aggregate percentages and medians', () => {
    const rows = [
      {
        exchange: 'NASDAQ',
        setup: {
          aboveSma20: true,
          aboveSma50: true,
          aboveSma100: true,
          qtrEarningsYoY: 55,
          startPrice: 18,
          gainPct: 80,
        },
      },
      {
        exchange: 'NYSE',
        setup: {
          aboveSma20: true,
          aboveSma50: false,
          aboveSma100: true,
          qtrEarningsYoY: 12,
          startPrice: 24,
          gainPct: 62,
        },
      },
    ];
    const summary = buildCharacteristicsSummary(rows);
    assert.equal(summary.total, 2);
    assert.equal(summary.exchangeBreakdown.NASDAQ, 1);
    assert.equal(summary.pctAboveSma20, 100);
    assert.equal(summary.pctAboveSma50, 50);
    assert.equal(summary.pctQtrEarningsYoYAbove25, 50);
    assert.equal(summary.medianStartPrice, 21);
  });
});
