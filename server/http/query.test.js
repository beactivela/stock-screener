import assert from 'node:assert';
import { describe, it } from 'node:test';

import { getDefaultDateRange, parseBooleanQuery, parseCsvQuery } from './query.js';

describe('parseCsvQuery', () => {
  it('returns null for empty values', () => {
    assert.equal(parseCsvQuery(undefined), null);
    assert.equal(parseCsvQuery('  '), null);
  });

  it('parses comma-separated strings and trims tokens', () => {
    assert.deepEqual(parseCsvQuery('a, b,  c'), ['a', 'b', 'c']);
  });

  it('flattens repeated query params arrays', () => {
    assert.deepEqual(parseCsvQuery(['a,b', ' c ']), ['a', 'b', 'c']);
  });
});

describe('parseBooleanQuery', () => {
  it('supports true-like values', () => {
    assert.equal(parseBooleanQuery('1'), true);
    assert.equal(parseBooleanQuery('YES'), true);
    assert.equal(parseBooleanQuery('on'), true);
  });

  it('supports false-like values', () => {
    assert.equal(parseBooleanQuery('0', true), false);
    assert.equal(parseBooleanQuery('NO', true), false);
    assert.equal(parseBooleanQuery('off', true), false);
  });

  it('returns default when value is unknown or missing', () => {
    assert.equal(parseBooleanQuery(undefined, true), true);
    assert.equal(parseBooleanQuery('maybe', false), false);
  });
});

describe('getDefaultDateRange', () => {
  it('returns yyyy-mm-dd start/end and start <= end', () => {
    const { startDate, endDate } = getDefaultDateRange(2);
    assert.match(startDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(endDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(startDate <= endDate);
  });
});
