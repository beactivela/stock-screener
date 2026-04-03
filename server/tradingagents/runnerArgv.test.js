import test from 'node:test'
import assert from 'node:assert/strict'

import { buildTradingAgentsRunnerArgv } from './runnerArgv.js'

test('buildTradingAgentsRunnerArgv includes analysts csv', () => {
  const argv = buildTradingAgentsRunnerArgv({
    ticker: 'NVDA',
    asOf: '2026-04-01',
    provider: 'openai',
    analysts: ['market', 'fundamentals'],
  })
  assert.deepEqual(argv, [
    '--ticker',
    'NVDA',
    '--as-of',
    '2026-04-01',
    '--provider',
    'openai',
    '--analysts',
    'market,fundamentals',
  ])
})
