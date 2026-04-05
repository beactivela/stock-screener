import test from 'node:test';
import assert from 'node:assert/strict';
import { fmpResponseIsPlanError } from './fmpClient.js';

test('fmpResponseIsPlanError detects subscription messages', () => {
  assert.equal(fmpResponseIsPlanError('Restricted Endpoint: upgrade'), true);
  assert.equal(fmpResponseIsPlanError('Premium Query Parameter: limit'), true);
  assert.equal(fmpResponseIsPlanError([{ symbol: 'AAPL' }]), false);
  assert.equal(fmpResponseIsPlanError(null), false);
});
