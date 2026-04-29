import { createOptionsGammaService } from '../optionsGamma/service.js'

export function registerOptionsGammaRoutes(app, opts = {}) {
  let service = opts.service || null
  const getService = () => {
    if (!service) service = createOptionsGammaService()
    return service
  }

  app.get('/api/options-gamma/:ticker', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'private, max-age=300, stale-while-revalidate=86400')
      res.json(await getService().getGamma(req.params.ticker))
    } catch (error) {
      res.status(500).json({
        ok: false,
        ticker: String(req.params.ticker || '').toUpperCase(),
        spot: null,
        asOf: new Date().toISOString(),
        source: 'yahoo_options_black_scholes',
        netGammaUsd: null,
        regime: 'neutral',
        topLevels: [],
        allLevels: [],
        monthlyOnly: false,
        message: error?.message || 'No useful gamma data',
      })
    }
  })

  return {
    get service() {
      return service
    },
  }
}
