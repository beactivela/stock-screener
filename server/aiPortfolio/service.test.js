import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  computeNextCheckpointIso,
  getActiveCheckpointLabel,
  getZonedDateParts,
  parseMarketCheckpointSlots,
} from './service.js'

describe('aiPortfolio scheduler checkpoint helpers', () => {
  it('parses and sorts configured checkpoint times', () => {
    const slots = parseMarketCheckpointSlots('14:30,09:00,11:00,13:00,09:00')
    assert.deepEqual(
      slots.map((s) => s.label),
      ['09:00', '11:00', '13:00', '14:30'],
    )
  })

  it('resolves timezone date parts in America/Chicago', () => {
    const parts = getZonedDateParts(new Date('2026-01-15T15:00:20Z'), 'America/Chicago')
    assert.equal(parts.dateKey, '2026-01-15')
    assert.equal(parts.hour, 9)
    assert.equal(parts.minute, 0)
  })

  it('finds active checkpoint labels at configured times', () => {
    const slots = parseMarketCheckpointSlots('09:00,11:00,13:00,14:30')
    const atNine = getActiveCheckpointLabel(
      new Date('2026-01-15T15:00:05Z'),
      slots,
      'America/Chicago',
    )
    const atTwoThirty = getActiveCheckpointLabel(
      new Date('2026-01-15T20:30:50Z'),
      slots,
      'America/Chicago',
    )
    assert.equal(atNine, '09:00')
    assert.equal(atTwoThirty, '14:30')
  })

  it('computes the next checkpoint as an ISO timestamp', () => {
    const slots = parseMarketCheckpointSlots('09:00,11:00,13:00,14:30')
    const next = computeNextCheckpointIso(
      new Date('2026-01-15T15:01:10Z'),
      slots,
      'America/Chicago',
    )
    assert.equal(next, '2026-01-15T17:00:00.000Z')
  })
})
