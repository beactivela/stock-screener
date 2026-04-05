/**
 * Consensus table digest for LLM — mirrors StockcircleExperts conviction scoring (blended perf sort, top-K cap, cross-source).
 * Used by POST /api/experts/consensus-buys-ai (sector / thesis narrative).
 */

/** Same as src/utils/expertConsensus.ts CONSENSUS_LARGE_BUY_USD */
export const CONSENSUS_LARGE_POSITION_USD = 50_000_000;

/** Same as src/utils/expertConsensus.ts DEFAULT_CONSENSUS_TOP_K_CAP */
export const DIGEST_TOP_K_CAP = 15;

const BUY_ACTIONS = new Set(['new_holding', 'increased']);
const SELL_ACTIONS = new Set(['decreased', 'sold']);

const CONVICTION_WEIGHTS = {
  overlapBreadth: 0.25,
  positionConviction: 0.3,
  performanceSignal: 0.2,
  actionStrength: 0.15,
};

const CROSS_WW = 1.2;
const CROSS_CONG = 1.1;

function normTicker(t) {
  return String(t || '')
    .trim()
    .toUpperCase();
}

function blendedPerformanceMetric(w) {
  const p1 = w.performance1yPct;
  const p3 = w.performance3yPct;
  const p5 = w.performance5yPct;
  const ok = (p) => p != null && Number.isFinite(Number(p));
  const n1 = ok(p1) ? Number(p1) : null;
  const n3 = ok(p3) ? Number(p3) : null;
  const n5 = ok(p5) ? Number(p5) : null;
  if (n1 != null && n3 != null && n5 != null) return 0.5 * n1 + 0.3 * n3 + 0.2 * n5;
  if (n1 != null && n3 != null) return 0.625 * n1 + 0.375 * n3;
  if (n1 != null && n5 != null) return (5 / 7) * n1 + (2 / 7) * n5;
  if (n3 != null && n5 != null) return 0.6 * n3 + 0.4 * n5;
  if (n1 != null) return n1;
  if (n3 != null) return n3;
  if (n5 != null) return n5;
  return null;
}

function expertSortKey(w) {
  const blended = blendedPerformanceMetric(w);
  const y1 = w.performance1yPct;
  const primary =
    blended != null && Number.isFinite(blended)
      ? blended
      : y1 != null && Number.isFinite(Number(y1))
        ? Number(y1)
        : Number.NEGATIVE_INFINITY;
  const secondary =
    y1 != null && Number.isFinite(Number(y1)) ? Number(y1) : Number.NEGATIVE_INFINITY;
  return { primary, secondary, firm: String(w.firmName || '') };
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
        performance3yPct:
          w.performance3yPct != null && Number.isFinite(Number(w.performance3yPct))
            ? Number(w.performance3yPct)
            : null,
        performance5yPct:
          w.performance5yPct != null && Number.isFinite(Number(w.performance5yPct))
            ? Number(w.performance5yPct)
            : null,
        _sort: expertSortKey(w),
      });
    }
  }
  return [...m.entries()]
    .sort((a, b) => {
      const sa = a[1]._sort;
      const sb = b[1]._sort;
      if (sb.primary !== sa.primary) return sb.primary - sa.primary;
      if (sb.secondary !== sa.secondary) return sb.secondary - sa.secondary;
      return sa.firm.localeCompare(sb.firm, undefined, { sensitivity: 'base' });
    })
    .map(([, meta]) => {
      const { _sort: _, ...rest } = meta;
      return rest;
    });
}

function classifyAction(actionType) {
  const a = String(actionType || '');
  if (BUY_ACTIONS.has(a)) return 'buy';
  if (SELL_ACTIONS.has(a)) return 'sell';
  return 'none';
}

function actionStrengthMultiplier(actionType, side) {
  const a = String(actionType || '');
  if (side === 'buy') {
    if (a === 'new_holding') return 1.5;
    if (a === 'increased') return 1.0;
    return 1.0;
  }
  if (a === 'sold') return 1.5;
  if (a === 'decreased') return 1.0;
  return 1.0;
}

