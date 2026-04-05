import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  collectAllowedTickersFromSlimDigest,
  findDisallowedTickerMentions,
} from './consensusBuysAllowlists.js';

describe('collectAllowedTickersFromSlimDigest', () => {
  it('collects tickers from rows, large positions, and tickerCatalog', () => {
    const slim = {
      meta: {
        tickerCatalog: [{ ticker: 'ZZZ', bucket: 'x' }],
      },
      consensusMultiBuys: [{ ticker: 'aapl' }],
      singleExpertNetBuys: [],
      consensusSells: [{ ticker: 'MSFT' }],
      mixedNetZero: [],
      largeBuyPositions: [{ ticker: 'nvda' }],
      largeSellPositions: [{ ticker: 'TSLA' }],
    };
    assert.deepStrictEqual(collectAllowedTickersFromSlimDigest(slim), [
      'AAPL',
      'MSFT',
      'NVDA',
      'TSLA',
      'ZZZ',
    ]);
  });
});

describe('findDisallowedTickerMentions', () => {
  it('flags parenthetical and standalone symbols not in allowlist', () => {
    const allowed = ['AAPL', 'MSFT'];
    const text =
      'Bought Invesco (RSP) and Microsoft (MSFT). Duquesne likes Apple (AAPL) and coal (HCC).';
    assert.deepStrictEqual(findDisallowedTickerMentions(text, allowed), ['HCC', 'RSP']);
  });

  it('ignores NYSE in parentheses', () => {
    assert.deepStrictEqual(
      findDisallowedTickerMentions('Listed on (NYSE). Buy (AAPL).', ['AAPL']),
      []
    );
  });

  it('ignores common ALL CAPS words', () => {
    assert.deepStrictEqual(
      findDisallowedTickerMentions('THE AND FOR BUT ARE NOT IN THE DATA', ['ZZZ']),
      []
    );
  });
});
