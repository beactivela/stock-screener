/**
 * Parse portfolio table HTML (one or more pages) into position rows.
 */
import { load } from 'cheerio';
import { classifyActionLine } from './classifyAction.js';
import { parseShareCountAbbrev, parseUsdAbbrev } from './parseNumbers.js';

/**
 * @typedef {{
 *   ticker: string,
 *   companyName: string,
 *   actionType: string,
 *   actionPct: number | null,
 *   quarterLabel: string | null,
 *   sharesHeld: number | null,
 *   sharesRaw: string | null,
 *   positionValueUsd: number | null,
 *   pctOfPortfolio: number | null,
 *   rawLastTransaction: string,
 * }} ParsedPosition
 */

/**
 * @param {*} $ cheerio API
 * @param {*} boxEl `.share__top-box-link` element
 * @returns {number | null}
 */
export function parsePctOfPortfolioFromBox($, boxEl) {
  const raw = $(boxEl).find('.share--portfolio-big').first().text().replace(/\s+/g, ' ').trim();
  const m = raw.match(/([\d.]+)\s*%/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {string} html one portfolio page
 * @returns {ParsedPosition[]}
 */
export function parsePortfolioPageHtml(html) {
  const $ = load(html);
  const positions = [];

  $('.share__top-box-link').each((_, boxEl) => {
    const $box = $(boxEl);
    const $link = $box.find('a.share__company-link[href*="/stocks/"]').first();
    const href = $link.attr('href') || '';
    const tm = href.match(/\/stocks\/([^/?#]+)/i);
    if (!tm) return;

    const ticker = String(tm[1]).toUpperCase();
    const companyName = $box.find('h4.share__company-name').first().text().trim();

    const $buySell = $box.find('.share--buy-sell').first();
    const muted = $buySell.find('p.share__muted-text').toArray();
    const quarterLabel = muted[0] ? $(muted[0]).text().trim() : null;
    const actionLine = muted[1] ? $(muted[1]).text().trim() : '';
    const { action_type: actionType, action_pct: actionPct } = classifyActionLine(actionLine);

    const $details = $box.nextAll('.share-details').first();
    let sharesRaw = null;
    let positionValueUsd = null;
    $details.find('.share--detail-info').each((__, di) => {
      const label = $(di).find('p.share__detail-headline').text().trim();
      const val = $(di).find('p.share__detail-element').first().text().trim();
      if (/number of shares/i.test(label)) sharesRaw = val;
      if (/holdings current value/i.test(label)) positionValueUsd = parseUsdAbbrev(val);
    });

    const sharesHeld = sharesRaw != null ? parseShareCountAbbrev(sharesRaw) : null;
    const pctOfPortfolio = parsePctOfPortfolioFromBox($, boxEl);

    const rawLastTransaction = [quarterLabel, actionLine].filter(Boolean).join(' — ');

    positions.push({
      ticker,
      companyName: companyName || ticker,
      actionType,
      actionPct,
      quarterLabel,
      sharesHeld,
      sharesRaw,
      positionValueUsd,
      pctOfPortfolio,
      rawLastTransaction,
    });
  });

  return positions;
}

/**
 * Read data-next-page from load-more container (first page only typically).
 * @param {string} html
 * @returns {number | null}
 */
export function parseNextPortfolioPage(html) {
  const $ = load(html);
  const raw = $('.js-load-more-btn[data-next-page]').attr('data-next-page');
  if (raw == null || raw === '') return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}
