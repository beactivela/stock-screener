import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSortedExpertUniverse,
  computeTickerConsensusRows,
  CONSENSUS_LARGE_BUY_USD,
  isConsensusLargeBuyChip,
  splitConsensusByNet,
  sortConsensusTickerRows,
  sumConsensusBuyerPositionUsd,
  sumConsensusSellerPositionUsd,
  sumConsensusTotalPositionUsd,
  netConsensusPositionUsd,
  blendedPerformanceMetric,
  computeConvictionComposite,
  syncFreshnessLabel,
  buildExpertMaxPctByPortfolio,
  DEFAULT_CONSENSUS_TOP_K_CAP,
} from './expertConsensus.ts'

const base = {
  firmName: 'F',
  displayName: 'D',
  performance1yPct: 0,
  actionType: 'increased',
}

function w(overrides) {
  return { ...base, ...overrides }
}

function row(ticker, overrides = {}) {
  return {
    ticker,
    buyVotes: 0,
    sellVotes: 0,
    net: 0,
    weightedBuy: 0,
    weightedSell: 0,
    weightedNet: 0,
    buyers: [],
    sellers: [],
    effectiveTopK: 10,
    avgBuyerPctOfPortfolio: null,
    avgSellerPctOfPortfolio: null,
    convictionScore: 0,
    convictionScoreBeforeCrossSource: 0,
    convictionFactors: {
      overlapBreadth: 0,
      positionConviction: 0,
      performanceSignal: 0,
      actionStrength: 0,
    },
    crossSourceWhalewisdom: false,
    crossSourceCongress: false,
    ...overrides,
  }
}

test('buildSortedExpertUniverse orders by 1Y perf desc; nulls last', () => {
  const popular = [{ ticker: 'AAA' }]
  const weights = {
    AAA: [
      w({ investorSlug: 'z', firmName: 'Z', performance1yPct: 10, actionType: 'increased' }),
      w({ investorSlug: 'a', firmName: 'A', performance1yPct: null, actionType: 'increased' }),
      w({ investorSlug: 'm', firmName: 'M', performance1yPct: 40, actionType: 'increased' }),
    ],
  }
  const u = buildSortedExpertUniverse(popular, weights, { sortByBlendedPerformance: false })
  assert.deepEqual(
    u.map((x) => x.investorSlug),
    ['m', 'z', 'a']
  )
})

test('computeTickerConsensusRows: topK=2 only counts first two experts by rank', () => {
  const popular = [{ ticker: 'T1' }, { ticker: 'T2' }]
  const weights = {
    T1: [
      w({ investorSlug: 'high', performance1yPct: 90, actionType: 'increased' }),
      w({ investorSlug: 'mid', performance1yPct: 50, actionType: 'sold', actionPct: 50 }),
      w({ investorSlug: 'low', performance1yPct: 25, actionType: 'increased' }),
    ],
    T2: [w({ investorSlug: 'low', performance1yPct: 25, actionType: 'increased' })],
  }
  // Universe order: high 90, mid 50, low 25 → topK=2 → high, mid only
  const rows = computeTickerConsensusRows(popular, weights, {
    topK: 2,
    minVotes: 1,
    weightByPerformance: false,
    sortExpertsByBlendedPerformance: false,
    useBlendedPerformanceForVoteWeight: false,
    useActionStrengthInWeightedTallies: false,
  })
  const t1 = rows.find((r) => r.ticker === 'T1')
  assert.ok(t1)
  assert.equal(t1.buyVotes, 1)
  assert.equal(t1.sellVotes, 1)
  assert.equal(t1.net, 0)
  assert.equal(t1.effectiveTopK, 2)
  // T2 only has `low` (25%); topK=2 selects high+mid — no selected expert on T2 → row omitted (minVotes)
  assert.equal(rows.find((r) => r.ticker === 'T2'), undefined)
})

test('splitConsensusByNet sorts buys and sells', () => {
  const rows = [
    row('C', { buyVotes: 2, sellVotes: 0, net: 2, weightedBuy: 2, weightedSell: 0, weightedNet: 2 }),
    row('A', { buyVotes: 3, sellVotes: 0, net: 3, weightedBuy: 3, weightedSell: 0, weightedNet: 3 }),
    row('Z', { buyVotes: 0, sellVotes: 2, net: -2, weightedBuy: 0, weightedSell: 2, weightedNet: -2 }),
    row('M', { buyVotes: 1, sellVotes: 1, net: 0, weightedBuy: 1, weightedSell: 1, weightedNet: 0 }),
  ]
  const { buyLeaning, sellLeaning, mixed } = splitConsensusByNet(rows)
  assert.deepEqual(
    buyLeaning.map((r) => r.ticker),
    ['A', 'C']
  )
  assert.deepEqual(sellLeaning.map((r) => r.ticker), ['Z'])
  assert.deepEqual(mixed.map((r) => r.ticker), ['M'])
})

