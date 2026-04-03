/**
 * Optional persistent Python worker (scripts/tradingagents/worker_stdio.py).
 * Enable with TRADINGAGENTS_STDIO_WORKER=1 on the Node process.
 * Single global in-flight job — second request receives 503.
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

/** @type {import('child_process').ChildProcessWithoutNullStreams | null} */
let workerChild = null
/** @type {readline.Interface | null} */
let lineReader = null
let workerBusy = false

export function isTradingAgentsStdioWorkerConfigured() {
  return process.env.TRADINGAGENTS_STDIO_WORKER === '1'
}

export function isTradingAgentsStdioWorkerBusy() {
  return workerBusy
}

export function tradingAgentsStdioWorkerScript(repoRoot) {
  return path.join(repoRoot, 'scripts', 'tradingagents', 'worker_stdio.py')
}

export function resetTradingAgentsStdioWorker() {
  try {
    workerChild?.kill('SIGKILL')
  } catch {
    /* ignore */
  }
  workerChild = null
  lineReader = null
  workerBusy = false
}

/**
 * @param {string} repoRoot
 * @param {string} pyPath
 */
function ensureChild(repoRoot, pyPath) {
  if (workerChild && !workerChild.killed) return
  const script = tradingAgentsStdioWorkerScript(repoRoot)
  if (!fs.existsSync(script)) {
    throw new Error('scripts/tradingagents/worker_stdio.py missing')
  }
  workerChild = spawn(pyPath, ['-u', script], {
    cwd: repoRoot,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  workerChild.on('exit', () => {
    workerChild = null
    lineReader = null
  })
  workerChild.stderr?.on('data', (b) => {
    console.error('[TradingAgents stdio worker]', b.toString())
  })
  lineReader = readline.createInterface({ input: workerChild.stdout })
}

/**
 * @param {string} repoRoot
 * @param {string} pyPath
 * @param {{ ticker: string, asOf: string, provider: string, analysts: string[] }} payload
 * @param {(ev: object) => void} onEvent
 * @returns {Promise<number>}
 */
export function runTradingAgentsStdioJob(repoRoot, pyPath, payload, onEvent) {
  if (workerBusy) {
    return Promise.reject(new Error('TRADINGAGENTS_WORKER_BUSY'))
  }
  workerBusy = true
  ensureChild(repoRoot, pyPath)
  if (!workerChild?.stdin || !lineReader) {
    workerBusy = false
    return Promise.reject(new Error('TradingAgents stdio worker failed to start'))
  }

  const jobLine =
    JSON.stringify({
      ticker: payload.ticker,
      asOf: payload.asOf,
      provider: payload.provider,
      analysts: payload.analysts,
    }) + '\n'
  workerChild.stdin.write(jobLine)

  return new Promise((resolve, reject) => {
    /** @param {string} line */
    const onLine = (line) => {
      const trimmed = line.trim()
      if (!trimmed) return
      try {
        const ev = JSON.parse(trimmed)
        if (ev.type === '__end__') {
          lineReader?.off('line', onLine)
          workerBusy = false
          resolve(Number(ev.code) || 0)
          return
        }
        onEvent(ev)
      } catch (e) {
        lineReader?.off('line', onLine)
        workerBusy = false
        reject(e)
      }
    }
    lineReader.on('line', onLine)
  })
}
