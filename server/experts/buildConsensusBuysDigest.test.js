import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildConsensusBuysDigest, CONSENSUS_LARGE_POSITION_USD } from './buildConsensusBuysDigest.js';

describe('buildConsensusBuysDigest', () => {
  it('mirrors multi-buy consensus and flags large positions', () => {
    const popular = [{ ticker: 'AAA' }, { ticker: 'BBB' }];
    const expertWeightsByTicker = {
      AAA: [
        {
          investorSlug: 'e1',
          firmName: 'Alpha Fund',
          displayName: 'Alpha',
          performance1yPct: 40,
          actionType: 'increased',
          positionValueUsd: 60_000_000,
          pctOfPortfolio: 5,
          companyName: 'AAA Inc',
        },
        {
          investorSlug: 'e2',
          firmName: 'Beta Fund',
          displayName: 'Beta',
          performance1yPct: 30,
          actionType: 'new_holding',
          positionValueUsd: 10_000_000,
          pctOfPortfolio: 1,
          companyName: 'AAA Inc',
        },
      ],
      BBB: [
        {
          investorSlug: 'e1',
          firmName: 'Alpha Fund',
          displayName: 'Alpha',
          performance1yPct: 40,
          actionType: 'decreased',
          positionValueUsd: 55_000_000,
          pctOfPortfolio: 4,
          companyName: 'BBB Corp',
        },
      ],
    };

    const d = buildConsensusBuysDigest({ popular, expertWeightsByTicker });

    assert.equal(d.consensusMultiBuys.length, 1);
    assert.equal(d.consensusMultiBuys[0].ticker, 'AAA');
    assert.equal(d.consensusMultiBuys[0].buyVotes, 2);
    assert.equal(typeof d.consensusMultiBuys[0].convictionScore, 'number');
    assert.equal(d.meta.topKExperts, 15);
    assert.ok(d.consensusMultiBuys[0].buyers.some((b) => b.largePosition && b.positionValueUsd >= CONSENSUS_LARGE_POSITION_USD));

    assert.equal(d.consensusSells.length, 1);
    assert.equal(d.consensusSells[0].ticker, 'BBB');
    assert.ok(d.largeSellPositions.length >= 1);
    assert.ok(d.largeSellPositions.some((x) => x.ticker === 'BBB' && x.positionValueUsd >= CONSENSUS_LARGE_POSITION_USD));

    assert.equal(d.singleExpertNetBuys.length, 0);
    assert.ok(Array.isArray(d.meta.tickerCatalog));
    assert.ok(d.meta.tickerCatalog.some((x) => x.ticker === 'AAA' && x.bucket === 'strong_consensus_buy'));
    assert.ok(d.meta.tickerCatalog.some((x) => x.ticker === 'BBB' && x.bucket === 'sell_leaning'));
  });

  it('exposes single-expert net buys and catalog entries', () => {
    const popular = [{ ticker: 'ZZZ' }];
    const expertWeightsByTicker = {
      ZZZ: [
        {
          investorSlug: 'e1',
          firmName: 'Solo Fund',
          displayName: 'Solo',
          performance1yPct: 50,
          actionType: 'new_holding',
          positionValueUsd: 5_000_000,
          pctOfPortfolio: 2,
          companyName: 'Zed Inc',
        },
      ],
    };
    const d = buildConsensusBuysDigest({ popular, expertWeightsByTicker });
    assert.equal(d.singleExpertNetBuys.length, 1);
    assert.equal(d.singleExpertNetBuys[0].ticker, 'ZZZ');
    assert.ok(d.meta.tickerCatalog.some((x) => x.ticker === 'ZZZ' && x.bucket === 'single_expert_net_buy'));
  });
});