function buildExpertMaxPctByPortfolio(expertWeightsByTicker) {
  const m = new Map();
  for (const tk of Object.keys(expertWeightsByTicker || {})) {
    for (const w of expertWeightsByTicker[tk] || []) {
      const slug = String(w.investorSlug || '');
      const pct = w.pctOfPortfolio;
      if (pct == null || !Number.isFinite(Number(pct))) continue;
      const v = Number(pct);
      const cur = m.get(slug);
      if (cur == null || v > cur) m.set(slug, v);
    }
  }
  return m;
}

function refFromWeight(w, maxPctBySlug) {
  const positionValueUsd =
    w.positionValueUsd != null && Number.isFinite(Number(w.positionValueUsd))
      ? Number(w.positionValueUsd)
      : null;
  const pctOfPortfolio =
    w.pctOfPortfolio != null && Number.isFinite(Number(w.pctOfPortfolio))
      ? Number(w.pctOfPortfolio)
      : null;
  const slug = String(w.investorSlug || '');
  const maxP = maxPctBySlug.get(slug);
  const isTop =
    pctOfPortfolio != null &&
    maxP != null &&
    Number.isFinite(maxP) &&
    Math.abs(pctOfPortfolio - maxP) < 1e-6;
  return {
    investorSlug: slug,
    firmName: String(w.firmName || ''),
    displayName: String(w.displayName || ''),
    positionValueUsd,
    pctOfPortfolio,
    actionType: String(w.actionType || ''),
    largePosition: positionValueUsd != null && positionValueUsd >= CONSENSUS_LARGE_POSITION_USD,
    isTopHolding: isTop,
  };
}

function companyNameForTicker(weights) {
  for (const w of weights || []) {
    const c = w.companyName;
    if (c != null && String(c).trim()) return String(c).trim();
  }
  return null;
}

function positionConvictionNormalized(avgPct) {
  if (avgPct == null || !Number.isFinite(avgPct) || avgPct <= 0) return 0;
  return Math.min(100, (avgPct / 20) * 100);
}

function computeConvictionComposite(input) {
  const {
    buyVotes,
    sellVotes,
    effectiveTopK,
    avgBuyerPct,
    avgSellerPct,
    buyerPerfAvg,
    sellerPerfAvg,
    buyerActionAvg,
    sellerActionAvg,
  } = input;

  const dominantIsBuy = buyVotes >= sellVotes;
  const maxVotes = Math.max(buyVotes, sellVotes);
  const overlapBreadth =
    effectiveTopK > 0 ? Math.min(100, (maxVotes / effectiveTopK) * 100) : 0;

  const avgPct = dominantIsBuy ? avgBuyerPct : avgSellerPct;
  const positionConviction = positionConvictionNormalized(avgPct);

  const perfAvg = dominantIsBuy ? buyerPerfAvg : sellerPerfAvg;
  let performanceSignal = 0;
  if (perfAvg != null && Number.isFinite(perfAvg)) {
    performanceSignal = Math.min(100, Math.max(0, perfAvg));
  }

  const actionAvg = dominantIsBuy ? buyerActionAvg : sellerActionAvg;
  let actionStrength = 0;
  if (actionAvg != null && Number.isFinite(actionAvg) && actionAvg > 0) {
    actionStrength = Math.min(100, (actionAvg / 1.5) * 100);
  }

  const { overlapBreadth: w1, positionConviction: w2, performanceSignal: w3, actionStrength: w4 } =
    CONVICTION_WEIGHTS;
  const score = w1 * overlapBreadth + w2 * positionConviction + w3 * performanceSignal + w4 * actionStrength;

  return {
    score,
    factors: { overlapBreadth, positionConviction, performanceSignal, actionStrength },
  };
}

function applyCrossSource(score, ww, congress) {
  let s = score;
  if (ww) s *= CROSS_WW;
  if (congress) s *= CROSS_CONG;
  return Math.min(100, s);
}

