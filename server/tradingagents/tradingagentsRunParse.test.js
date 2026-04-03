/**
 * Runs scripts/tradingagents/run_parse_test.py when the TradingAgents venv exists.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(__dirname, '..', '..')
const VENV_PY = path.join(REPO_ROOT, '.venv-tradingagents', 'bin', 'python')
const PY_TEST = path.join(REPO_ROOT, 'scripts', 'tradingagents', 'run_parse_test.py')

test('run.py _parse_analyst_csv (Python unittest)', (t) => {
  if (!fs.existsSync(VENV_PY) || !fs.existsSync(PY_TEST)) {
    t.skip()
    return
  }
  const r = spawnSync(VENV_PY, [PY_TEST], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 60_000,
  })
  assert.equal(r.status, 0, r.stderr || r.stdout || 'unittest failed')
})
