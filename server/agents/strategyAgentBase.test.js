import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  blendWeights,
  selectStrategyIndexFromRunCount,
} from './strategyAgentBase.js';

describe('selectStrategyIndexFromRunCount', () => {
  it('keeps rotating strategies beyond 200 runs', () => {
    assert.equal(selectStrategyIndexFromRunCount(200, 8), 0);
    assert.equal(selectStrategyIndexFromRunCount(201, 8), 1);
    assert.equal(selectStrategyIndexFromRunCount(207, 8), 7);
    assert.equal(selectStrategyIndexFromRunCount(208, 8), 0);
  });
});

describe('blendWeights', () => {
  it('moves at least one step when promotion blending is active', () => {
    const control = { slope10MAElite: 10 };
    const variant = { slope10MAElite: 11 };
    const blended = blendWeights(control, variant, 0.1);
    assert.equal(blended.slope10MAElite, 11);
  });

  it('does not change weights when blend factor is zero', () => {
    const control = { slope10MAElite: 10 };
    const variant = { slope10MAElite: 20 };
    const blended = blendWeights(control, variant, 0);
    assert.equal(blended.slope10MAElite, 10);
  });
});
