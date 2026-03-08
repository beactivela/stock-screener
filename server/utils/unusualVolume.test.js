import assert from 'assert';
import { describe, it } from 'node:test';
import { computeUnusualVolume } from './unusualVolume.js';

const makeBars = (count, { baseClose = 10, baseHigh = 10, baseVol = 100 } = {}) => {
  return Array.from({ length: count }, (_, idx) => ({
    c: baseClose + idx * 0.1,
    h: baseHigh + idx * 0.1,
    v: baseVol,
  }));
};

describe('computeUnusualVolume', () => {
  it('returns false when there are not enough bars', () => {
    const bars = makeBars(3);
    const volSma20 = Array(3).fill(null);
    const result = computeUnusualVolume(bars, volSma20);
    assert.deepStrictEqual(result, {
      unusualVolumeToday: false,
      unusualVolume3d: false,
      unusualVolume5d: false,
      priceHigherThan3dAgo: false,
    });
  });

  it('flags unusual volume in last 3 days and higher latest price vs 3 days ago', () => {
    const bars = makeBars(25);
    const volSma20 = Array(25).fill(null);
    for (let i = 19; i < 25; i++) volSma20[i] = 100;

    const lastIdx = bars.length - 1;
    bars[lastIdx].v = 120; // today not unusual
    bars[lastIdx - 1].v = 160; // unusual volume within last 3 days
    bars[lastIdx - 3].c = 10;
    bars[lastIdx].c = 11; // latest price > price 3 days ago

    const result = computeUnusualVolume(bars, volSma20);
    assert.deepStrictEqual(result, {
      unusualVolumeToday: false,
      unusualVolume3d: true,
      unusualVolume5d: true,
      priceHigherThan3dAgo: true,
    });
  });

  it('does not flag unusual volume when spike is older than last 3 days', () => {
    const bars = makeBars(25);
    const volSma20 = Array(25).fill(null);
    for (let i = 19; i < 25; i++) volSma20[i] = 100;

    const lastIdx = bars.length - 1;
    const olderSpikeIdx = bars.length - 4; // outside last 3 bars
    bars[olderSpikeIdx].v = 170;
    bars[lastIdx - 3].c = 10;
    bars[lastIdx].c = 11;

    const result = computeUnusualVolume(bars, volSma20);
    assert.deepStrictEqual(result, {
      unusualVolumeToday: false,
      unusualVolume3d: false,
      unusualVolume5d: false,
      priceHigherThan3dAgo: true,
    });
  });

  it('keeps volume true but price condition false when latest price is not above 3 days ago', () => {
    const bars = makeBars(25);
    const volSma20 = Array(25).fill(null);
    for (let i = 19; i < 25; i++) volSma20[i] = 100;

    const lastIdx = bars.length - 1;
    bars[lastIdx].v = 170; // unusual today
    bars[lastIdx - 3].c = 12;
    bars[lastIdx].c = 11; // latest price <= price 3 days ago

    const result = computeUnusualVolume(bars, volSma20);
    assert.deepStrictEqual(result, {
      unusualVolumeToday: true,
      unusualVolume3d: true,
      unusualVolume5d: true,
      priceHigherThan3dAgo: false,
    });
  });
});
