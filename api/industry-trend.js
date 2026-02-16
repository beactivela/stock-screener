/** Vercel: GET /api/industry-trend — same app (single server), serverless on Vercel. */
const empty = { industries: [], fetchedAt: null, source: null };
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const { app } = await import('../server/index.js');
    req.url = '/api/industry-trend';
    return app(req, res);
  } catch {
    return res.json(empty);
  }
}
