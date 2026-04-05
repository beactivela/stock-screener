/**
 * Parse https://stockcircle.com/portfolio/:slug/performance — 1Y / 3Y / 5Y / 10Y % blocks.
 */
import { load } from 'cheerio';

/**
 * @typedef {{
 *   performance1yPct: number | null,
 *   performance3yPct: number | null,
 *   performance5yPct: number | null,
 *   performance10yPct: number | null,
 * }} PerformanceHorizons
 */

/**
 * @param {string} raw
 * @returns {number | null}
 */
function parsePctText(raw) {
  const t = String(raw || '')
    .trim()
    .replace(/%/g, '')
    .replace(/,/g, '');
  if (!t) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {string} html
 * @returns {PerformanceHorizons}
 */
export function parsePerformancePageHtml(html) {
  const $ = load(html);
  const out = {
    performance1yPct: null,
    performance3yPct: null,
    performance5yPct: null,
    performance10yPct: null,
  };

  $('h3.info-box__title').each((_, el) => {
    const title = $(el).text().trim();
    const valText = $(el).next('p.info-box__value').text();
    const pct = parsePctText(valText);
    if (pct == null) return;

    if (/1[-\s]*Year\s+Performance/i.test(title)) out.performance1yPct = pct;
    else if (/3[-\s]*Year\s+Performance/i.test(title)) out.performance3yPct = pct;
    else if (/5[-\s]*Year\s+Performance/i.test(title)) out.performance5yPct = pct;
    else if (/10[-\s]*Year\s+Performance/i.test(title)) out.performance10yPct = pct;
  });

  return out;
}
