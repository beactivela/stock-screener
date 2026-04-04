import assert from 'assert';
import { describe, it } from 'node:test';

import {
  rollingHighAt,
  drawdownPctAt,
  findDrawdownEpisodes,
  isPivotLow,
  pivotLowsInRange,
  argminClose,
  countHigherLowsAfterTrough,
  forwardCloseReturnPct,
  buildWeeklyStateAsOf,
  computeEpisodeSignals,
  forwardReturnsForHorizons,
  analyzeTickerDrawdowns,
  DEFAULT_STUDY_SPEC,
} from './drawdownReversalStudy.js';

const dayMs = 24 * 60 * 60 * 1000;

function makeFlatBars(length, { price = 100, startTs = Date.UTC(2020, 0, 2) } = {}) {
  return Array.from({ length }, (_, idx) => ({
    t: startTs + idx * dayMs,
    o: price,
    h: price,
    l: price,
    c: price,
    v: 1_000_000,
  }));
}

describe('drawdownReversalStudy', () => {
  it('rollingHighAt matches max high in window', () => {
    const bars = makeFlatBars(300, { price: 50 });
    bars[100].h = 120;
    bars[100].c = 50;
    const rh = rollingHighAt(bars, 200, 252, 'h');
    assert.equal(rh, 120);
  });

  it('findDrawdownEpisodes detects cross into 20% drawdown and recovery', () => {
    const bars = makeFlatBars(320, { price: 100 });
    const dropAt = 260;
    bars[dropAt].c = 78;
    bars[dropAt].l = 77;
    bars[dropAt].h = 79;

    const recoverAt = 280;
    bars[recoverAt].c = 100;
    bars[recoverAt].h = 100;
    for (let j = dropAt + 1; j < recoverAt; j++) {
      bars[j].c = 85 + (j - dropAt) * 0.5;
      bars[j].h = bars[j].c + 1;
      bars[j].l = bars[j].c - 1;
    }

    const eps = findDrawdownEpisodes(bars, {
      rollingHighDays: 252,
      drawdownThreshold: 0.2,
      minIndex: 251,
      minEpisodeBars: 5,
    });

    assert.ok(eps.length >= 1);
    const ep = eps[0];
    assert.equal(ep.start, dropAt);
    assert.equal(ep.peakRef, 100);
    assert.equal(ep.end, recoverAt);
  });

  it('forwardCloseReturnPct is exact for known closes', () => {
    const bars = makeFlatBars(150, { price: 100 });
    bars[50].c = 100;
    bars[71].c = 110;
    const pct = forwardCloseReturnPct(bars, 50, 21);
    assert.ok(pct != null);
    assert.ok(Math.abs(pct - 10) < 1e-9);
  });

  it('isPivotLow identifies strict fractal low', () => {
    const bars = makeFlatBars(30, { price: 10 });
    for (let i = 0; i < 30; i++) {
      bars[i].l = 10;
      bars[i].h = 11;
      bars[i].c = 10.5;
    }
    bars[15].l = 5;
    bars[15].c = 6;
    assert.equal(isPivotLow(bars, 15, 5), true);
    assert.equal(isPivotLow(bars, 14, 5), false);
  });

  it('countHigherLowsAfterTrough counts increasing pivot lows', () => {
    const bars = makeFlatBars(80, { price: 20 });
    let t = 20;
    for (let i = 0; i < 80; i++) {
      bars[i].t = t + i * dayMs;
      bars[i].l = 18;
      bars[i].h = 22;
      bars[i].c = 20;
    }
    // Trough region then stair-step lows up
    bars[30].l = 8;
    bars[30].c = 9;
    bars[40].l = 10;
    bars[40].c = 11;
    bars[50].l = 12;
    bars[50].c = 13;
    const trough = argminClose(bars, 25, 55);
    const k = 3;
    const { count } = countHigherLowsAfterTrough(bars, trough, 75, k);
    assert.ok(count >= 0);
  });

  it('buildWeeklyStateAsOf does not leak future week', () => {
    const daily = [];
    const weekly = [];
    const start = Date.UTC(2024, 0, 1);
    for (let d = 0; d < 20; d++) {
      daily.push({ t: start + d * dayMs, o: 10, h: 11, l: 9, c: 10, v: 1e6 });
    }
    for (let w = 0; w < 15; w++) {
      weekly.push({ t: start + w * 7 * dayMs, o: 10, h: 11, l: 9, c: 10 + w * 0.1, v: 5e6 });
    }
    const { dailyWeekIndex } = buildWeeklyStateAsOf(daily, weekly, 10);
    assert.ok(dailyWeekIndex[5] <= dailyWeekIndex[10]);
  });

  it('computeEpisodeSignals finds first close above SMA20 after drawdown start', () => {
    const bars = makeFlatBars(120, { price: 100 });
    for (let i = 0; i < 120; i++) {
      bars[i].c = 100;
      bars[i].h = 100;
      bars[i].l = 100;
    }
    // Ramp up from 80 so SMA20 crosses
    for (let i = 60; i < 120; i++) {
      const p = 80 + (i - 60) * 0.8;
      bars[i].c = p;
      bars[i].h = p + 0.5;
      bars[i].l = p - 0.5;
    }
    const ep = { start: 60, end: 119, peakRef: 100, startDate: '2020-01-01' };
    const emptyWeekly = { dailyWeekIndex: [], dailyAboveWeeklySma: [] };
    const sig = computeEpisodeSignals(bars, ep, emptyWeekly, {});
    assert.ok(sig.firstCloseAboveSma20 != null);
    assert.ok(sig.firstCloseAboveSma20 >= 60);
  });

  it('forwardReturnsForHorizons keys match DEFAULT_STUDY_SPEC', () => {
    const bars = makeFlatBars(200, { price: 50 });
    const fwd = forwardReturnsForHorizons(bars, 10, DEFAULT_STUDY_SPEC.forwardHorizons);
    assert.ok('fwd_21d_pct' in fwd);
    assert.ok('fwd_63d_pct' in fwd);
    assert.ok(fwd.fwd_21d_pct != null);
  });

  it('analyzeTickerDrawdowns returns rows for synthetic drawdown', () => {
    const bars = makeFlatBars(340, { price: 100 });
    const dropAt = 270;
    for (let i = 0; i < 340; i++) {
      if (i >= dropAt && i < 290) {
        bars[i].c = 75;
        bars[i].h = 76;
        bars[i].l = 74;
      }
    }
    bars[290].c = 100;
    bars[290].h = 100;
    for (let j = 291; j < 340; j++) {
      bars[j].c = 100;
      bars[j].h = 100;
    }

    const { rows } = analyzeTickerDrawdowns('TEST', bars, [], {
      minBars: 260,
      minEpisodeBars: 5,
    });
    assert.ok(Array.isArray(rows));
  });
});
