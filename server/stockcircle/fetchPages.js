/**
 * HTTP fetch for StockCircle public pages (HTML).
 */
import { parsePortfolioPageHtml, parseNextPortfolioPage } from './parsePortfolio.js';

export const STOCKCIRCLE_BASE = 'https://stockcircle.com';
export const USER_AGENT = 'stock-screener/1.0 (stockcircle-sync; +https://github.com)';

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

/**
 * @param {string} slug
 * @param {{ delayMs?: number, maxPages?: number }} [opts]
 */
export async function fetchAllPortfolioPages(slug, { delayMs = 400, maxPages = 500 } = {}) {
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
