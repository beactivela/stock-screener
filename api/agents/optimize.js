/**
 * Vercel: /api/agents/optimize — forwards to Express app.
 * Explicit function prevents production 404s on nested API route matching.
 */
import { forwardToExpress } from '../_forwardToExpress.js';

export default async function handler(req, res) {
  try {
    return await forwardToExpress(req, res, '/api/agents/optimize');
  } catch (err) {
    console.error('api/agents/optimize handler error:', err);
    return res.status(503).json({
      error: 'Agent optimization API unavailable. Verify Vercel env vars and redeploy.',
    });
  }
}
