/**
 * Vercel: /api/agents/optimize/batch — forwards to Express app.
 * Explicit function prevents production 404s on nested API route matching.
 */
import { forwardToExpress } from '../../_forwardToExpress.js';

export default async function handler(req, res) {
  try {
    return await forwardToExpress(req, res, '/api/agents/optimize/batch');
  } catch (err) {
    console.error('api/agents/optimize/batch handler error:', err);
    return res.status(503).json({
      error: 'Batch optimization API unavailable. Verify Vercel env vars and redeploy.',
    });
  }
}
