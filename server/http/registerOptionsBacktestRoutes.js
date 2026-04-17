import { createOptionsBacktestService } from '../optionsBacktesting/service.js'

export function registerOptionsBacktestRoutes(app, opts = {}) {
  const service = opts.service || createOptionsBacktestService()

  app.get('/api/options-backtest/runs', async (_req, res) => {
    try {
      res.setHeader('Cache-Control', 'private, max-age=15, stale-while-revalidate=45')
      res.json(await service.listRuns())
    } catch (error) {
      res.status(500).json({ ok: false, error: error?.message || 'Failed to load saved options backtests.' })
    }
  })

  app.get('/api/options-backtest/runs/:runId', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'private, max-age=15, stale-while-revalidate=45')
      res.json(await service.getRun(req.params.runId))
    } catch (error) {
      const message = error?.message || 'Failed to load options backtest run.'
      const status = /not found/i.test(message) ? 404 : 500
      res.status(status).json({ ok: false, error: message })
    }
  })

  app.post('/api/options-backtest/run', async (req, res) => {
    try {
      res.json(await service.run(req.body || {}))
    } catch (error) {
      const message = error?.message || 'Options backtest failed.'
      const status = /required|invalid|select at least|must be/i.test(message) ? 400 : 500
      res.status(status).json({ ok: false, error: message })
    }
  })

  return service
}
