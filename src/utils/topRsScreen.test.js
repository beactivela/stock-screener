import assert from 'assert'
import { describe, it } from 'node:test'
import { buildTopRs50 } from './topRsScreen.js'

describe('topRsScreen', () => {
  it('returns only stocks that meet RS + industry rank gates', () => {
    const results = [
      { ticker: 'A', relativeStrength: 98, industryRank: 12 },
      { ticker: 'B', relativeStrength: 94, industryRank: 20 },
      { ticker: 'C', relativeStrength: 88, industryRank: 8 },
      { ticker: 'D', relativeStrength: 93, industryRank: null },
    ]
    const top = buildTopRs50(results, {})

    assert.deepEqual(top.map((row) => row.ticker), ['A', 'B'])
  })

  it('ranks eligible names by RS first, then industry rank, and caps at 50', () => {
    const results = []
    for (let i = 0; i < 55; i += 1) {
      const ticker = `T${i}`
      results.push({
        ticker,
        relativeStrength: 90 + (i % 10),
        industryRank: 55 - i,
      })
    }

    const top = buildTopRs50(results, {})

    assert.equal(top.length, 50)
    assert.equal(top[0].ticker, 'T49')
    assert.equal(top[1].ticker, 'T39')
    assert.equal(top[0].topRsScore >= top[1].topRsScore, true)
  })

  it('includes helpful metadata for dashboard rendering', () => {
    const results = [{ ticker: 'NVDA', relativeStrength: 99, industryRank: 5 }]
    const top = buildTopRs50(results, {})
    assert.equal(top.length, 1)
    assert.equal(top[0].qualifiesForTopRs, true)
    assert.equal(typeof top[0].topRsScore, 'number')
  })
})
