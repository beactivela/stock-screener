/**
 * Parse WhaleWisdom filer HTML: embedded `window.__NUXT__` contains filerdata (top holdings, names).
 */
import vm from 'node:vm';

/**
 * @typedef {{
 *   slug: string,
 *   displayName: string,
 *   wwFilerId: number | null,
 *   quarterLabel: string | null,
 *   positions: Array<{
 *     ticker: string,
 *     companyName: string,
 *     pctOfPortfolio: number | null,
 *     securityType: string | null,
 *   }>,
 * }} ParsedWhalewisdomFiler
 */

/**
 * @param {unknown} nuxt
 * @returns {Record<string, unknown> | null}
 */
function findFilerData(nuxt) {
  const data = nuxt && typeof nuxt === 'object' && 'data' in nuxt ? nuxt.data : null;
  if (!data || typeof data !== 'object') return null;
  for (const k of Object.keys(data)) {
    if (k.startsWith('options:asyncdata:') && data[k] && typeof data[k] === 'object') {
      const fd = /** @type {{ filerdata?: unknown }} */ (data[k]).filerdata;
      if (fd && typeof fd === 'object') return /** @type {Record<string, unknown>} */ (fd);
    }
  }
  return null;
}

/**
 * @param {Record<string, unknown>} filerdata
 * @param {string} expectedSlug
 * @returns {ParsedWhalewisdomFiler}
 */
export function parseFilerDataObject(filerdata, expectedSlug) {
  const permalink = String(filerdata.permalink || '').trim().toLowerCase();
  if (permalink && permalink !== expectedSlug.toLowerCase()) {
    throw new Error(`WhaleWisdom: slug mismatch (expected ${expectedSlug}, got ${permalink})`);
  }

  const name = String(filerdata.name || '').trim() || expectedSlug;
  const idRaw = filerdata.id;
  const wwFilerId = typeof idRaw === 'number' && Number.isFinite(idRaw) ? idRaw : null;

  const summaries = filerdata.summaries && typeof filerdata.summaries === 'object'
    ? filerdata.summaries
    : {};
  const top = Array.isArray(summaries.top_holdings) ? summaries.top_holdings : [];

  const cq = filerdata.current_quarter && typeof filerdata.current_quarter === 'object'
    ? filerdata.current_quarter
    : null;
  const quarterLabel = cq && typeof cq.description === 'string' ? cq.description.trim() : null;

  /** @type {ParsedWhalewisdomFiler['positions']} */
  const positions = [];
  for (const row of top) {
    if (!row || typeof row !== 'object') continue;
    const sym = String(row.symbol || '').trim().toUpperCase();
    if (!sym) continue;
    const nm = String(row.name || '').trim() || sym;
    const pct = row.percent_of_portfolio;
    const pctOfPortfolio =
      typeof pct === 'number' && Number.isFinite(pct) ? pct : typeof pct === 'string' ? parseFloat(pct) : null;
    const st = row.security_type != null ? String(row.security_type).trim() : null;
    positions.push({
      ticker: sym,
      companyName: nm,
      pctOfPortfolio: pctOfPortfolio != null && Number.isFinite(pctOfPortfolio) ? pctOfPortfolio : null,
      securityType: st || null,
    });
  }

  return {
    slug: expectedSlug.toLowerCase(),
    displayName: name,
    wwFilerId,
    quarterLabel,
    positions,
  };
}

/**
 * @param {string} html
 * @param {string} expectedSlug
 * @returns {ParsedWhalewisdomFiler}
 */
export function parseWhalewisdomFilerFromHtml(html, expectedSlug) {
  const m = html.match(/<script>(window\.__NUXT__=[\s\S]+?)<\/script>/);
  if (!m) {
    throw new Error('WhaleWisdom: no __NUXT__ payload in HTML (page format changed?)');
  }

  const ctx = /** @type {{ window?: { __NUXT__?: unknown } }} */ ({ window: {} });
  vm.createContext(ctx);
  vm.runInContext(m[1], ctx);
  const nuxt = ctx.window?.__NUXT__;
  if (!nuxt) throw new Error('WhaleWisdom: __NUXT__ did not evaluate');

  const filerdata = findFilerData(nuxt);
  if (!filerdata) throw new Error('WhaleWisdom: filerdata missing in __NUXT__');

  return parseFilerDataObject(filerdata, expectedSlug);
}
