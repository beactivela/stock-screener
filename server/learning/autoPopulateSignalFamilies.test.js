/**
 * Unit tests for signalFamilies normalization
 * Run: node --test server/learning/autoPopulateSignalFamilies.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';

import { normalizeSignalFamilies } from './autoPopulate.js';

describe('normalizeSignalFamilies', () => {
  it('defaults to opus45 when input missing', () => {
    assert.deepStrictEqual(normalizeSignalFamilies(), ['opus45']);
  });

  it('accepts a string input', () => {
    assert.deepStrictEqual(normalizeSignalFamilies('turtle'), ['turtle']);
  });

  it('filters and de-dupes arrays', () => {
    assert.deepStrictEqual(normalizeSignalFamilies(['opus45', 'turtle', 'opus45', 'bad']), ['opus45', 'turtle']);
  });
});

console.log('Run tests with: node --test server/learning/autoPopulateSignalFamilies.test.js');
