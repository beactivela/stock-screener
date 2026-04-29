import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildOpenInterestBarRows,
  chartSpaceYToStrikeOverlayPx,
  chooseDefaultExpiration,
  formatExpirationDropdownLabel,
  formatOpenInterest,
  getMaxOpenInterest,
  OPTIONS_STRIKE_OVERLAY_TOP_PX,
} from './optionsOpenInterest.ts'

const rows = [
  { strike: 190, callOpenInterest: 50, putOpenInterest: 1200, totalOpenInterest: 1250 },
  { strike: 200, callOpenInterest: 100, putOpenInterest: 800, totalOpenInterest: 900 },
  { strike: 210, callOpenInterest: 1200, putOpenInterest: 800, totalOpenInterest: 2000 },
  { strike: 220, callOpenInterest: 700, putOpenInterest: 100, totalOpenInterest: 800 },
  { strike: 230, callOpenInterest: 300, putOpenInterest: 50, totalOpenInterest: 350 },
]

describe('options open interest helpers', () => {
  it('maps chart price Y into the strike overlay band used by OI rail and strategy visualizer', () => {
    const h = 600
    assert.equal(OPTIONS_STRIKE_OVERLAY_TOP_PX, 102)
    assert.equal(chartSpaceYToStrikeOverlayPx(0, h), 102)
    assert.equal(chartSpaceYToStrikeOverlayPx(h, h), h)
    assert.equal(chartSpaceYToStrikeOverlayPx(300, h), 102 + (300 / h) * (h - 102))
  })

  it('keeps the most relevant strikes around spot and preserves price order descending', () => {
    const visible = buildOpenInterestBarRows({
      strikes: rows,
      spot: 209.35,
      maxRows: 3,
    })

    assert.deepEqual(visible.map((row) => row.strike), [220, 210, 200])
  })

  it('can preserve the full backend-filtered strike band when maxRows is null', () => {
    const visible = buildOpenInterestBarRows({
      strikes: rows,
      spot: 230,
      maxRows: null,
    })

    assert.deepEqual(visible.map((row) => row.strike), [230, 220, 210, 200, 190])
  })

  it('scales call and put bars from the largest side-specific open interest', () => {
    const visible = buildOpenInterestBarRows({
      strikes: rows,
      spot: 209.35,
      maxRows: 5,
    })

    const strike210 = visible.find((row) => row.strike === 210)
    const strike200 = visible.find((row) => row.strike === 200)

    assert.equal(getMaxOpenInterest(rows), 1200)
    assert.equal(strike210.callWidthPct, 100)
    assert.equal(strike210.putWidthPct, 67)
    assert.equal(strike200.callWidthPct, 8)
  })

  it('chooses the selected expiration when valid and otherwise defaults to the nearest monthly expiration', () => {
    const expirations = [
      { date: '2026-05-01', label: 'May 1, 2026', dte: 7 },
      { date: '2026-05-08', label: 'May 8, 2026', dte: 14 },
      { date: '2026-05-15', label: 'May 15, 2026', dte: 21 },
    ]

    assert.equal(chooseDefaultExpiration(expirations, '2026-05-15'), '2026-05-15')
    assert.equal(chooseDefaultExpiration(expirations, '2026-06-19'), '2026-05-15')
    assert.equal(chooseDefaultExpiration(expirations, null), '2026-05-15')
    assert.equal(chooseDefaultExpiration([], null), null)
  })

  it('prefers the nearest monthly expiration over nearer weekly expirations', () => {
    const expirations = [
      { date: '2026-04-27', label: 'Apr 27, 2026', dte: 1 },
      { date: '2026-05-08', label: 'May 8, 2026', dte: 12 },
      { date: '2026-05-15', label: 'May 15, 2026', dte: 19 },
    ]

    assert.equal(chooseDefaultExpiration(expirations, null), '2026-05-15')
  })

  it('falls back to the first expiration when no monthly expiration is available', () => {
    const expirations = [
      { date: '2026-05-01', label: 'May 1, 2026', dte: 7 },
      { date: '2026-05-08', label: 'May 8, 2026', dte: 14 },
    ]

    assert.equal(chooseDefaultExpiration(expirations, null), '2026-05-01')
  })

  it('marks expiration dropdown labels as weekly or monthly', () => {
    assert.equal(
      formatExpirationDropdownLabel({ date: '2026-05-08', label: 'May 8, 2026', dte: 14 }),
      'May 8, 2026 (W)',
    )
    assert.equal(
      formatExpirationDropdownLabel({ date: '2026-05-15', label: 'May 15, 2026', dte: 21 }),
      'May 15, 2026 (M)',
    )
    assert.equal(
      formatExpirationDropdownLabel({ date: '2026-04-29', label: 'Apr 29, 2026', dte: 5 }),
      'Apr 29, 2026 (W)',
    )
  })

  it('formats open interest counts compactly', () => {
    assert.equal(formatOpenInterest(950), '950')
    assert.equal(formatOpenInterest(12300), '12.3K')
    assert.equal(formatOpenInterest(1250000), '1.25M')
    assert.equal(formatOpenInterest(null), '0')
  })
})
