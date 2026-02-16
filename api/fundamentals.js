/** Vercel: GET /api/fundamentals — same app (single server), serverless on Vercel. */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const { app } = await import('../server/index.js');
    req.url = '/api/fundamentals';
    return app(req, res);
  } catch {
    return res.json({});
  }
}
