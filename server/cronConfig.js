/**
 * Cron-related settings from environment. Populated from the project root `.env` when the
 * process starts (`dotenv.config` in `server/index.js` and CLI scripts that load `.env`).
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Absolute path to the root `.env` file (for operator hints; file may not exist in all deploys). */
export function getCronEnvFilePath() {
  return path.join(__dirname, '..', '.env');
}

/** @returns {string | undefined} Trimmed CRON_SECRET, or undefined if unset/blank */
export function getCronSecret() {
  const s = process.env.CRON_SECRET?.trim();
  return s || undefined;
}

/**
 * Base URL for host-side curl scripts (loopback + published port). From `CRON_BASE_URL`, else `HOST_PORT`, else 8080.
 * @returns {string} No trailing slash
 */
export function getCronBaseUrl() {
  const explicit = process.env.CRON_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const hostPort = process.env.HOST_PORT?.trim();
  if (hostPort) return `http://127.0.0.1:${hostPort}`;
  return 'http://127.0.0.1:8080';
}

export function getCronBarsChunk() {
  return Math.max(10, Number(process.env.CRON_BARS_CHUNK) || 40);
}

/** Safe for JSON APIs — never includes the secret value */
export function getCronStatusPayload() {
  const production = process.env.NODE_ENV === 'production';
  const secret = getCronSecret();
  return {
    envFile: getCronEnvFilePath(),
    production,
    cronAuthRequired: production,
    secretConfigured: Boolean(secret),
    baseUrl: getCronBaseUrl(),
    barsChunk: getCronBarsChunk(),
    endpoints: {
      refreshBars: '/api/cron/refresh-bars',
      fetchPrices: '/api/cron/fetch-prices',
      runScan: '/api/cron/run-scan',
      stockcircleSync: '/api/cron/stockcircle-sync',
      whalewisdomSync: '/api/cron/whalewisdom-sync',
      expertsSync: '/api/cron/experts-sync',
    },
  };
}
