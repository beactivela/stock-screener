/** Vercel: GET /api/scan/progress — same app (single server), serverless on Vercel. */
const empty = { scanId: null, running: false, progress: { index: 0, total: 0, vcpBullishCount: 0, startedAt: null, completedAt: null }, hasResults: false };
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const { app } = await import('../../server/index.js');
    req.url = '/api/scan/progress';
    return app(req, res);
  } catch {
    return res.json(empty);
  }
}
