import { createAiPortfolioService } from '../aiPortfolio/service.js'

/**
 * @param {import('express').Application} app
 * @param {{ service?: ReturnType<typeof createAiPortfolioService> }} [opts]
 */
export function registerAiPortfolioRoutes(app, opts = {}) {
  const service = opts.service || createAiPortfolioService()

  app.get('/api/ai-portfolio/config', async (_req, res) => {
    try {
      const config = await service.getConfig()
      res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=60')
      res.json(config)
    } catch (error) {
      res.status(500).json({ error: error?.message || 'Failed to load AI portfolio config.' })
    }
  })

  app.get('/api/ai-portfolio/summary', async (_req, res) => {
    try {
      const summary = await service.getSummary()
      res.setHeader('Cache-Control', 'private, max-age=15, stale-while-revalidate=45')
      res.json(summary)
    } catch (error) {
      res.status(500).json({ ok: false, error: error?.message || 'Failed to load AI portfolio summary.' })
    }
  })

  app.get('/api/ai-portfolio/ledger', async (_req, res) => {
    try {
      const ledger = await service.getLedger()
      res.setHeader('Cache-Control', 'private, max-age=15, stale-while-revalidate=45')
      res.json({ ok: true, ...ledger })
    } catch (error) {
      res.status(500).json({ ok: false, error: error?.message || 'Failed to load AI Portfolio ledger.' })
    }
  })

  app.post('/api/ai-portfolio/simulate/daily', async (req, res) => {
    try {
      const out = await service.runDailyCycle({ asOfDate: req.body?.asOfDate })
      res.json({ ok: true, ...out })
    } catch (error) {
      res.status(500).json({ ok: false, error: error?.message || 'Daily AI portfolio run failed.' })
    }
  })

  /** SSE: per-manager thinking + OpenRouter payload + execution note (see `runDailyCycleSse`). */
  app.post('/api/ai-portfolio/simulate/daily-stream', async (req, res) => {
    try {
      await service.runDailyCycleSse(res, { asOfDate: req.body?.asOfDate })
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: error?.message || 'Daily stream failed.' })
      }
    }
  })

  app.get('/api/ai-portfolio/scheduler', (_req, res) => {
    res.json(service.getSchedulerState())
  })

  return service
}

