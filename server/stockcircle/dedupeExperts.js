/**
 * StockCircle sometimes emits duplicate holding rows (e.g. responsive DOM). Also align
 * “expert list” UI with popularity counts: only last-quarter buy/sell actions.
 */

/** @param {{ ticker: string, pctOfPortfolio?: number|null, positionValueUsd?: number|null }} a */
function betterPosition(a, b) {
  const pa = a.pctOfPortfolio ?? -1;
  const pb = b.pctOfPortfolio ?? -1;
  if (pa !== pb) return pa > pb;
  const va = a.positionValueUsd ?? -1;
  const vb = b.positionValueUsd ?? -1;
  return va > vb;
}

/**
 * One row per ticker per investor portfolio fetch (parser can duplicate blocks).
 * @template T
 * @param {T[]} positions
 * @param {(row: T) => string} tickerOf
 * @param {(a: T, b: T) => boolean} preferA
 * @returns {T[]}
 */
export function dedupeByTicker(positions, tickerOf, preferA) {
  const m = new Map();
  for (const p of positions) {
    const k = tickerOf(p);
    const ex = m.get(k);
    if (!ex) {
      m.set(k, p);
      continue;
    }
    if (preferA(p, ex)) m.set(k, p);
  }
  return [...m.values()];
}

/**
 * @typedef {{ ticker: string, pctOfPortfolio?: number|null, positionValueUsd?: number|null }} ParsedLike
 * @param {ParsedLike[]} positions
 * @returns {ParsedLike[]}
 */
export function dedupeParsedPositionsByTicker(positions) {
  return dedupeByTicker(
    positions,
    (p) => String(p.ticker || '').trim().toUpperCase(),
    (a, b) => betterPosition(
      { pctOfPortfolio: a.pctOfPortfolio, positionValueUsd: a.positionValueUsd },
      { pctOfPortfolio: b.pctOfPortfolio, positionValueUsd: b.positionValueUsd }
    )
  );
}

const BUY_SELL = new Set(['new_holding', 'increased', 'sold', 'decreased']);

/**
 * Same filters as `v_stockcircle_ticker_popularity` (buy vs sell buckets); one row per expert.
 * @param {Array<{ investor_slug: string, action_type: string, pct_of_portfolio?: number|null }>} rows
 */
function shouldPreferExpertRow(p, cur) {
  const rp = buySellRank(p.action_type);
  const rc = buySellRank(cur.action_type);
  if (rp !== rc) return rp < rc;
  return (p.pct_of_portfolio ?? -1) > (cur.pct_of_portfolio ?? -1);
}

export function dedupeDbRowsForExpertColumn(rows) {
  const m = new Map();
  for (const p of rows) {
    const at = p.action_type;
    if (!BUY_SELL.has(at)) continue;
    const slug = p.investor_slug;
    const cur = m.get(slug);
    if (!cur || shouldPreferExpertRow(p, cur)) {
      m.set(slug, p);
    }
  }
  return [...m.values()].sort((a, b) => {
    const ra = buySellRank(a.action_type);
    const rb = buySellRank(b.action_type);
    if (ra !== rb) return ra - rb;
    return (b.pct_of_portfolio ?? 0) - (a.pct_of_portfolio ?? 0);
  });
}

function buySellRank(t) {
  if (t === 'new_holding' || t === 'increased') return 0;
  if (t === 'sold' || t === 'decreased') return 1;
  return 2;
}
