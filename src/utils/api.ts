/**
 * API base URL for fetch calls.
 * - Dev: empty string → requests go to same origin, Vite proxy forwards /api to backend
 * - Vercel (no env): empty → /api returns 404, app shows "API server not running"
 * - Vercel + VITE_API_URL: e.g. "https://your-api.railway.app" → API runs separately
 */
export const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
