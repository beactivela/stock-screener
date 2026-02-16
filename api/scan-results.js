/** Vercel: GET /api/scan-results — same app (single server), serverless on Vercel. */
const empty = { scannedAt: null, results: [], totalTickers: 0, vcpBullishCount: 0 };
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const { app } = await import('../server/index.js');
    req.url = '/api/scan-results';
    return app(req, res);
  } catch {
    return res.json(empty);
  }
}
