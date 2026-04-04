/**
 * Optional HTML meta scrape for StockCircle public pages (descriptions only).
 */
import { load } from 'cheerio';
import { fetchText, STOCKCIRCLE_BASE } from './fetchPages.js';

export function stockcirclePortfolioUrl(slug) {
  return `${STOCKCIRCLE_BASE}/portfolio/${encodeURIComponent(slug)}`;
}

export function stockcirclePerformanceUrl(slug) {
  return `${STOCKCIRCLE_BASE}/portfolio/${encodeURIComponent(slug)}/performance`;
}

/**
 * @param {string} url
 * @returns {Promise<string | null>}
 */
export async function fetchMetaDescription(url) {
  try {
    const html = await fetchText(url, { timeoutMs: 15000 });
    const $ = load(html);
    return $('meta[name="description"]').attr('content')?.trim() || null;
  } catch {
    return null;
  }
}