/**
 * @param {Array<{ ticker: string }>} popular
 * @param {Record<string, Array<Record<string, unknown>>>} expertWeightsByTicker
 * @param {Record<string, { whalewisdom?: boolean; congress?: boolean }> | undefined} crossSourceByTicker
 */
function computeTickerConsensusRows(popular, expertWeightsByTicker, crossSourceByTicker) {
  const maxPctBySlug = buildExpertMaxPctByPortfolio(expertWeightsByTicker);
  const universe = buildSortedExpertUniverse(popular, expertWeightsByTicker);
  const effectiveTopK =
    universe.length <= 0 ? 0 : Math.min(DIGEST_TOP_K_CAP, universe.length);
  const selected = universe.slice(0, effectiveTopK);
  const slugSet = new Set(selected.map((e) => e.investorSlug));

  const rows = [];

  for (const pop of popular || []) {
    const tk = normTicker(pop.ticker);
    const weights = expertWeightsByTicker[tk] || expertWeightsByTicker[pop.ticker] || [];

    let buyVotes = 0;
    let sellVotes = 0;
    const buyers = [];
    const sellers = [];
    let buyerPerfSum = 0;
    let buyerPerfN = 0;
    let sellerPerfSum = 0;
    let sellerPerfN = 0;
    let buyerActionSum = 0;
    let buyerActionN = 0;
    let sellerActionSum = 0;
    let sellerActionN = 0;

    for (const w of weights) {
      if (!slugSet.has(String(w.investorSlug || ''))) continue;
      const side = classifyAction(w.actionType);
      if (side === 'none') continue;

      const am = actionStrengthMultiplier(w.actionType, side);
      const r = refFromWeight(w, maxPctBySlug);
      const bp = blendedPerformanceMetric(w);

      if (side === 'buy') {
        buyVotes += 1;
        buyers.push(r);
        if (bp != null && Number.isFinite(bp)) {
          buyerPerfSum += bp;
          buyerPerfN += 1;
        }
        buyerActionSum += am;
        buyerActionN += 1;
      } else {
        sellVotes += 1;
        sellers.push(r);
        if (bp != null && Number.isFinite(bp)) {
          sellerPerfSum += bp;
          sellerPerfN += 1;
        }
        sellerActionSum += am;
        sellerActionN += 1;
      }
    }

    const net = buyVotes - sellVotes;
    const maxSide = Math.max(buyVotes, sellVotes);
    if (maxSide < 1) continue;

    const avgBuyerPct =
      buyers.length > 0
        ? buyers.reduce((s, b) => s + (b.pctOfPortfolio ?? 0), 0) / buyers.length
        : null;
    const avgSellerPct =
      sellers.length > 0
        ? sellers.reduce((s, x) => s + (x.pctOfPortfolio ?? 0), 0) / sellers.length
        : null;

    const buyerPerfAvg = buyerPerfN > 0 ? buyerPerfSum / buyerPerfN : null;
    const sellerPerfAvg = sellerPerfN > 0 ? sellerPerfSum / sellerPerfN : null;
    const buyerActionAvg = buyerActionN > 0 ? buyerActionSum / buyerActionN : null;
    const sellerActionAvg = sellerActionN > 0 ? sellerActionSum / sellerActionN : null;

    const { score: rawComposite, factors } = computeConvictionComposite({
      buyVotes,
      sellVotes,
      effectiveTopK,
      avgBuyerPct,
      avgSellerPct,
      buyerPerfAvg,
      sellerPerfAvg,
      buyerActionAvg,
      sellerActionAvg,
    });

    const cs = crossSourceByTicker?.[tk] ?? crossSourceByTicker?.[pop.ticker];
    const crossWw = Boolean(cs?.whalewisdom);
    const crossCong = Boolean(cs?.congress);
    const convictionScore = applyCrossSource(rawComposite, crossWw, crossCong);

    rows.push({
      ticker: tk,
      companyName: companyNameForTicker(weights),
      buyVotes,
      sellVotes,
      net,
      buyers,
      sellers,
      effectiveTopK,
      convictionScore,
      convictionScoreBeforeCrossSource: rawComposite,
      convictionFactors: factors,
      crossSourceWhalewisdom: crossWw,
      crossSourceCongress: crossCong,
    });
  }

  return rows;
}

