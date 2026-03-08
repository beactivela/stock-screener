import assert from 'assert';
import { describe, it } from 'node:test';
import { classifySignalSetups, classifySignalSetupsRecent } from './signalSetupClassifier.js';

const baseSignal = {
  ticker: 'TEST',
};

const byId = (arr) => new Set(arr);

describe('classifySignalSetups', () => {
  it('matches Momentum Scout criteria', () => {
    const setups = classifySignalSetups({
      ...baseSignal,
      relativeStrength: 90,
      ma10Slope14d: 8,
      pctFromHigh: 10,
      signalFamily: 'opus45',
    });
    assert.ok(byId(setups).has('momentum_scout'));
  });

  it('matches Base Hunter criteria', () => {
    const setups = classifySignalSetups({
      ...baseSignal,
      contractions: 4,
      patternConfidence: 70,
      volumeDryUp: true,
      signalFamily: 'opus45',
    });
    assert.ok(byId(setups).has('base_hunter'));
  });

  it('matches Breakout Tracker criteria', () => {
    const setups = classifySignalSetups({
      ...baseSignal,
      pctFromHigh: 6,
      relativeStrength: 85,
      breakoutVolumeRatio: 1.3,
      signalFamily: 'opus45',
    });
    assert.ok(byId(setups).has('breakout_tracker'));
  });

  it('matches Turtle Trader criteria', () => {
    const setups = classifySignalSetups({
      ...baseSignal,
      turtleBreakout20: true,
      turtleBreakout55: false,
      priceAboveAllMAs: true,
      ma200Rising: true,
      relativeStrength: 88,
      signalFamily: 'turtle',
    });
    assert.ok(byId(setups).has('turtle_trader'));
  });

  it('matches Unusual Volume criteria', () => {
    const setups = classifySignalSetups({
      ...baseSignal,
      unusualVolume3d: true,
      priceHigherThan3dAgo: true,
    });
    assert.ok(byId(setups).has('unusual_vol'));
  });

  it('does not match Unusual Volume when latest price is not above 3 days ago', () => {
    const setups = classifySignalSetups({
      ...baseSignal,
      unusualVolume3d: true,
      priceHigherThan3dAgo: false,
    });
    assert.ok(!byId(setups).has('unusual_vol'));
  });

  it('returns empty array when criteria missing', () => {
    const setups = classifySignalSetups({
      ...baseSignal,
      relativeStrength: 70,
      ma10Slope14d: 2,
      pctFromHigh: 40,
      signalFamily: 'opus45',
    });
    assert.deepStrictEqual(setups, []);
  });
});

describe('classifySignalSetupsRecent', () => {
  it('matches when any of last 3 bars trigger', () => {
    const snapshots = [
      { ...baseSignal, relativeStrength: 70 },
      { ...baseSignal, unusualVolume3d: false },
      {
        ...baseSignal,
        unusualVolume3d: true,
        priceHigherThan3dAgo: true,
      },
    ];
    const setups = classifySignalSetupsRecent(snapshots);
    assert.ok(byId(setups).has('unusual_vol'));
  });

  it('ignores triggers older than last 3 bars', () => {
    const snapshots = [
      {
        ...baseSignal,
        unusualVolume5d: true,
      },
      { ...baseSignal },
      { ...baseSignal },
      { ...baseSignal },
    ];
    const setups = classifySignalSetupsRecent(snapshots);
    assert.ok(!byId(setups).has('unusual_vol'));
  });

  it('can include triggers within last 5 bars when lookbackBars=5', () => {
    const snapshots = [
      {
        ...baseSignal,
        signalFamily: 'turtle',
        turtleBreakout20: true,
        priceAboveAllMAs: true,
        ma200Rising: true,
        relativeStrength: 90,
      },
      { ...baseSignal },
      { ...baseSignal },
      { ...baseSignal },
      { ...baseSignal },
    ];
    const setups = classifySignalSetupsRecent(snapshots, 5);
    assert.ok(byId(setups).has('turtle_trader'));
  });

  it('dedupes multiple triggers across last 3 bars', () => {
    const snapshots = [
      {
        ...baseSignal,
        signalFamily: 'opus45',
        relativeStrength: 90,
        ma10Slope14d: 8,
        pctFromHigh: 10,
      },
      {
        ...baseSignal,
        signalFamily: 'opus45',
        relativeStrength: 92,
        ma10Slope14d: 7,
        pctFromHigh: 12,
      },
    ];
    const setups = classifySignalSetupsRecent(snapshots);
    assert.deepStrictEqual(setups, ['momentum_scout']);
  });
});
