/**
 * Conversation signal source selection tests
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolveSignalFromCache } from './conversationSignalSource.js';

describe('resolveSignalFromCache', () => {
  const cache = [
    { ticker: 'NVDA', opus45Confidence: 88 },
    { ticker: 'AAPL', opus45Confidence: 72 },
  ];

  it('returns matching ticker when provided', () => {
    const result = resolveSignalFromCache({ ticker: 'nvda', cachedSignals: cache });
    assert.equal(result?.ticker, 'NVDA');
  });

  it('returns first signal when no ticker provided', () => {
    const result = resolveSignalFromCache({ cachedSignals: cache });
    assert.equal(result?.ticker, 'NVDA');
  });

  it('returns null when cache is empty', () => {
    const result = resolveSignalFromCache({ cachedSignals: [] });
    assert.equal(result, null);
  });
});
