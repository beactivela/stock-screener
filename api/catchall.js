/**
 * Vercel API catch-all target for rewrite-based forwarding.
 * This avoids relying on dynamic filename routing in plain Vercel Functions.
 */
import { buildCatchAllApiPath, forwardToExpress } from './_forwardToExpress.js';

export default async function handler(req, res) {
  try {
    const forcedPath = buildCatchAllApiPath(req.query?.path);

    // Remove rewrite helper query key before forwarding to Express.
    const parsed = new URL(req.url || '/api/catchall', 'http://localhost');
    parsed.searchParams.delete('path');
    req.url = `${parsed.pathname}${parsed.search}`;

    return await forwardToExpress(req, res, forcedPath);
  } catch (err) {
    console.error('api/catchall handler error:', err);
    return res.status(503).json({
      error: 'API error. Ensure SUPABASE_URL and SUPABASE_SERVICE_KEY are set in Vercel and redeploy.',
    });
  }
}
