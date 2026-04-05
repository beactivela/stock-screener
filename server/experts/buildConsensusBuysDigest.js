/**
 * Consensus table digest for LLM — mirrors StockcircleExperts consensus logic (top-K experts, multi-buy filter).
 * Used by POST /api/experts/consensus-buys-ai (sector / thesis narrative).
 */

/** Same as src/utils/expertConsensus.ts CONSENSUS_LARGE_BUY_USD */
export const CONSENSUS_LARGE_POSITION_USD = 50_000_000;

const TOP_K = 10;
const BUY_ACTIONS = new Set(['new_holding', 'increased']);
const SELL_ACTIONS = new Set(['decreased', 'sold']);

function normTicker(t) {
  return String(t || '')
    .trim()
    .toUpperCase();
}

/**
 * @param {Array<{ ticker: string }>} popular
 * @param {Record<string, Array<Record<string, unknown>>>} expertWeightsByTicker
 */
function buildSortedExpertUniverse(popular, expertWeightsByTicker) {
  const m = new Map();
  for (const row of popular || []) {
    const tk = normTicker(row.ticker);
    const list = expertWeightsByTicker[tk] || expertWeightsByTicker[row.ticker] || [];
    for (const w of list) {
      const slug = String(w.investorSlug || '');
      if (!slug || m.has(slug)) continue;
      m.set(slug, {
        investorSlug: slug,
        firmName: w.firmName || '',
        displayName: w.displayName || '',
        performance1yPct:
          w.performance1yPct != null && Number.isFinite(Number(w.performance1yPct))
            ? Number(w.performance1yPct)
            : null,
      });
    }
  }
  return [...m.entries()]
    .sort((a, b) => {
      const pa = a[1].performance1yPct;
      const pb = b[1].performance1yPct;
      const aHas = pa != null && Number.isFinite(pa);
      const bHas = pb != null && Number.isFinite(pb);
      if (aHas && bHas && pb !== pa) return pb - pa;
      if (aHas !== bHas) return aHas ? -1 : 1;
      return a[1].firmName.localeCompare(b[1].firmName, undefined, { sensitivity: 'base' });
    })
    .map(([, meta]) => meta);
}

function classifyAction(actionType) {
  const a = String(actionType || '');
  if (BUY_ACTIONS.has(a)) return 'buy';
  if (SELL_ACTIONS.has(a)) return 'sell';
  return 'none';
}

function refFromWeight(w) {
  const positionValueUsd =
    w.positionValueUsd != null && Number.isFinite(Number(w.positionValueUsd))
      ? Number(w.positionValueUsd)
      : null;
  const pctOfPortfolio =
    w.pctOfPortfolio != null && Number.isFinite(Number(w.pctOfPortfolio))
      ? Number(w.pctOfPortfolio)
      : null;
  return {
    investorSlug: String(w.investorSlug || ''),
    firmName: String(w.firmName || ''),
    displayName: String(w.displayName || ''),
    positionValueUsd,
    pctOfPortfolio,
    actionType: String(w.actionType || ''),
    largePosition: positionValueUsd != null && positionValueUsd >= CONSENSUS_LARGE_POSITION_USD,
  };
}

function companyNameForTicker(weights) {
  for (const w of weights || []) {
    const c = w.companyName;
    if (c != null && String(c).trim()) return String(c).trim();
  }
  return null;
}

/**
 * @param {Array<{ ticker: string }>} popular
 * @param {Record<string, Array<Record<string, unknown>>>} expertWeightsByTicker
 */
function computeTickerConsensusRows(popular, expertWeightsByTicker) {
  const universe = buildSortedExpertUniverse(popular, expertWeightsByTicker);
  const selected = universe.slice(0, Math.max(0, TOP_K));
  const slugSet = new Set(selected.map((e) => e.investorSlug));

  const rows = [];

  for (const pop of popular || []) {
    const tk = normTicker(pop.ticker);
    const weights = expertWeightsByTicker[tk] || expertWeightsByTicker[pop.ticker] || [];

    let buyVotes = 0;
    let sellVotes = 0;
    const buyers = [];
    const sellers = [];

    for (const w of weights) {
      if (!slugSet.has(String(w.investorSlug || ''))) continue;
      const side = classifyAction(w.actionType);
      if (side === 'none') continue;
      const r = refFromWeight(w);
      if (side === 'buy') {
        buyVotes += 1;
        buyers.push(r);
      } else {
        sellVotes += 1;
        sellers.push(r);
      }
    }

    const net = buyVotes - sellVotes;
    const maxSide = Math.max(buyVotes, sellVotes);
    if (maxSide < 1) continue;

    rows.push({
      ticker: tk,
      companyName: companyNameForTicker(weights),
      buyVotes,
      sellVotes,
      net,
      buyers,
      sellers,
    });
  }

  return rows;
}

/**
 * @param {{
 *   popular: Array<{ ticker: string }>,
 *   expertWeightsByTicker: Record<string, Array<Record<string, unknown>>>,
 * }} p
 */
export function buildConsensusBuysDigest({ popular, expertWeightsByTicker }) {
  const rows = computeTickerConsensusRows(popular, expertWeightsByTicker);

  const buyLeaning = [];
  const sellLeaning = [];
  const mixed = [];

  for (const r of rows) {
    if (r.net > 0) buyLeaning.push(r);
    else if (r.net < 0) sellLeaning.push(r);
    else mixed.push(r);
  }

  buyLeaning.sort((a, b) => {
    if (b.net !== a.net) return b.net - a.net;
    return a.ticker.localeCompare(b.ticker);
  });
  sellLeaning.sort((a, b) => {
    if (a.net !== b.net) return a.net - b.net;
    return a.ticker.localeCompare(b.ticker);
  });
  mixed.sort((a, b) => a.ticker.localeCompare(b.ticker));

  /** Same filter as UI: ≥2 buy votes among top-K on buy-lean tickers */
  const consensusMultiBuys = buyLeaning.filter((r) => r.buyVotes >= 2);

  const largeBuyRefs = [];
  for (const r of consensusMultiBuys) {
    for (const b of r.buyers) {
      if (b.largePosition) {
        largeBuyRefs.push({
          ticker: r.ticker,
          companyName: r.companyName,
          firmName: b.firmName,
          positionValueUsd: b.positionValueUsd,
          pctOfPortfolio: b.pctOfPortfolio,
        });
      }
    }
  }
  largeBuyRefs.sort((a, b) => (b.positionValueUsd || 0) - (a.positionValueUsd || 0));

  const largeSellRefs = [];
  for (const r of sellLeaning) {
    for (const s of r.sellers) {
      if (s.largePosition) {
        largeSellRefs.push({
          ticker: r.ticker,
          companyName: r.companyName,
          firmName: s.firmName,
          positionValueUsd: s.positionValueUsd,
          pctOfPortfolio: s.pctOfPortfolio,
          actionType: s.actionType,
        });
      }
    }
  }
  largeSellRefs.sort((a, b) => (b.positionValueUsd || 0) - (a.positionValueUsd || 0));

  return {
    meta: {
      topKExperts: TOP_K,
      largePositionUsdThreshold: CONSENSUS_LARGE_POSITION_USD,
      note:
        'Buy/sell votes are among the top-K StockCircle experts by 1Y performance. Position USD is reported holding size (not estimated trade delta). "Large" means reported position ≥ threshold.',
    },
    consensusMultiBuys,
    consensusSells: sellLeaning,
    mixedNetZero: mixed,
    largeBuyPositions: largeBuyRefs,
    largeSellPositions: largeSellRefs,
  };
}