test('splitConsensusByNet buy-lean: primary buyVotes, then sum of buy-side $', () => {
  const mk = (ticker, buyVotes, sellVotes, buyers) =>
    row(ticker, {
      buyVotes,
      sellVotes,
      net: buyVotes - sellVotes,
      weightedBuy: buyVotes,
      weightedSell: sellVotes,
      weightedNet: buyVotes - sellVotes,
      buyers,
      sellers: [],
    })
  const rows = [
    mk('LowerNetMoreBuys', 3, 2, [
      { positionValueUsd: 1e6 },
      { positionValueUsd: 1e6 },
      { positionValueUsd: 1e6 },
    ]),
    mk('HigherNetFewerBuys', 2, 0, [
      { positionValueUsd: 9e8 },
      { positionValueUsd: 9e8 },
    ]),
  ]
  const { buyLeaning } = splitConsensusByNet(rows)
  assert.deepEqual(
    buyLeaning.map((r) => r.ticker),
    ['LowerNetMoreBuys', 'HigherNetFewerBuys']
  )
})

test('splitConsensusByNet buy-lean: tie on buyVotes uses total buy $', () => {
  const mk = (ticker, buyVotes, buyers) =>
    row(ticker, {
      buyVotes,
      sellVotes: 0,
      net: buyVotes,
      weightedBuy: buyVotes,
      weightedSell: 0,
      weightedNet: buyVotes,
      buyers,
      sellers: [],
    })
  const rows = [
    mk('SmallerUsd', 2, [{ positionValueUsd: 10e6 }, { positionValueUsd: 10e6 }]),
    mk('LargerUsd', 2, [{ positionValueUsd: 200e6 }, { positionValueUsd: 1e6 }]),
  ]
  const { buyLeaning } = splitConsensusByNet(rows)
  assert.deepEqual(buyLeaning.map((r) => r.ticker), ['LargerUsd', 'SmallerUsd'])
})

test('sumConsensusBuyerPositionUsd ignores nulls', () => {
  const rowObj = row('X', {
    buyVotes: 2,
    sellVotes: 0,
    net: 2,
    weightedBuy: 2,
    weightedSell: 0,
    weightedNet: 2,
    buyers: [{ positionValueUsd: 100 }, { positionValueUsd: null }, { positionValueUsd: 50 }],
    sellers: [],
  })
  assert.equal(sumConsensusBuyerPositionUsd(rowObj), 150)
})

test('sumConsensusSellerPositionUsd ignores nulls', () => {
  const rowObj = row('X', {
    buyVotes: 0,
    sellVotes: 2,
    net: -2,
    weightedBuy: 0,
    weightedSell: 2,
    weightedNet: -2,
    buyers: [],
    sellers: [{ positionValueUsd: 10e6 }, { positionValueUsd: null }],
  })
  assert.equal(sumConsensusSellerPositionUsd(rowObj), 10e6)
})

test('sumConsensusTotalPositionUsd sums buyers and sellers; ignores null/NaN', () => {
  const rowObj = row('X', {
    buyVotes: 1,
    sellVotes: 1,
    net: 0,
    weightedBuy: 1,
    weightedSell: 1,
    weightedNet: 0,
    buyers: [{ positionValueUsd: 50e6 }, { positionValueUsd: null }],
    sellers: [{ positionValueUsd: 12e6 }, { positionValueUsd: NaN }],
  })
  assert.equal(sumConsensusTotalPositionUsd(rowObj), 62e6)
})

test('netConsensusPositionUsd is buy minus sell', () => {
  const rowObj = row('X', {
    buyVotes: 2,
    sellVotes: 1,
    net: 1,
    weightedBuy: 2,
    weightedSell: 1,
    weightedNet: 1,
    buyers: [{ positionValueUsd: 100e6 }, { positionValueUsd: 50e6 }],
    sellers: [{ positionValueUsd: 40e6 }],
  })
  assert.equal(netConsensusPositionUsd(rowObj), 110e6)
})

test('weightByPerformance uses performance as vote weight (1Y when blended off)', () => {
  const popular = [{ ticker: 'X' }]
  const weights = {
    X: [
      w({ investorSlug: 'a', performance1yPct: 10, actionType: 'increased' }),
      w({ investorSlug: 'b', performance1yPct: 40, actionType: 'sold' }),
    ],
  }
  const r = computeTickerConsensusRows(popular, weights, {
    topK: 10,
    minVotes: 1,
    weightByPerformance: true,
    useBlendedPerformanceForVoteWeight: false,
    useActionStrengthInWeightedTallies: false,
    sortExpertsByBlendedPerformance: false,
  })[0]
  assert.equal(r.buyVotes, 1)
  assert.equal(r.sellVotes, 1)
  assert.equal(r.weightedBuy, 10)
  assert.equal(r.weightedSell, 40)
  assert.equal(r.weightedNet, -30)
})

