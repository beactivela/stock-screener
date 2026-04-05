import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  slimConsensusDigestForLlm,
  slimConsensusDigestForLlmWithBudget,
  buildSlimConsensusDigestAtCaps,
} from './slimConsensusDigestForLlm.js';

describe('slimConsensusDigestForLlm', () => {
  it('caps buyer/seller refs per row (main context saver)', () => {
    const buyers = [];
    for (let i = 0; i < 24; i++) {
      buyers.push({
        firmName: `Fund ${i}`,
        positionValueUsd: 1e6,
        pctOfPortfolio: 1,
        actionType: 'increased',
        largePosition: false,
      });
    }
    const digest = {
      meta: { note: 'x' },
      consensusMultiBuys: [
        {
          ticker: 'ZZ',
          companyName: 'Z',
          buyVotes: 24,
          sellVotes: 0,
          net: 24,
          convictionScore: 99,
          buyers,
          sellers: [],
        },
      ],
      singleExpertNetBuys: [],
      consensusSells: [],
      mixedNetZero: [],
      largeBuyPositions: [],
      largeSellPositions: [],
    };
    const slim = slimConsensusDigestForLlm(digest);
    assert.equal(slim.consensusMultiBuys[0].buyers.length, 8);
  });

  it('caps row counts and strips verbose expert fields', () => {
    const mkRow = (ticker, score) => ({
      ticker,
      companyName: `${ticker} Co`,
      buyVotes: 2,
      sellVotes: 0,
      net: 2,
      convictionScore: score,
      convictionFactors: { a: 1 },
      buyers: [
        {
          investorSlug: 's1',
          firmName: 'F',
          displayName: 'D',
          positionValueUsd: 1e6,
          pctOfPortfolio: 2,
          actionType: 'increased',
          largePosition: false,
          isTopHolding: true,
        },
      ],
      sellers: [],
    });

    const many = [];
    for (let i = 0; i < 120; i++) {
      many.push(mkRow(`T${i}`, i));
    }

    const digest = {
      meta: { note: 'x' },
      consensusMultiBuys: many,
      singleExpertNetBuys: [],
      consensusSells: [],
      mixedNetZero: [],
      largeBuyPositions: [],
      largeSellPositions: [],
    };

    const prev = process.env.EXPERTS_CONSENSUS_LLM_MAX_MULTI;
    process.env.EXPERTS_CONSENSUS_LLM_MAX_MULTI = '10';
    try {
      const slim = slimConsensusDigestForLlm(digest);
      assert.equal(slim.consensusMultiBuys.length, 10);
      const b0 = slim.consensusMultiBuys[0].buyers[0];
      assert.equal(b0.investorSlug, undefined);
      assert.equal(b0.displayName, undefined);
      assert.equal(b0.firmName, 'F');
      assert.ok(slim.meta.llmTruncation);
    } finally {
      if (prev === undefined) delete process.env.EXPERTS_CONSENSUS_LLM_MAX_MULTI;
      else process.env.EXPERTS_CONSENSUS_LLM_MAX_MULTI = prev;
    }
  });

  it('shrinks iteratively when JSON exceeds byte budget', () => {
    const mkRow = (ticker, score, nBuyers) => {
      const buyers = [];
      for (let i = 0; i < nBuyers; i++) {
        buyers.push({
          firmName: `Very Long Fund Name Number ${i} `.repeat(8),
          positionValueUsd: 1e6,
          pctOfPortfolio: 1,
          actionType: 'increased',
          largePosition: false,
        });
      }
      return {
        ticker,
        companyName: `${ticker} Co`,
        buyVotes: 2,
        sellVotes: 0,
        net: 2,
        convictionScore: score,
        buyers,
        sellers: [],
      };
    };
    const many = [];
    for (let i = 0; i < 40; i++) {
      many.push(mkRow(`T${i}`, i, 12));
    }
    const digest = {
      meta: { note: 'x' },
      consensusMultiBuys: many,
      singleExpertNetBuys: [],
      consensusSells: [],
      mixedNetZero: [],
      largeBuyPositions: [],
      largeSellPositions: [],
    };
    const slim = slimConsensusDigestForLlmWithBudget(digest, 8000);
    assert.ok(JSON.stringify(slim).length <= 8000);
    assert.ok(slim.consensusMultiBuys.length < 40);
  });

  it('buildSlimConsensusDigestAtCaps respects explicit caps', () => {
    const digest = {
      meta: {},
      consensusMultiBuys: [{ ticker: 'A', convictionScore: 1, buyers: [], sellers: [] }],
      singleExpertNetBuys: [],
      consensusSells: [],
      mixedNetZero: [],
      largeBuyPositions: [],
      largeSellPositions: [],
    };
    const slim = buildSlimConsensusDigestAtCaps(digest, {
      maxMulti: 0,
      maxSingle: 0,
      maxSells: 0,
      maxMixed: 0,
      maxLarge: 0,
      maxRefsPerRow: 4,
      maxExpertNameLen: 40,
    });
    assert.equal(slim.consensusMultiBuys.length, 0);
  });
});
