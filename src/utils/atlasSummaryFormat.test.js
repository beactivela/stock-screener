import test from 'node:test'
import assert from 'node:assert/strict'
import { formatPercent, formatCurrencyCompact } from './atlasSummaryFormat.js'

test('formatPercent returns signed 2-decimal percent string', () => {
  assert.equal(formatPercent(22), '+22.00%')
  assert.equal(formatPercent(-5.91), '-5.91%')
  assert.equal(formatPercent(null), 'N/A')
})

test('formatCurrencyCompact returns compact USD string', () => {
  assert.equal(formatCurrencyCompact(1000000), '$1.00M')
  assert.equal(formatCurrencyCompact(940937.77), '$940.94K')
  assert.equal(formatCurrencyCompact(undefined), 'N/A')
})
