import assert from 'assert'
import { describe, it } from 'node:test'
import { buildTopRs50 } from './topRsScreen.js'

describe('topRsScreen', () => {
  it('returns only stocks that meet minimum RS and fundamentals gates', () => {
    const results = [
      { ticker: 'A', relativeStrength: 98, industryRank: 12 },
      { ticker: 'B', relativeStrength: 94, industryRank: 20 },
      { ticker: 'C', relativeStrength: 88, industryRank: 8 },
      { ticker: 'D', relativeStrength: null, industryRank: 15 },
    ]
    const fundamentals = {
      A: { qtrEarningsYoY: 28, pctHeldByInst: 35, profitMargin: 12, operatingMargin: 14 },
      B: { qtrEarningsYoY: 25, pctHeldByInst: 30, profitMargin: 10, operatingMargin: 11 },
      C: { qtrEarningsYoY: 40, pctHeldByInst: 50, profitMargin: 20, operatingMargin: 22 },
      D: { qtrEarningsYoY: 30, pctHeldByInst: 45, profitMargin: 15, operatingMargin: 16 },
    }

    const top = buildTopRs50(results, fundamentals)

    assert.deepEqual(top.map((row) => row.ticker), ['A', 'B'])
  })

  it('ranks eligible names by composite score and caps at 50', () => {
    const results = []
    const fundamentals = {}
    for (let i = 0; i < 55; i += 1) {
      const ticker = `T${i}`
      results.push({
        ticker,
        relativeStrength: 95 + (i % 5),
        industryRank: i + 1,
      })
      fundamentals[ticker] = {
        qtrEarningsYoY: 25 + i,
        pctHeldByInst: 30 + i,
        profitMargin: 8 + i,
        operatingMargin: 10 + i,
      }
    }

    const top = buildTopRs50(results, fundamentals)

    assert.equal(top.length, 50)
    assert.equal(top[0].ticker, 'T54')
    assert.equal(top[0].topRsScore >= top[1].topRsScore, true)
  })

  it('includes helpful metadata for dashboard rendering', () => {
    const results = [{ ticker: 'NVDA', relativeStrength: 99, industryRank: 5 }]
    const fundamentals = {
      NVDA: { qtrEarningsYoY: 40, pctHeldByInst: 68, profitMargin: 22, operatingMargin: 30 },
    }

    const top = buildTopRs50(results, fundamentals)
    assert.equal(top.length, 1)
    assert.equal(top[0].qualifiesForTopRs, true)
    assert.equal(typeof top[0].topRsScore, 'number')
  })
})
