import { normalizeOptionsBacktestRequest, buildOptionsBacktestResponse } from './contracts.js'
import { runCashSecuredPutBacktest } from './cspEngine.js'
import { createOptionsBacktestStore } from './store.js'

export function createOptionsBacktestService(opts = {}) {
  const store = opts.store || createOptionsBacktestStore()
  const runner = opts.runner || runCashSecuredPutBacktest

  async function run(requestBody) {
    const request = normalizeOptionsBacktestRequest(requestBody)
    const result = await runner(request)
    const persisted = await store.saveRun({
      request,
      assumptions: result.assumptions,
      warnings: result.warnings,
      setups: result.setups,
    })
    const recentRuns = await store.listRuns()
    return buildOptionsBacktestResponse({
      run: persisted.run,
      setups: persisted.setups,
      recentRuns,
      assumptions: persisted.assumptions,
      warnings: persisted.warnings,
    })
  }

  async function listRuns() {
    return {
      ok: true,
      runs: await store.listRuns(),
    }
  }

  async function getRun(runId) {
    const detail = await store.getRun(runId)
    const recentRuns = await store.listRuns()
    return buildOptionsBacktestResponse({
      run: detail.run,
      setups: detail.setups,
      recentRuns,
      assumptions: detail.assumptions,
      warnings: detail.warnings,
    })
  }

  return {
    run,
    listRuns,
    getRun,
  }
}
