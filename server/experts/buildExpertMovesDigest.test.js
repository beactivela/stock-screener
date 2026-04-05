import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExpertMovesDigest } from './buildExpertMovesDigest.js';

test('buildExpertMovesDigest ranks larger dollar moves first', () => {
  const popular = [{ ticker: 'AAPL' }, { ticker: 'MSFT' }];
  const expertWeightsByTicker = {
    AAPL: [
      {
        investorSlug: 'a',
        firmName: 'Small Fund',
        displayName: 'SF',
        performance1yPct: null,
        pctOfPortfolio: 5,
        positionValueUsd: 100_000,
        actionType: 'increased',
        actionPct: 10,
        companyName: null,
      },
    ],
    MSFT: [
      {
        investorSlug: 'b',
        firmName: 'Big Fund',
        displayName: 'BF',
        performance1yPct: null,
        pctOfPortfolio: 20,
        positionValueUsd: 5_000_000,
        actionType: 'new_holding',
        actionPct: null,
        companyName: null,
      },
    ],
  };
  const d = buildExpertMovesDigest({ popular, expertWeightsByTicker });
  assert.equal(d.topMoves[0].ticker, 'MSFT');
  assert.equal(d.topMoves[0].firmName, 'Big Fund');
  assert.ok(d.topMoves[0].estIncreaseUsd > d.topMoves[1].estIncreaseUsd);
});

test('buildExpertMovesDigest skips cells with no est. dollar delta', () => {
  const popular = [{ ticker: 'X' }];
  const expertWeightsByTicker = {
    X: [
      {
        investorSlug: 'z',
        firmName: 'Hold Co',
        displayName: 'H',
        performance1yPct: null,
        pctOfPortfolio: 1,
        positionValueUsd: 1e6,
        actionType: 'held',
        actionPct: null,
        companyName: null,
      },
    ],
  };
  const d = buildExpertMovesDigest({ popular, expertWeightsByTicker });
  assert.equal(d.topMoves.length, 0);
});
