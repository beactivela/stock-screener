import { truncateStr } from './slimConsensusDigestForLlm.js';

/**
 * @param {Record<string, unknown>} digest from buildExpertMovesDigest
 * @returns {Record<string, unknown>}
 */
export function slimExpertMovesDigestForLlm(digest) {
  const topMoves = (digest.topMoves || []).map((m) => {
    if (!m || typeof m !== 'object') return m;
    return {
      firmName: truncateStr(m.firmName, 120),
      ticker: m.ticker,
      actionType: m.actionType,
      pctOfPortfolio: m.pctOfPortfolio,
      estIncreaseUsd: m.estIncreaseUsd,
      estDecreaseUsd: m.estDecreaseUsd,
      magnitudeUsd: m.magnitudeUsd,
      companyName: m.companyName != null ? truncateStr(m.companyName, 120) : null,
    };
  });

  const maxLines = Number(process.env.EXPERTS_MOVES_LLM_MAX_CONGRESS_LINES);
  const cap =
    Number.isFinite(maxLines) && maxLines > 0 ? Math.floor(maxLines) : 12;
  const congressDisclosureLines = (digest.congressDisclosureLines || [])
    .slice(0, cap)
    .map((line) => truncateStr(line, 500));

  return {
    summary: digest.summary,
    topMoves,
    congressDisclosureLines,
  };
}
