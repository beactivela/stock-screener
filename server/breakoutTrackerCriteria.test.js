import assert from 'assert';
import { describe, it } from 'node:test';
import { evaluateBreakoutTrackerStudy, matchesBreakoutTrackerStudy } from './breakoutTrackerCriteria.js';

describe('evaluateBreakoutTrackerStudy', () => {
  it('passes when study-aligned fields match (legacy 20d volume)', () => {
    const r = evaluateBreakoutTrackerStudy({
      signalFamily: 'opus45',
      relativeStrength: 85,
      pctFromHigh: 6,
      lastClose: 120,
      breakoutVolumeRatio: 1.3,
      breakoutVolumeRatio50: null,
      minClose20d: 95,
      aboveSma20: true,
      aboveSma50: true,
      aboveSma100: true,
    });
    assert.strictEqual(r.passes, true);
    assert.ok(
      matchesBreakoutTrackerStudy({
        signalFamily: 'opus45',
        relativeStrength: 85,
        pctFromHigh: 6,
        lastClose: 120,
        breakoutVolumeRatio: 1.3,
        minClose20d: 95,
        aboveSma20: true,
        aboveSma50: true,
        aboveSma100: true,
      }),
    );
  });

  it('passes with 50d volume ratio >= 1.5', () => {
    const r = evaluateBreakoutTrackerStudy({
      signalFamily: 'opus45',
      relativeStrength: 82,
      pctFromHigh: 4,
      lastClose: 45,
      breakoutVolumeRatio: 0.9,
      breakoutVolumeRatio50: 1.6,
      minClose20d: 40,
      aboveSma20: true,
      aboveSma50: true,
      aboveSma100: true,
    });
    assert.strictEqual(r.passes, true);
  });

  it('fails when 20d volume is below fallback and 50d missing', () => {
    const r = evaluateBreakoutTrackerStudy({
      relativeStrength: 90,
      pctFromHigh: 3,
      lastClose: 100,
      breakoutVolumeRatio: 1.0,
      breakoutVolumeRatio50: null,
    });
    assert.strictEqual(r.passes, false);
    assert.strictEqual(r.checks.volOk, false);
  });

  it('fails when min close 20d under $10', () => {
    const r = evaluateBreakoutTrackerStudy({
      relativeStrength: 85,
      pctFromHigh: 5,
      minClose20d: 8,
      lastClose: 50,
      breakoutVolumeRatio: 1.4,
      aboveSma20: true,
      aboveSma50: true,
      aboveSma100: true,
    });
    assert.strictEqual(r.passes, false);
    assert.strictEqual(r.checks.minPriceOk, false);
  });

  it('fails when price not above SMA50', () => {
    const r = evaluateBreakoutTrackerStudy({
      relativeStrength: 85,
      pctFromHigh: 5,
      lastClose: 50,
      minClose20d: 48,
      breakoutVolumeRatio: 1.3,
      aboveSma20: true,
      aboveSma50: false,
      aboveSma100: true,
    });
    assert.strictEqual(r.passes, false);
    assert.strictEqual(r.checks.trendOk, false);
  });
});