test('minVotes filters out thin rows', () => {
  const popular = [{ ticker: 'X' }]
  const weights = {
    X: [w({ investorSlug: 'high', performance1yPct: 50, actionType: 'increased' })],
  }
  const none = computeTickerConsensusRows(popular, weights, {
    topK: 5,
    minVotes: 2,
    sortExpertsByBlendedPerformance: false,
  })
  assert.equal(none.length, 0)
  const one = computeTickerConsensusRows(popular, weights, {
    topK: 5,
    minVotes: 1,
    sortExpertsByBlendedPerformance: false,
  })
  assert.equal(one.length, 1)
})

test('unknown action yields no vote', () => {
  const popular = [{ ticker: 'X' }]
  const weights = {
    X: [w({ investorSlug: 'high', performance1yPct: 50, actionType: 'unknown' })],
  }
  const rows = computeTickerConsensusRows(popular, weights, {
    topK: 5,
    minVotes: 1,
    sortExpertsByBlendedPerformance: false,
  })
  assert.equal(rows.length, 0)
})

test('computeTickerConsensusRows copies position + pct into buyer/seller refs', () => {
  const popular = [{ ticker: 'X' }]
  const weights = {
    X: [
      w({
        investorSlug: 'buyer',
        performance1yPct: 30,
        actionType: 'increased',
        positionValueUsd: 12_500_000,
        pctOfPortfolio: 3.25,
      }),
      w({
        investorSlug: 'seller',
        performance1yPct: 20,
        actionType: 'sold',
        positionValueUsd: 8_000_000,
        pctOfPortfolio: 1.5,
      }),
    ],
  }
  const rows = computeTickerConsensusRows(popular, weights, {
    topK: 5,
    minVotes: 1,
    weightByPerformance: false,
    useActionStrengthInWeightedTallies: false,
    sortExpertsByBlendedPerformance: false,
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].buyers.length, 1)
  assert.equal(rows[0].sellers.length, 1)
  assert.equal(rows[0].buyers[0].positionValueUsd, 12_500_000)
  assert.equal(rows[0].buyers[0].pctOfPortfolio, 3.25)
  assert.equal(rows[0].sellers[0].positionValueUsd, 8_000_000)
  assert.equal(rows[0].sellers[0].pctOfPortfolio, 1.5)
})

test('isConsensusLargeBuyChip: buy row only, position ≥ $50M', () => {
  assert.equal(isConsensusLargeBuyChip('buy', CONSENSUS_LARGE_BUY_USD), true)
  assert.equal(isConsensusLargeBuyChip('buy', CONSENSUS_LARGE_BUY_USD + 1), true)
  assert.equal(isConsensusLargeBuyChip('buy', CONSENSUS_LARGE_BUY_USD - 1), false)
  assert.equal(isConsensusLargeBuyChip('sell', CONSENSUS_LARGE_BUY_USD * 2), false)
  assert.equal(isConsensusLargeBuyChip('buy', null), false)
  assert.equal(isConsensusLargeBuyChip('buy', NaN), false)
})

test('sortConsensusTickerRows: ticker asc', () => {
  const rows = [row('ZZZ'), row('AAA'), row('MMM')]
  const out = sortConsensusTickerRows(rows, 'ticker', 'asc', false)
  assert.deepEqual(
    out.map((r) => r.ticker),
    ['AAA', 'MMM', 'ZZZ']
  )
})

test('sortConsensusTickerRows: buyVotes desc; tie-break ticker', () => {
  const rows = [row('B', { buyVotes: 2 }), row('A', { buyVotes: 3 }), row('C', { buyVotes: 3 })]
  const out = sortConsensusTickerRows(rows, 'buyVotes', 'desc', false)
  assert.deepEqual(
    out.map((r) => r.ticker),
    ['A', 'C', 'B']
  )
})

/** Matches `/experts` ConsensusTable default: Score column = conviction, highest first. */
test('sortConsensusTickerRows: conviction desc', () => {
  const rows = [row('A', { convictionScore: 40 }), row('B', { convictionScore: 90 }), row('C', { convictionScore: 90 })]
  const out = sortConsensusTickerRows(rows, 'conviction', 'desc', false)
  assert.deepEqual(
    out.map((r) => r.ticker),
    ['B', 'C', 'A']
  )
})

