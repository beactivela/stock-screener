import assert from 'node:assert';
import { describe, it } from 'node:test';
import { translateCriteriaLines } from './criteriaTranslator.js';

describe('translateCriteriaLines', () => {
  it('translates unusual volume criteria into executable metrics', () => {
    const result = translateCriteriaLines('unusual_vol', [
      'Unusual volume in last 3 days (volume vs 20-day average)',
      'Latest price higher than price 3 days ago',
    ]);

    assert.deepStrictEqual(result.compiledCriteria, [
      { metric: 'unusualVolume3d', op: 'eq', value: true },
      { metric: 'priceHigherThan3dAgo', op: 'eq', value: true },
    ]);
    assert.deepStrictEqual(result.unsupported, []);
  });

  it('translates momentum-style numeric thresholds', () => {
    const result = translateCriteriaLines('momentum_scout', [
      'Relative Strength >= 85',
      '10 MA slope (14d) >= 5',
      'Within 15% of 52-week high',
    ]);

    assert.deepStrictEqual(result.compiledCriteria, [
      { metric: 'relativeStrength', op: 'gte', value: 85 },
      { metric: 'ma10Slope14d', op: 'gte', value: 5 },
      { metric: 'pctFromHigh', op: 'lte', value: 15 },
    ]);
    assert.deepStrictEqual(result.unsupported, []);
  });

  it('collects unsupported criteria text when no parser match exists', () => {
    const result = translateCriteriaLines('base_hunter', [
      'News sentiment score above 80',
      'Pattern confidence >= 65%',
    ]);

    assert.deepStrictEqual(result.compiledCriteria, [
      { metric: 'patternConfidence', op: 'gte', value: 65 },
    ]);
    assert.deepStrictEqual(result.unsupported, ['News sentiment score above 80']);
  });
});
