import { describe, it } from 'node:test';
import assert from 'node:assert';
import { slimExpertMovesDigestForLlm } from './slimExpertMovesDigestForLlm.js';

describe('slimExpertMovesDigestForLlm', () => {
  it('truncates long firm names and keeps numeric fields', () => {
    const digest = {
      summary: { moveCount: 1, topN: 1 },
      topMoves: [
        {
          firmName: 'X'.repeat(400),
          ticker: 'AAPL',
          actionType: 'increased',
          pctOfPortfolio: 5,
          estIncreaseUsd: 1000,
          estDecreaseUsd: null,
          magnitudeUsd: 1000,
          companyName: 'Apple Inc',
        },
      ],
      congressDisclosureLines: [],
    };
    const slim = slimExpertMovesDigestForLlm(digest);
    assert.ok(slim.topMoves[0].firmName.length < 200);
    assert.equal(slim.topMoves[0].ticker, 'AAPL');
    assert.equal(slim.topMoves[0].estIncreaseUsd, 1000);
  });
});
