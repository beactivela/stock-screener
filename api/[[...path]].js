/**
 * Vercel serverless catch-all: forwards all /api/* requests to the Express app.
 * The Express app (server/index.js) is loaded with VERCEL=1 so it does not call listen().
 * Reads use deployed data/ files; writes (scan, fetch) are not persisted on Vercel (read-only fs).
 */
import { app } from '../server/index.js';

export default function handler(req, res) {
  return app(req, res);
}
