import assert from 'node:assert';
import { describe, it } from 'node:test';
import { evaluateCompiledCriteria } from './agentCriteriaRuntime.js';

describe('evaluateCompiledCriteria', () => {
  const signal = {
    relativeStrength: 92,
    ma10Slope14d: 6,
    pctFromHigh: 8,
    unusualVolume3d: true,
    priceHigherThan3dAgo: true,
    turtleBreakout20: false,
    turtleBreakout55: true,
    priceAboveAllMAs: true,
  };

  it('returns true when all criteria pass', () => {
    const pass = evaluateCompiledCriteria(signal, [
      { metric: 'relativeStrength', op: 'gte', value: 85 },
      { metric: 'ma10Slope14d', op: 'gte', value: 5 },
      { metric: 'pctFromHigh', op: 'lte', value: 15 },
    ]);
    assert.equal(pass, true);
  });

  it('returns false when any criterion fails', () => {
    const pass = evaluateCompiledCriteria(signal, [
      { metric: 'relativeStrength', op: 'gte', value: 95 },
      { metric: 'ma10Slope14d', op: 'gte', value: 5 },
    ]);
    assert.equal(pass, false);
  });

  it('supports boolean metrics', () => {
    const pass = evaluateCompiledCriteria(signal, [
      { metric: 'unusualVolume3d', op: 'eq', value: true },
      { metric: 'priceHigherThan3dAgo', op: 'eq', value: true },
      { metric: 'turtleBreakout20or55', op: 'eq', value: true },
    ]);
    assert.equal(pass, true);
  });
});
