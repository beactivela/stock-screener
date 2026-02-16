/**
 * API base URL for fetch calls.
 * - Local dev: empty → single server (Express + Vite) on same origin, /api on same port
 * - Vercel (no env): empty → /api must be provided by Vercel serverless or external URL
 * - Vercel + VITE_API_URL: e.g. "https://your-api.railway.app" → API runs separately
 */
export const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
