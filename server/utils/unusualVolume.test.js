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
    const bars = makeBars(5);
    const volSma20 = Array(5).fill(null);
    const result = computeUnusualVolume(bars, volSma20);
    assert.deepStrictEqual(result, { unusualVolumeToday: false, unusualVolume5d: false });
  });

  it('flags today when volume and price conditions are met', () => {
    const bars = makeBars(25);
    const volSma20 = Array(25).fill(null);
    for (let i = 19; i < 25; i++) volSma20[i] = 100;

    const lastIdx = bars.length - 1;
    bars[lastIdx - 1].h = 10;
    bars[lastIdx].c = 11;
    bars[lastIdx].v = 150;

    const result = computeUnusualVolume(bars, volSma20);
    assert.deepStrictEqual(result, { unusualVolumeToday: true, unusualVolume5d: true });
  });

  it('flags last 5 days even if today is not a match', () => {
    const bars = makeBars(25);
    const volSma20 = Array(25).fill(null);
    for (let i = 19; i < 25; i++) volSma20[i] = 100;

    const matchIdx = bars.length - 5;
    bars[matchIdx - 1].h = 10;
    bars[matchIdx].c = 11;
    bars[matchIdx].v = 150;

    const result = computeUnusualVolume(bars, volSma20);
    assert.deepStrictEqual(result, { unusualVolumeToday: false, unusualVolume5d: true });
  });
});
