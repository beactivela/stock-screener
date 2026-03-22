import assert from 'assert';
import { describe, it } from 'node:test';
import {
  computeLancePreTrade,
  shouldIncludeLanceInSignalSetups,
  lanceScoreSortRank,
} from './lanceBreitstein.js';

function barsFromCloses(closes) {
  return closes.map((c, i) => ({ t: i * 86400, c, h: c, l: c, v: 1e6 }));
}

const baseRow = {
  ticker: 'TEST',
  lastClose: 100,
  sma10: 98,
  atMa10: false,
  atMa20: false,
  atMa50: true,
  idealPullbackSetup: false,
  ma10Slope14d: 8,
  pctFromHigh: 8,
  breakoutVolumeRatio: 1.3,
  relativeStrength: 88,
};

describe('computeLancePreTrade', () => {
  it('returns insufficientData when fewer than 5 bars', () => {
    const bars = barsFromCloses([99, 100, 101]);
    const r = computeLancePreTrade(baseRow, bars);
    assert.equal(r.insufficientData, true);
    assert.equal(r.score, null);
  });

  it('scores A+ for strong alignment (FAST, HIGH ROC, STRONG RS, A location)', () => {
    const closes = [
      ...Array(20).fill(92),
      93,
      94,
      95,
      96,
      97,
      98,
      99,
      100,
      102,
      105,
      108,
    ];
    const bars = barsFromCloses(closes);
    const row = {
      ...baseRow,
      lastClose: 108,
      sma10: 102,
      atMa50: true,
      ma10Slope14d: 9,
      pctFromHigh: 4,
      breakoutVolumeRatio: 1.4,
      relativeStrength: 92,
    };
    const r = computeLancePreTrade(row, bars);
    assert.equal(r.insufficientData, false);
    assert.equal(r.score, 'A+');
    assert.equal(r.timeBehavior, 'FAST');
    assert.equal(r.rateOfChange, 'HIGH');
    assert.equal(r.relativeStrength, 'STRONG');
    assert.equal(r.location, 'A');
    assert.equal(r.actionable, true);
    assert.equal(r.sizeHint, 'aggressive');
  });

  it('scores D for weak RS, slow tape, and poor location', () => {
    const closes = [...Array(25).fill(100), 100.1, 100.05, 100.02, 99.9, 99.85];
    const bars = barsFromCloses(closes);
    const row = {
      ...baseRow,
      lastClose: 99.85,
      sma10: 100.2,
      atMa10: false,
      atMa20: false,
      atMa50: false,
      ma10Slope14d: 0.5,
      pctFromHigh: 2,
      breakoutVolumeRatio: 0.7,
      relativeStrength: 42,
    };
    const r = computeLancePreTrade(row, bars);
    assert.equal(r.score, 'D');
    assert.equal(r.actionable, false);
    assert.equal(r.sizeHint, 'avoid');
  });

  it('maps mid-pack stats to B or C (not A+)', () => {
    const closes = [...Array(22).fill(95), 96, 97, 98, 99, 100, 100.5];
    const bars = barsFromCloses(closes);
    const row = {
      ...baseRow,
      lastClose: 100.5,
      sma10: 99,
      atMa10: false,
      atMa20: true,
      atMa50: false,
      ma10Slope14d: 4,
      pctFromHigh: 14,
      breakoutVolumeRatio: 1.05,
      relativeStrength: 72,
    };
    const r = computeLancePreTrade(row, bars);
    assert.ok(['B', 'C'].includes(r.score));
  });
});

describe('shouldIncludeLanceInSignalSetups', () => {
  it('includes when scored and not D', () => {
    assert.equal(shouldIncludeLanceInSignalSetups({ score: 'A', insufficientData: false }), true);
    assert.equal(shouldIncludeLanceInSignalSetups({ score: 'D', insufficientData: false }), false);
    assert.equal(shouldIncludeLanceInSignalSetups({ score: null, insufficientData: true }), false);
  });
});

describe('lanceScoreSortRank', () => {
  it('orders A+ above A above B…', () => {
    assert.ok(lanceScoreSortRank('A+') > lanceScoreSortRank('A'));
    assert.ok(lanceScoreSortRank('A') > lanceScoreSortRank('B'));
    assert.ok(lanceScoreSortRank('B') > lanceScoreSortRank('C'));
    assert.ok(lanceScoreSortRank('C') > lanceScoreSortRank('D'));
  });
});
