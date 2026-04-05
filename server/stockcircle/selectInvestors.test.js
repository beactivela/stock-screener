import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isMissingMultiYearPerformanceColumnError } from './selectInvestors.js';

describe('isMissingMultiYearPerformanceColumnError', () => {
  it('detects Postgres missing column message', () => {
    assert.equal(
      isMissingMultiYearPerformanceColumnError({
        message: 'column stockcircle_investors.performance_3y_pct does not exist',
      }),
      true
    );
  });

  it('returns false for unrelated errors', () => {
    assert.equal(isMissingMultiYearPerformanceColumnError({ message: 'connection refused' }), false);
  });
});
