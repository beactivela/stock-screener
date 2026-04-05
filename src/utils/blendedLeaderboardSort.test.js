import test from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultBlendedSortDir,
  sortBlendedLeaderboardEntries,
} from './blendedLeaderboardSort.ts'

function guru(slug, firm, p1y, p3y = null, p5y = null, p10y = null) {
  return {
    kind: 'guru',
    row: {
      investorSlug: slug,
      firmName: firm,
      displayName: firm,
      performance1yPct: p1y,
      performance3yPct: p3y,
      performance5yPct: p5y,
      performance10yPct: p10y,
    },
  }
}

function ww(slug, name) {
  return { kind: 'whalewisdom', slug, displayName: name, managerName: name }
}

const experts = [
  guru('a', 'Alpha', 50),
  guru('b', 'Bravo', 10),
  guru('c', 'Charlie', null),
]

test('defaultBlendedSortDir: strings asc, numbers desc', () => {
  assert.equal(defaultBlendedSortDir('pipeline'), 'asc')
  assert.equal(defaultBlendedSortDir('name'), 'asc')
  assert.equal(defaultBlendedSortDir('perf1y'), 'desc')
  assert.equal(defaultBlendedSortDir('overlap'), 'desc')
})

test('sortBlendedLeaderboardEntries pipeline preserves order', () => {
  const entries = [guru('x', 'X', 1), ww('w', 'WW'), guru('y', 'Y', 2)]
  const out = sortBlendedLeaderboardEntries(entries, experts, 10, 'pipeline', 'asc')
  assert.deepEqual(
    out.map((e) => (e.kind === 'guru' ? e.row.investorSlug : e.slug)),
    ['x', 'w', 'y']
  )
})

test('sortBlendedLeaderboardEntries perf1y desc: higher first; nulls last', () => {
  const entries = [guru('low', 'L', 5), guru('hi', 'H', 90), guru('na', 'N', null)]
  const out = sortBlendedLeaderboardEntries(entries, experts, 10, 'perf1y', 'desc')
  assert.deepEqual(
    out.map((e) => e.row.investorSlug),
    ['hi', 'low', 'na']
  )
})

test('sortBlendedLeaderboardEntries perf1y asc: lower first; nulls last', () => {
  const entries = [guru('hi', 'H', 90), guru('low', 'L', 5), guru('na', 'N', null)]
  const out = sortBlendedLeaderboardEntries(entries, experts, 10, 'perf1y', 'asc')
  assert.deepEqual(
    out.map((e) => e.row.investorSlug),
    ['low', 'hi', 'na']
  )
})

test('sortBlendedLeaderboardEntries name asc', () => {
  const entries = [guru('z', 'Zebra', 1), guru('a', 'Ant', 2)]
  const out = sortBlendedLeaderboardEntries(entries, experts, 10, 'name', 'asc')
  assert.deepEqual(
    out.map((e) => e.row.firmName),
    ['Ant', 'Zebra']
  )
})

test('sortBlendedLeaderboardEntries overlap desc: in-panel guru before others before ww', () => {
  const expertOrder = [guru('top', 'Top', 1).row, guru('mid', 'Mid', 2).row]
  const entries = [
    ww('w', 'Whale'),
    guru('top', 'Top', 1),
    guru('mid', 'Mid', 2),
  ]
  const out = sortBlendedLeaderboardEntries(entries, expertOrder, 1, 'overlap', 'desc')
  // topK=1 → only `top` is "in panel"
  assert.deepEqual(
    out.map((e) => (e.kind === 'guru' ? e.row.investorSlug : e.slug)),
    ['top', 'mid', 'w']
  )
})
