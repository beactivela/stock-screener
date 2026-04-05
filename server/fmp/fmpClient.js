/**
 * Financial Modeling Prep — stable API client (https://site.financialmodelingprep.com/developer/docs/stable).
 * Handles JSON bodies and plain-text plan / limit errors.
 */

const FMP_STABLE = 'https://financialmodelingprep.com/stable';

/**
 * @param {unknown} data
 * @returns {boolean}
 */
export function fmpResponseIsPlanError(data) {
  if (data == null) return false;
  const s = typeof data === 'string' ? data : JSON.stringify(data);
  return /Restricted Endpoint|Premium Query Parameter|not available under your current subscription/i.test(s);
}

/**
 * @param {string} path e.g. "/senate-latest" (with leading slash)
 * @param {Record<string, string | number | undefined>} [query]
 * @returns {Promise<{ ok: boolean, status: number, data: unknown, errorText?: string }>}
 */
export async function fmpStableGet(path, query = {}) {
  const key = process.env.FMP_API_KEY;
  if (!key || !String(key).trim()) {
    return { ok: false, status: 0, data: null, errorText: 'FMP_API_KEY not set' };
  }

  const u = new URL(FMP_STABLE + (path.startsWith('/') ? path : `/${path}`));
  u.searchParams.set('apikey', String(key).trim());
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    u.searchParams.set(k, String(v));
  }

  const res = await fetch(u.toString(), {
    headers: { Accept: 'application/json' },
  });

  const text = await res.text();
  let data;
  try {
    data = text.trim() ? JSON.parse(text) : null;
  } catch {
    if (/Restricted Endpoint|Premium Query Parameter|subscription/i.test(text)) {
      return { ok: false, status: res.status, data: null, errorText: text.slice(0, 500) };
    }
    return { ok: false, status: res.status, data: null, errorText: text.slice(0, 500) };
  }

  if (!res.ok) {
    return { ok: false, status: res.status, data, errorText: text.slice(0, 500) };
  }

  if (fmpResponseIsPlanError(data)) {
    return { ok: false, status: res.status, data: null, errorText: typeof data === 'string' ? data : text.slice(0, 500) };
  }

  return { ok: true, status: res.status, data };
}
