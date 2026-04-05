/**
 * HTTP fetch for StockCircle public pages (HTML).
 * Retries on rate limits (429), transient 5xx, and network/timeout errors — common when scraping many portfolios.
 */
import { parsePortfolioPageHtml, parseNextPortfolioPage } from './parsePortfolio.js';

export const STOCKCIRCLE_BASE = 'https://stockcircle.com';
export const USER_AGENT = 'stock-screener/1.0 (stockcircle-sync; +https://github.com)';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** @param {number} status */
function httpStatusWorthRetry(status) {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

/**
 * @param {string} url
 * @param {{ timeoutMs?: number, maxRetries?: number }} [opts]
 */
export async function fetchText(url, { timeoutMs = 55000, maxRetries } = {}) {
  const retries =
    maxRetries ??
    Math.min(8, Math.max(0, parseInt(String(process.env.STOCKCIRCLE_FETCH_RETRIES || '3'), 10) || 3));

  let lastErr = /** @type {Error | null} */ (null);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (res.ok) {
        return await res.text();
      }

      if (httpStatusWorthRetry(res.status) && attempt < retries) {
        const ra = res.headers.get('Retry-After');
        const raMs = ra && /^\d+$/.test(ra.trim()) ? Math.min(120_000, parseInt(ra.trim(), 10) * 1000) : null;
        const backoff = raMs ?? Math.min(45_000, 1200 * 2 ** attempt + (res.status === 429 ? 2000 : 0));
        await sleep(backoff);
        continue;
      }

      throw new Error(`HTTP ${res.status} ${url}`);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      lastErr = err;
      const msg = err.message || '';
      const isAbort = /aborted|AbortError|timeout/i.test(msg) || err.name === 'AbortError';
      const isNet = isAbort || /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket/i.test(msg);

      if (attempt < retries && isNet) {
        await sleep(Math.min(45_000, 1500 * 2 ** attempt));
        continue;
      }
      throw err;
    }
  }

  throw lastErr ?? new Error(`fetch failed after retries: ${url}`);
}

export async function fetchBestInvestorsHtml() {
  return fetchText(`${STOCKCIRCLE_BASE}/best-investors`);
}

/**
 * @param {string} slug
 * @param {number} page 1-based
 */
export function portfolioPageUrl(slug, page = 1) {
  const u = new URL(`${STOCKCIRCLE_BASE}/portfolio/${encodeURIComponent(slug)}`);
  if (page > 1) u.searchParams.set('page', String(page));
  return u.toString();
}

/** StockCircle multi-year performance (HTML). */
export function performancePageUrl(slug) {
  return `${STOCKCIRCLE_BASE}/portfolio/${encodeURIComponent(slug)}/performance`;
}

export async function fetchPerformancePageHtml(slug) {
  return fetchText(performancePageUrl(slug));
}

/**
 * @param {string} slug
 * @param {{ delayMs?: number, maxPages?: number }} [opts]
 */
export async function fetchAllPortfolioPages(slug, { delayMs = 550, maxPages = 500 } = {}) {
  const all = [];
  let pageNum = 1;

  for (let i = 0; i < maxPages; i++) {
    const html = await fetchText(portfolioPageUrl(slug, pageNum));
    all.push(...parsePortfolioPageHtml(html));
    const next = parseNextPortfolioPage(html);
    if (next == null || next === pageNum) break;
    pageNum = next;
    await new Promise((r) => setTimeout(r, delayMs));
  }

  return all;
}
