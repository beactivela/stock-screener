/**
 * API base URL for fetch calls.
 * - Default: empty → same origin `/api` (local dev and Docker VPS both use one host).
 * - Optional VITE_API_URL: separate API origin when the UI is hosted apart from the API.
 */
export const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
