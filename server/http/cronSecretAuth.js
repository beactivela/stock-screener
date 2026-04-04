/**
 * Shared Bearer / x-cron-secret validation for POST /api/cron/* routes.
 */
import { getCronSecret } from '../cronConfig.js';

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {boolean} true if request may proceed
 */
export function validateCronSecret(req, res) {
  const secret = getCronSecret();
  const authHeader = req.headers.authorization;
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const headerSecret = String(req.headers['x-cron-secret'] || bearer || '').trim() || null;

  if (process.env.NODE_ENV === 'production') {
    if (!secret) {
      res.status(503).json({ error: 'CRON_SECRET is not set; configure it for scheduled scan triggers.' });
      return false;
    }
    if (headerSecret !== secret) {
      res.status(401).json({ error: 'Invalid or missing cron secret' });
      return false;
    }
  } else if (secret && headerSecret !== secret) {
    res.status(401).json({ error: 'Invalid or missing cron secret' });
    return false;
  }
  return true;
}
