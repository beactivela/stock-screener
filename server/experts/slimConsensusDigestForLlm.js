/**
 * Reduce consensus digest size for LLM calls (full matrix can exceed provider context limits).
 * Rows can include dozens of buyer/seller refs each — without per-row caps the JSON can hit 500k+ tokens.
 */

function numEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** @param {unknown} s @param {number} max */
export function truncateStr(s, max) {
  const t = s == null ? '' : String(s);
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

function slimExpertRef(r, maxNameLen) {
  if (!r || typeof r !== 'object') return r;
  return {
    firmName: truncateStr(r.firmName, maxNameLen),
    positionValueUsd: r.positionValueUsd,
    pctOfPortfolio: r.pctOfPortfolio,
    actionType: r.actionType,
    largePosition: r.largePosition,
  };
}

function slimRow(r, maxRefsPerSide, maxNameLen) {
  const buyers = (r.buyers || [])
    .slice(0, maxRefsPerSide)
    .map((x) => slimExpertRef(x, maxNameLen));
  const sellers = (r.sellers || [])
    .slice(0, maxRefsPerSide)
    .map((x) => slimExpertRef(x, maxNameLen));
  return {
    ticker: r.ticker,
    companyName: truncateStr(r.companyName, 140),
    buyVotes: r.buyVotes,
    sellVotes: r.sellVotes,
    net: r.net,
    convictionScore: r.convictionScore,
    buyers,
    sellers,
  };
}

function sortByConvictionDesc(rows) {
  return [...(rows || [])].sort((a, b) => {
    const ca = a.convictionScore != null ? Number(a.convictionScore) : 0;
    const cb = b.convictionScore != null ? Number(b.convictionScore) : 0;
    if (cb !== ca) return cb - ca;
    return String(a.ticker || '').localeCompare(String(b.ticker || ''));
  });
}

/**
 * @typedef {{
 *   maxMulti: number;
 *   maxSingle: number;
 *   maxSells: number;
 *   maxMixed: number;
 *   maxLarge: number;
 *   maxRefsPerRow: number;
 *   maxExpertNameLen: number;
 * }} SlimCaps
 */

/**
 * @param {Record<string, unknown>} digest from buildConsensusBuysDigest
 * @param {SlimCaps} caps
 * @returns {Record<string, unknown>}
 */
export function buildSlimConsensusDigestAtCaps(digest, caps) {
  const {
    maxMulti,
    maxSingle,
    maxSells,
    maxMixed,
    maxLarge,
    maxRefsPerRow,
    maxExpertNameLen,
  } = caps;

  const consensusMultiBuys = sortByConvictionDesc(digest.consensusMultiBuys)
    .slice(0, maxMulti)
    .map((r) => slimRow(r, maxRefsPerRow, maxExpertNameLen));
  const singleExpertNetBuys = sortByConvictionDesc(digest.singleExpertNetBuys)
    .slice(0, maxSingle)
    .map((r) => slimRow(r, maxRefsPerRow, maxExpertNameLen));
  const consensusSells = sortByConvictionDesc(digest.consensusSells)
    .slice(0, maxSells)
    .map((r) => slimRow(r, maxRefsPerRow, maxExpertNameLen));
  const mixedNetZero = sortByConvictionDesc(digest.mixedNetZero)
    .slice(0, maxMixed)
    .map((r) => slimRow(r, maxRefsPerRow, maxExpertNameLen));

  const largeBuyPositions = [...(digest.largeBuyPositions || [])]
    .sort((a, b) => (b.positionValueUsd || 0) - (a.positionValueUsd || 0))
    .slice(0, maxLarge)
    .map((p) => {
      if (!p || typeof p !== 'object') return p;
      return {
        ticker: p.ticker,
        companyName: truncateStr(p.companyName, 140),
        firmName: truncateStr(p.firmName, maxExpertNameLen),
        positionValueUsd: p.positionValueUsd,
        pctOfPortfolio: p.pctOfPortfolio,
      };
    });
  const largeSellPositions = [...(digest.largeSellPositions || [])]
    .sort((a, b) => (b.positionValueUsd || 0) - (a.positionValueUsd || 0))
    .slice(0, maxLarge)
    .map((p) => {
      if (!p || typeof p !== 'object') return p;
      return {
        ticker: p.ticker,
        companyName: truncateStr(p.companyName, 140),
        firmName: truncateStr(p.firmName, maxExpertNameLen),
        positionValueUsd: p.positionValueUsd,
        pctOfPortfolio: p.pctOfPortfolio,
        actionType: p.actionType,
      };
    });

  const seen = new Set();
  const tickerCatalog = [];
  function pushCat(rows, bucket) {
    for (const r of rows || []) {
      const tk = String(r.ticker || '')
        .trim()
        .toUpperCase();
      const key = `${tk}|${bucket}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tickerCatalog.push({
        ticker: tk,
        companyName: r.companyName || null,
        bucket,
      });
    }
  }
  pushCat(consensusMultiBuys, 'strong_consensus_buy');
  pushCat(singleExpertNetBuys, 'single_expert_net_buy');
  pushCat(consensusSells, 'sell_leaning');
  pushCat(mixedNetZero, 'mixed_net_zero');
  tickerCatalog.sort((a, b) => a.ticker.localeCompare(b.ticker));

  const srcMeta = digest.meta && typeof digest.meta === 'object' ? digest.meta : {};
  const meta = {
    note: truncateStr(String(srcMeta.note || ''), 600),
    topKExperts: srcMeta.topKExperts,
    largePositionUsdThreshold: srcMeta.largePositionUsdThreshold,
    tickerCatalogNote: truncateStr(String(srcMeta.tickerCatalogNote || ''), 320),
    llmTruncation: {
      note:
        'Rows and expert refs are capped for the LLM context window. The app UI has full tables.',
      caps: {
        consensusMultiBuys: maxMulti,
        singleExpertNetBuys: maxSingle,
        consensusSells: maxSells,
        mixedNetZero: maxMixed,
        largeBuyPositions: maxLarge,
        largeSellPositions: maxLarge,
        expertRefsPerRow: maxRefsPerRow,
        expertNameChars: maxExpertNameLen,
      },
    },
    tickerCatalog,
  };

  return {
    meta,
    consensusMultiBuys,
    singleExpertNetBuys,
    consensusSells,
    mixedNetZero,
    largeBuyPositions,
    largeSellPositions,
  };
}

function defaultCapsFromEnv() {
  return {
    maxMulti: numEnv('EXPERTS_CONSENSUS_LLM_MAX_MULTI', 25),
    maxSingle: numEnv('EXPERTS_CONSENSUS_LLM_MAX_SINGLE', 25),
    maxSells: numEnv('EXPERTS_CONSENSUS_LLM_MAX_SELLS', 25),
    maxMixed: numEnv('EXPERTS_CONSENSUS_LLM_MAX_MIXED', 20),
    maxLarge: numEnv('EXPERTS_CONSENSUS_LLM_MAX_LARGE_POSITIONS', 25),
    maxRefsPerRow: numEnv('EXPERTS_CONSENSUS_LLM_MAX_EXPERT_REFS_PER_ROW', 8),
    maxExpertNameLen: numEnv('EXPERTS_CONSENSUS_LLM_MAX_EXPERT_NAME_CHARS', 96),
  };
}

/**
 * Iteratively shrink caps until JSON fits EXPERTS_LLM_MAX_JSON_CHARS (default ~100k chars).
 * Ollama Cloud caps total context (~262k tokens); this keeps the user JSON block safe.
 *
 * @param {Record<string, unknown>} digest from buildConsensusBuysDigest
 * @param {number} [maxJsonChars]
 * @returns {Record<string, unknown>}
 */
export function slimConsensusDigestForLlmWithBudget(digest, maxJsonChars) {
  const budget =
    maxJsonChars ??
    numEnv('EXPERTS_LLM_MAX_JSON_CHARS', 100000);

  let caps = defaultCapsFromEnv();

  for (let attempt = 0; attempt < 14; attempt++) {
    const slim = buildSlimConsensusDigestAtCaps(digest, caps);
    const n = JSON.stringify(slim).length;
    if (n <= budget) {
      if (String(process.env.EXPERTS_AI_DEBUG || '').trim() === '1') {
        console.log('[slimConsensusDigestForLlm]', { jsonChars: n, budget, attempt, caps });
      }
      return slim;
    }

    caps = {
      maxMulti: Math.max(4, Math.floor(caps.maxMulti * 0.72)),
      maxSingle: Math.max(4, Math.floor(caps.maxSingle * 0.72)),
      maxSells: Math.max(4, Math.floor(caps.maxSells * 0.72)),
      maxMixed: Math.max(3, Math.floor(caps.maxMixed * 0.72)),
      maxLarge: Math.max(4, Math.floor(caps.maxLarge * 0.72)),
      maxRefsPerRow: Math.max(2, Math.floor(caps.maxRefsPerRow * 0.75)),
      maxExpertNameLen: Math.max(32, Math.floor(caps.maxExpertNameLen * 0.85)),
    };
  }

  const fallback = buildSlimConsensusDigestAtCaps(digest, {
    maxMulti: 4,
    maxSingle: 4,
    maxSells: 4,
    maxMixed: 3,
    maxLarge: 4,
    maxRefsPerRow: 2,
    maxExpertNameLen: 48,
  });
  if (String(process.env.EXPERTS_AI_DEBUG || '').trim() === '1') {
    console.warn('[slimConsensusDigestForLlm] still large after shrink attempts', {
      jsonChars: JSON.stringify(fallback).length,
      budget,
    });
  }
  return fallback;
}

/**
 * @param {Record<string, unknown>} digest from buildConsensusBuysDigest
 * @returns {Record<string, unknown>}
 */
export function slimConsensusDigestForLlm(digest) {
  return slimConsensusDigestForLlmWithBudget(digest);
}
