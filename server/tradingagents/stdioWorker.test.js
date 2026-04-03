import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  isTradingAgentsStdioWorkerConfigured,
  resetTradingAgentsStdioWorker,
  tradingAgentsStdioWorkerScript,
  isTradingAgentsStdioWorkerBusy,
} from './stdioWorker.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(__dirname, '..', '..')

test('tradingAgentsStdioWorkerScript joins repo scripts path', () => {
  const p = tradingAgentsStdioWorkerScript(REPO_ROOT)
  assert.ok(p.endsWith(path.join('scripts', 'tradingagents', 'worker_stdio.py')))
})

test('isTradingAgentsStdioWorkerConfigured reflects TRADINGAGENTS_STDIO_WORKER', (t) => {
  const prev = process.env.TRADINGAGENTS_STDIO_WORKER
  t.after(() => {
    if (prev === undefined) delete process.env.TRADINGAGENTS_STDIO_WORKER
    else process.env.TRADINGAGENTS_STDIO_WORKER = prev
  })
  delete process.env.TRADINGAGENTS_STDIO_WORKER
  assert.equal(isTradingAgentsStdioWorkerConfigured(), false)
  process.env.TRADINGAGENTS_STDIO_WORKER = '1'
  assert.equal(isTradingAgentsStdioWorkerConfigured(), true)
})

test('resetTradingAgentsStdioWorker is safe with no process', () => {
  resetTradingAgentsStdioWorker()
  assert.equal(isTradingAgentsStdioWorkerBusy(), false)
})
