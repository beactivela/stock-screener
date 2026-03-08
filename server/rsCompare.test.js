import assert from 'assert';
import { describe, it } from 'node:test';
import { buildCalibrationCurve, calibrateRating } from './rsCompare.js';

describe('buildCalibrationCurve', () => {
  it('sorts by x, de-dupes, and enforces non-decreasing y', () => {
    const curve = buildCalibrationCurve([
      { ourRating: 70, ibdRating: 40 },
      { ourRating: 30, ibdRating: 60 },
      { ourRating: 70, ibdRating: 80 },
      { ourRating: 50, ibdRating: 55 },
    ]);

    assert.ok(curve, 'Expected curve output');
    assert.deepEqual(curve.map((p) => p.x), [30, 50, 70]);
    // 70 had 40 and 80 -> average 60, then monotonic lift to >= prior (55)
    assert.deepEqual(curve.map((p) => p.y), [60, 60, 60]);
  });
});

describe('calibrateRating', () => {
  it('interpolates and clamps to curve endpoints', () => {
    const curve = buildCalibrationCurve([
      { ourRating: 20, ibdRating: 30 },
      { ourRating: 60, ibdRating: 90 },
    ]);

    assert.equal(calibrateRating(10, curve), 30);
    assert.equal(calibrateRating(20, curve), 30);
    assert.equal(calibrateRating(40, curve), 60);
    assert.equal(calibrateRating(60, curve), 90);
    assert.equal(calibrateRating(80, curve), 90);
  });
});
