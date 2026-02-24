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

  it('matches 10/20 cross over criteria', () => {
    const setups = classifySignalSetups({
      ...baseSignal,
      ma10Above20: true,
      signalFamily: 'ma_crossover',
    });
    assert.ok(byId(setups).has('ma_crossover_10_20'));
  });

  it('matches Unusual Volume criteria', () => {
    const setups = classifySignalSetups({
      ...baseSignal,
      unusualVolume5d: true,
    });
    assert.ok(byId(setups).has('unusual_vol'));
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
      { ...baseSignal, ma10Above20: false },
      {
        ...baseSignal,
        ma10Above20: true,
        signalFamily: 'ma_crossover',
      },
    ];
    const setups = classifySignalSetupsRecent(snapshots);
    assert.ok(byId(setups).has('ma_crossover_10_20'));
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
