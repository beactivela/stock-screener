/**
 * Parse https://stockcircle.com/best-investors HTML for investor slugs and 1Y performance.
 */
import { load } from 'cheerio';

/**
 * @typedef {{ slug: string, displayName: string, firmName: string, performance1yPct: number | null }} BestInvestorRow
 */

/**
 * @param {string} html
 * @returns {BestInvestorRow[]}
 */
export function parseBestInvestorsFromHtml(html) {
  const $ = load(html);
  const out = [];

  $('a.home-box[href^="/portfolio/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/^\/portfolio\/([^/?#]+)/);
    if (!m) return;

    const slug = m[1];
    const displayName = $(el).find('h2.home-box__title').first().text().trim();
    const firmName = $(el).find('h3.home-box__subtitle').first().text().trim();

    const perfText = $(el).find('.home-box__performance-label-text').first().text();
    const perfMatch = perfText.match(/performance:\s*([\d.]+)%\s*last year/i);
    const performance1yPct = perfMatch ? parseFloat(perfMatch[1]) : null;

    out.push({
      slug,
      displayName: displayName || slug,
      firmName: firmName || '',
      performance1yPct,
    });
  });

  return out;
}

/**
 * @param {BestInvestorRow[]} rows
 * @param {number} minPct
 * @returns {BestInvestorRow[]}
 */
export function filterByMinPerformance(rows, minPct) {
  return rows.filter((r) => r.performance1yPct != null && r.performance1yPct > minPct);
}
