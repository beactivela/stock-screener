/**
 * AI Hedge Fund (bundled Python app) — proxy to FMP stable API via fmpStableGet.
 * Keeps FMP_API_KEY server-side only; Python calls STOCK_SCREENER_API_BASE + these routes.
 *
 * GET /api/ai-hedge-fund/fmp/* — forwards path + query to https://financialmodelingprep.com/stable/...
 */
import { fmpStableGet } from '../fmp/fmpClient.js';

/**
 * @param {import('express').Express} app
 */
export function registerAiHedgeFundFmpRoutes(app) {
  app.use('/api/ai-hedge-fund/fmp', async (req, res) => {
    if (req.method !== 'GET') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }
    try {
      const raw = req.url || '/';
      const parsed = new URL(raw, 'http://internal');
      const fmpPath = parsed.pathname || '/';
      const query = {};
      parsed.searchParams.forEach((v, k) => {
        query[k] = v;
      });
      const result = await fmpStableGet(fmpPath, query);
      if (!result.ok) {
        return res.status(result.status && result.status > 0 ? result.status : 502).json({
          ok: false,
          error: result.errorText || 'FMP request failed',
          status: result.status,
        });
      }
      return res.json({ ok: true, data: result.data });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });
}
