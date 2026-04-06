import { describe, it } from 'node:test';
import assert from 'node:assert';
import { filterConsensusDigestToStrongBuysOnly } from './filterConsensusDigestToStrongBuysOnly.js';

describe('filterConsensusDigestToStrongBuysOnly', () => {
  it('drops non-strong buckets and keeps consensus multi-buys + large buy refs', () => {
    const d = filterConsensusDigestToStrongBuysOnly({
      meta: { note: 'n' },
      consensusMultiBuys: [{ ticker: 'A' }],
      singleExpertNetBuys: [{ ticker: 'B' }],
      consensusSells: [{ ticker: 'C' }],
      mixedNetZero: [{ ticker: 'D' }],
      largeBuyPositions: [{ ticker: 'A', firmName: 'F' }],
      largeSellPositions: [{ ticker: 'Z' }],
    });
    assert.deepStrictEqual(d.consensusMultiBuys, [{ ticker: 'A' }]);
    assert.deepStrictEqual(d.singleExpertNetBuys, []);
    assert.deepStrictEqual(d.consensusSells, []);
    assert.deepStrictEqual(d.mixedNetZero, []);
    assert.deepStrictEqual(d.largeBuyPositions, [{ ticker: 'A', firmName: 'F' }]);
    assert.deepStrictEqual(d.largeSellPositions, []);
    assert.ok(String(d.meta.llmScope).includes('Strong buys'));
  });
});
