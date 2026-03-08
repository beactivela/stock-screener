import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getScanPersistenceStrategy, shouldPersistCheckpoint } from './scanPersistence.js';

describe('scan persistence strategy', () => {
  it('defaults to stream_batches and guards unknown values', () => {
    assert.equal(getScanPersistenceStrategy(), 'stream_batches');
    assert.equal(getScanPersistenceStrategy('unexpected'), 'stream_batches');
  });

  it('final_only persists only on final checkpoint', () => {
    const total = 100;
    assert.equal(
      shouldPersistCheckpoint({ index: 25, total, strategy: 'final_only' }),
      false
    );
    assert.equal(
      shouldPersistCheckpoint({ index: total, total, strategy: 'final_only' }),
      true
    );
  });

  it('stream_batches persists each batch boundary and final checkpoint', () => {
    const total = 55;
    assert.equal(
      shouldPersistCheckpoint({ index: 19, total, strategy: 'stream_batches', batchSize: 20 }),
      false
    );
    assert.equal(
      shouldPersistCheckpoint({ index: 20, total, strategy: 'stream_batches', batchSize: 20 }),
      true
    );
    assert.equal(
      shouldPersistCheckpoint({ index: total, total, strategy: 'stream_batches', batchSize: 20 }),
      true
    );
  });
});