test('sortConsensusTickerRows: net uses weightedNet when weightVotesByPerformance', () => {
  const rows = [
    row('A', { net: 5, weightedNet: 1 }),
    row('B', { net: 1, weightedNet: 9 }),
  ]
  const unweighted = sortConsensusTickerRows(rows, 'net', 'desc', false)
  assert.deepEqual(
    unweighted.map((r) => r.ticker),
    ['A', 'B']
  )
  const weighted = sortConsensusTickerRows(rows, 'net', 'desc', true)
  assert.deepEqual(
    weighted.map((r) => r.ticker),
    ['B', 'A']
  )
})

test('sortConsensusTickerRows: dollarNet from buy/sell USD', () => {
  const expert = (usd) => ({
    investorSlug: 'x',
    firmName: 'F',
    displayName: 'D',
    positionValueUsd: usd,
    pctOfPortfolio: null,
  })
  const rows = [
    row('LOW', { buyers: [expert(1e6)], sellers: [expert(5e6)] }),
    row('HIGH', { buyers: [expert(10e6)], sellers: [expert(1e6)] }),
  ]
  const out = sortConsensusTickerRows(rows, 'dollarNet', 'desc', false)
  assert.deepEqual(
    out.map((r) => r.ticker),
    ['HIGH', 'LOW']
  )
})

test('sortConsensusTickerRows: bulls / bears = chip counts', () => {
  const e = (slug) => ({
    investorSlug: slug,
    firmName: 'F',
    displayName: 'D',
    positionValueUsd: null,
    pctOfPortfolio: null,
  })
  const rows = [
    row('A', { buyers: [e('1'), e('2')], sellers: [e('3')] }),
    row('B', { buyers: [e('4')], sellers: [e('5'), e('6'), e('7')] }),
  ]
  assert.deepEqual(
    sortConsensusTickerRows(rows, 'bulls', 'desc', false).map((r) => r.ticker),
    ['A', 'B']
  )
  assert.deepEqual(
    sortConsensusTickerRows(rows, 'bears', 'desc', false).map((r) => r.ticker),
    ['B', 'A']
  )
})

test('blendedPerformanceMetric: 0.5/0.3/0.2 when all horizons present', () => {
  const m = blendedPerformanceMetric(
    w({ performance1yPct: 10, performance3yPct: 20, performance5yPct: 30 })
  )
  assert.equal(m, 0.5 * 10 + 0.3 * 20 + 0.2 * 30)
})

test('computeConvictionComposite: overlap and position', () => {
  const { score, factors } = computeConvictionComposite({
    buyVotes: 2,
    sellVotes: 0,
    effectiveTopK: 10,
    avgBuyerPct: 10,
    avgSellerPct: null,
    buyerPerfAvg: 25,
    sellerPerfAvg: null,
    buyerActionAvg: 1.5,
    sellerActionAvg: null,
  })
  assert.ok(score > 0 && score <= 100)
  assert.equal(factors.overlapBreadth, 20)
  assert.ok(factors.positionConviction > 0)
})

test('cross-source multipliers raise convictionScore', () => {
  const popular = [{ ticker: 'X' }]
  const weights = {
    X: [
      w({ investorSlug: 'a', performance1yPct: 40, actionType: 'new_holding', pctOfPortfolio: 8 }),
      w({ investorSlug: 'b', performance1yPct: 35, actionType: 'increased', pctOfPortfolio: 6 }),
    ],
  }
  const baseRows = computeTickerConsensusRows(popular, weights, {
    topK: 10,
    minVotes: 1,
    sortExpertsByBlendedPerformance: false,
    crossSourceByTicker: undefined,
  })
  const withCross = computeTickerConsensusRows(popular, weights, {
    topK: 10,
    minVotes: 1,
    sortExpertsByBlendedPerformance: false,
    crossSourceByTicker: { X: { whalewisdom: true, congress: true } },
  })
  assert.equal(baseRows.length, 1)
  assert.equal(withCross.length, 1)
  assert.ok(withCross[0].convictionScore >= baseRows[0].convictionScoreBeforeCrossSource)
})

test('buildExpertMaxPctByPortfolio: max per slug', () => {
  const weights = {
    A: [w({ investorSlug: 'u', pctOfPortfolio: 2, performance1yPct: 10 })],
    B: [w({ investorSlug: 'u', pctOfPortfolio: 15, performance1yPct: 10 })],
  }
  const m = buildExpertMaxPctByPortfolio(weights)
  assert.equal(m.get('u'), 15)
})

test('syncFreshnessLabel: Fresh within 7d', () => {
  const iso = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
  assert.equal(syncFreshnessLabel(iso).label, 'Fresh')
})

test('syncFreshnessLabel: Stale after 30d', () => {
  const iso = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString()
  assert.equal(syncFreshnessLabel(iso).label, 'Stale')
})

test('default topK cap is 15', () => {
  assert.equal(DEFAULT_CONSENSUS_TOP_K_CAP, 15)
})