function sumBuyerPositionUsd(row) {
  let s = 0;
  for (const b of row.buyers || []) {
    const v = b.positionValueUsd;
    if (v != null && Number.isFinite(Number(v))) s += Number(v);
  }
  return s;
}

/**
 * @param {{
 *   popular: Array<{ ticker: string }>,
 *   expertWeightsByTicker: Record<string, Array<Record<string, unknown>>>,
 *   crossSourceByTicker?: Record<string, { whalewisdom?: boolean; congress?: boolean }>,
 * }} p
 */
export function buildConsensusBuysDigest({ popular, expertWeightsByTicker, crossSourceByTicker }) {
  const rows = computeTickerConsensusRows(popular, expertWeightsByTicker, crossSourceByTicker);

  const buyLeaning = [];
  const sellLeaning = [];
  const mixed = [];

  for (const r of rows) {
    if (r.net > 0) buyLeaning.push(r);
    else if (r.net < 0) sellLeaning.push(r);
    else mixed.push(r);
  }

  buyLeaning.sort((a, b) => {
    if (b.buyVotes !== a.buyVotes) return b.buyVotes - a.buyVotes;
    const usdB = sumBuyerPositionUsd(b);
    const usdA = sumBuyerPositionUsd(a);
    if (usdB !== usdA) return usdB - usdA;
    return a.ticker.localeCompare(b.ticker);
  });
  sellLeaning.sort((a, b) => {
    if (a.net !== b.net) return a.net - b.net;
    return a.ticker.localeCompare(b.ticker);
  });
  mixed.sort((a, b) => a.ticker.localeCompare(b.ticker));

  /** Same filter as UI: ≥2 buy votes among top-K on buy-lean tickers */
  const consensusMultiBuys = buyLeaning.filter((r) => r.buyVotes >= 2);
  /** Net buys with only one ranked expert voting buy (same as UI "other net buys") — include so the LLM names these tickers too. */
  const singleExpertNetBuys = buyLeaning.filter((r) => r.buyVotes === 1);

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

  /** Flat index so downstream LLM prompts can require naming every symbol once. */
  const tickerCatalog = [];
  const seen = new Set();
  function pushCatalog(rows, bucket) {
    for (const r of rows || []) {
      const tkc = normTicker(r.ticker);
      const key = `${tkc}|${bucket}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tickerCatalog.push({
        ticker: tkc,
        companyName: r.companyName || null,
        bucket,
      });
    }
  }
  pushCatalog(consensusMultiBuys, 'strong_consensus_buy');
  pushCatalog(singleExpertNetBuys, 'single_expert_net_buy');
  pushCatalog(sellLeaning, 'sell_leaning');
  pushCatalog(mixed, 'mixed_net_zero');
  tickerCatalog.sort((a, b) => a.ticker.localeCompare(b.ticker));

  return {
    meta: {
      topKExperts: DIGEST_TOP_K_CAP,
      largePositionUsdThreshold: CONSENSUS_LARGE_POSITION_USD,
      note:
        'Experts ranked by blended trailing performance (1Y/3Y/5Y). Votes and conviction scores use the top-K panel. Cross-source: ×1.2 if ticker appears in latest WhaleWisdom 13F snapshot, ×1.1 if in latest Congress trades. Position USD is reported holding size.',
      tickerCatalog,
      tickerCatalogNote:
        'Use meta.tickerCatalog for a complete list of tickers in this digest with company names when present. Cite tickers as TICKER (Company Name) when companyName is non-null.',
    },
    consensusMultiBuys,
    singleExpertNetBuys,
    consensusSells: sellLeaning,
    mixedNetZero: mixed,
    largeBuyPositions: largeBuyRefs,
    largeSellPositions: largeSellRefs,
  };
}
