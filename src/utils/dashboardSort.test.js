import test from 'node:test'
import assert from 'node:assert/strict'
import { getNextSortState, getDefaultSortForFilter } from './dashboardSort.js'

test('toggles direction when clicking the active column', () => {
  assert.deepEqual(
    getNextSortState({ sortColumn: 'relativeStrength', sortDir: 'desc' }, 'relativeStrength'),
    { sortColumn: 'relativeStrength', sortDir: 'asc' },
  )
  assert.deepEqual(
    getNextSortState({ sortColumn: 'relativeStrength', sortDir: 'asc' }, 'relativeStrength'),
    { sortColumn: 'relativeStrength', sortDir: 'desc' },
  )
})

test('uses ascending as default when switching to ticker', () => {
  assert.deepEqual(
    getNextSortState({ sortColumn: 'relativeStrength', sortDir: 'desc' }, 'ticker'),
    { sortColumn: 'ticker', sortDir: 'asc' },
  )
})

test('uses descending as default when switching to any non-ticker column', () => {
  assert.deepEqual(
    getNextSortState({ sortColumn: 'ticker', sortDir: 'asc' }, 'pl'),
    { sortColumn: 'pl', sortDir: 'desc' },
  )
})

test('uses Opus descending as default sort for All filter', () => {
  assert.deepEqual(
    getDefaultSortForFilter('all'),
    { sortColumn: 'opus45', sortDir: 'desc' },
  )
})

test('uses score descending as fallback for non-All filters', () => {
  assert.deepEqual(
    getDefaultSortForFilter('breakout_tracker'),
    { sortColumn: 'score', sortDir: 'desc' },
  )
})
