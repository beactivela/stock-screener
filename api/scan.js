/**
 * Vercel: POST /api/scan (and GET for progress/redirect) — forwards to Express app.
 * Ensures /api/scan is handled by the same app so SUPABASE_* env vars are used.
 */
export default async function handler(req, res) {
  try {
    const { app } = await import('../server/index.js');
    req.url = '/api/scan';
    return app(req, res);
  } catch (err) {
    console.error('api/scan handler error:', err);
    return res.status(503).json({
      error: 'Scan failed. Ensure SUPABASE_URL and SUPABASE_SERVICE_KEY are set in Vercel env vars and redeploy.',
    });
  }
}
