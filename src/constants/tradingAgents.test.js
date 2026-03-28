import test from 'node:test'
import assert from 'node:assert/strict'

import {
  TRADING_AGENTS_NAV_LABEL,
  TRADING_AGENTS_REPO_URL,
} from './tradingAgents.js'

test('TradingAgents nav points at canonical GitHub repo', () => {
  assert.equal(TRADING_AGENTS_REPO_URL, 'https://github.com/TauricResearch/TradingAgents')
  assert.equal(TRADING_AGENTS_NAV_LABEL, 'TradingAgents')
})
