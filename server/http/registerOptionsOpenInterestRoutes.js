import { createOptionsOpenInterestService } from '../optionsOpenInterest/service.js'

export function registerOptionsOpenInterestRoutes(app, opts = {}) {
  let service = opts.service || null
  const getService = () => {
    if (!service) service = createOptionsOpenInterestService()
    return service
  }

  app.get('/api/options-open-interest/:ticker', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'private, max-age=300, stale-while-revalidate=86400')
      res.json(
        await getService().getOpenInterest(req.params.ticker, {
          expiration: req.query.expiration ? String(req.query.expiration) : undefined,
        }),
      )
    } catch (error) {
      res.status(500).json({
        ok: false,
        ticker: String(req.params.ticker || '').toUpperCase(),
        spot: null,
        asOf: new Date().toISOString(),
        source: 'yahoo_options_open_interest',
        selectedExpiration: null,
        expirations: [],
        strikes: [],
        message: error?.message || 'No useful open interest data',
      })
    }
  })

  return {
    get service() {
      return service
    },
  }
}
