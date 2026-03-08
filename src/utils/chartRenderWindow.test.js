import test from 'node:test'
import assert from 'node:assert/strict'

import { getInitialChartCount, getNextChartCount } from './chartRenderWindow.js'

test('getInitialChartCount caps the first chart batch at the configured size', () => {
  assert.equal(getInitialChartCount(4, 12), 4)
  assert.equal(getInitialChartCount(40, 12), 12)
})

test('getNextChartCount advances by batch size without exceeding total count', () => {
  assert.equal(getNextChartCount(12, 40, 12), 24)
  assert.equal(getNextChartCount(36, 40, 12), 40)
})
