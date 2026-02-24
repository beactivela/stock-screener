/**
 * Shared Vercel API wrapper helpers for forwarding requests into Express.
 */

/**
 * Build the URL Express should receive, preserving query string from original URL.
 *
 * @param {string} forcedPath - Express path to route (must start with /api)
 * @param {string | undefined} originalUrl - Incoming Vercel req.url
 * @returns {string}
 */
export function buildExpressProxyUrl(forcedPath, originalUrl) {
  const path = typeof forcedPath === 'string' && forcedPath.startsWith('/api')
    ? forcedPath
    : '/api';
  const source = typeof originalUrl === 'string' ? originalUrl : '';
  const hasQuery = source.includes('?');
  if (!hasQuery) return path;
  const query = source.split('?').slice(1).join('?');
  return query ? `${path}?${query}` : path;
}

/**
 * Forward a Vercel serverless request to the shared Express app.
 *
 * @param {import('http').IncomingMessage & { url?: string }} req
 * @param {import('http').ServerResponse} res
 * @param {string} forcedPath
 * @returns {Promise<any>}
 */
export async function forwardToExpress(req, res, forcedPath) {
  const { app } = await import('../server/index.js');
  req.url = buildExpressProxyUrl(forcedPath, req.url);
  return app(req, res);
}
