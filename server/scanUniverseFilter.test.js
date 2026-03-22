import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildUppercaseTickerUniverseSet, filterScanResultsToTickerUniverse } from './scanUniverseFilter.js';

describe('scanUniverseFilter', () => {
  it('buildUppercaseTickerUniverseSet uppercases and trims', () => {
    const s = buildUppercaseTickerUniverseSet([' aapl ', 'MSFT', 'brk.b']);
    assert.ok(s.has('AAPL'));
    assert.ok(s.has('MSFT'));
    assert.ok(s.has('BRK.B'));
    assert.equal(s.size, 3);
  });

  it('filterScanResultsToTickerUniverse matches scan rows when universe is lowercase in DB', () => {
    const universe = buildUppercaseTickerUniverseSet(['aapl', 'msft']);
    const rows = [
      { ticker: 'AAPL', score: 1 },
      { ticker: 'MSFT', score: 2 },
      { ticker: 'NVDA', score: 3 },
    ];
    const out = filterScanResultsToTickerUniverse(rows, universe);
    assert.equal(out.length, 2);
    assert.equal(out.map((r) => r.ticker).join(','), 'AAPL,MSFT');
  });

  it('empty universe set skips filtering (show all scan rows)', () => {
    const out = filterScanResultsToTickerUniverse([{ ticker: 'X' }], new Set());
    assert.equal(out.length, 1);
  });
});
