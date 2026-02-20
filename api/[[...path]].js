/**
 * Vercel catch-all: any /api/* request not handled by a more specific api/*.js
 * forwards to the Express app. Ensures all API routes (bars, vcp, regime, trades, etc.)
 * run with the same env (SUPABASE_*, etc.) and logic as the main server.
 *
 * More specific handlers (api/scan-results.js, api/scan.js, etc.) take precedence
 * when the path matches; this handles the rest (e.g. /api/bars/AAPL, /api/vcp/TSLA).
 */
export default async function handler(req, res) {
  try {
    const { app } = await import('../server/index.js');
    // Catch-all: path segments may be in req.query.path. Ensure Express sees full path.
    const pathSegments = req.query.path;
    if (Array.isArray(pathSegments) && pathSegments.length > 0) {
      const pathPart = pathSegments.join('/');
      const qs = (req.url && req.url.includes('?')) ? '?' + req.url.split('?').slice(1).join('?') : '';
      req.url = '/api/' + pathPart + qs;
    } else if (!req.url || !req.url.startsWith('/api')) {
      req.url = req.url || '/api';
    }
    return app(req, res);
  } catch (err) {
    console.error('api/[[...path]] handler error:', err);
    return res.status(503).json({
      error: 'API error. Ensure SUPABASE_URL and SUPABASE_SERVICE_KEY are set in Vercel and redeploy.',
    });
  }
}
