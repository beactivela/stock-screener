/**
 * HTTP fetch for WhaleWisdom public filer pages (HTML with embedded Nuxt __NUXT__ payload).
 */
export const WHALEWISDOM_BASE = 'https://whalewisdom.com';
export const USER_AGENT = 'stock-screener/1.0 (whalewisdom-sync; +https://github.com)';

/**
 * @param {string} url
 * @param {{ timeoutMs?: number }} [opts]
 */
export async function fetchText(url, { timeoutMs = 45000 } = {}) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

/**
 * @param {string} slug filer permalink (e.g. situational-awareness-lp)
 */
export function filerPageUrl(slug) {
  return `${WHALEWISDOM_BASE}/filer/${encodeURIComponent(slug)}`;
}

export async function fetchFilerPageHtml(slug) {
  return fetchText(filerPageUrl(slug));
}
