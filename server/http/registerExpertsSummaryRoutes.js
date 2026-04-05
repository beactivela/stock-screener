/**
 * GET /api/experts/summary — guru overlap + WhaleWisdom filers + FMP Congress + institutional probe metadata.
 */
import { buildExpertsSummaryPayload } from '../experts/buildExpertsSummaryPayload.js';
import { sendJson } from './sendJson.js';

export function registerExpertsSummaryRoutes(app) {
  app.get('/api/experts/summary', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'private, max-age=60, stale-while-revalidate=120');
      const payload = await buildExpertsSummaryPayload();
      const status = payload.ok ? 200 : 503;
      sendJson(res, status, payload);
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === 'object' && e !== null && 'message' in e
            ? String(e.message)
            : String(e);
      sendJson(res, 500, { ok: false, error: msg || 'Experts summary failed' });
    }
  });
}
