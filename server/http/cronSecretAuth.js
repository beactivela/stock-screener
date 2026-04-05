/**
 * Shared Bearer / x-cron-secret validation for POST /api/cron/* routes.
 */
import { getCronSecret } from '../cronConfig.js';

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{ allowMissingSecret?: boolean }} [options] — e.g. POST /api/cron/experts-sync when CRON_ALLOW_EXPERTS_BROWSER_SYNC=1 (Docker UI)
 * @returns {boolean} true if request may proceed
 */
export function validateCronSecret(req, res, options = {}) {
  const secret = getCronSecret();
  const authHeader = req.headers.authorization;
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const headerSecret = String(req.headers['x-cron-secret'] || bearer || '').trim() || null;

  // Production + optional route (experts sync UI): allow unauthenticated POST when operator opts in (see docker-compose).
  if (options.allowMissingSecret && !headerSecret) {
    return true;
  }

  if (process.env.NODE_ENV === 'production') {
    if (!secret) {
      res.status(503).json({ error: 'CRON_SECRET is not set; configure it for scheduled scan triggers.' });
      return false;
    }
    if (headerSecret !== secret) {
      res.status(401).json({ error: 'Invalid or missing cron secret' });
      return false;
    }
    return true;
  }

  // Non-production: if CRON_SECRET is unset, cron routes stay open (legacy local dev).
  // If CRON_SECRET is set, allow requests with *no* client header so the Experts Sync UI works
  // without pasting the secret; still validate when Authorization / x-cron-secret is present.
  if (!secret) return true;
  if (!headerSecret) return true;
  if (headerSecret !== secret) {
    res.status(401).json({ error: 'Invalid or missing cron secret' });
    return false;
  }
  return true;
}
