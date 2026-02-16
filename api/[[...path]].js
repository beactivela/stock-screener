/**
 * Vercel serverless catch-all: forwards all /api/* requests to the Express app.
 * The Express app (server/index.js) is loaded with VERCEL=1 so it does not call listen().
 * If the full server fails to load (e.g. heavy deps in serverless), return empty data for key GETs so the UI still loads.
 */
const EMPTY_SCAN = { scannedAt: null, results: [], totalTickers: 0, vcpBullishCount: 0 };
const EMPTY_FUNDAMENTALS = {};
const EMPTY_INDUSTRY = { industries: [], fetchedAt: null, source: null };
const EMPTY_PROGRESS = { scanId: null, running: false, progress: { index: 0, total: 0, vcpBullishCount: 0, startedAt: null, completedAt: null }, hasResults: false };

function sendEmpty(req, res) {
  const path = (req.url || req.path || '').split('?')[0];
  if (req.method !== 'GET') {
    res.status(503).json({ error: 'Writes disabled on Vercel. Use external API (VITE_API_URL) for scans.' });
    return;
  }
  if (path === '/api/scan-results') return res.json(EMPTY_SCAN);
  if (path === '/api/scan/progress') return res.json(EMPTY_PROGRESS);
  if (path === '/api/fundamentals') return res.json(EMPTY_FUNDAMENTALS);
  if (path === '/api/industry-trend') return res.json(EMPTY_INDUSTRY);
  if (path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.status(404).end();
}

export default async function handler(req, res) {
  try {
    const { app } = await import('../server/index.js');
    return app(req, res);
  } catch (err) {
    console.error('API handler error:', err);
    // So the UI loads instead of "API not running": return empty data for main GETs
    sendEmpty(req, res);
  }
}
