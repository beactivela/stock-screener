/**
 * Flatten overlap matrix into ranked moves for LLM summarization.
 */
import { estimatePositionDollarDeltas } from './estimatePositionDollarDeltas.js';

const DEFAULT_TOP_N = 30;

function numEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * @param {{
 *   popular: Array<{ ticker: string }>,
 *   expertWeightsByTicker: Record<string, Array<Record<string, unknown>>>,
 *   congressRecent?: { senate: object[]; house: object[] },
 *   topN?: number,
 * }} p
 */
export function buildExpertMovesDigest({
  popular,
  expertWeightsByTicker,
  congressRecent,
  topN = numEnv('EXPERTS_MOVES_DIGEST_TOP_N', DEFAULT_TOP_N),
}) {
  const moves = [];

  for (const row of popular || []) {
    const tk = String(row.ticker || '')
      .trim()
      .toUpperCase();
    if (!tk) continue;
    const list = expertWeightsByTicker[tk] || [];
    for (const w of list) {
      const actionType = String(w.actionType || 'unknown');
      const { increaseUsd, decreaseUsd } = estimatePositionDollarDeltas(
        actionType,
        w.actionPct ?? null,
        w.positionValueUsd ?? null
      );
      if (increaseUsd == null && decreaseUsd == null) continue;

      const magnitudeUsd = Math.max(increaseUsd || 0, decreaseUsd || 0);
      moves.push({
        firmName: w.firmName || w.investorSlug || 'Unknown',
        ticker: tk,
        actionType,
        pctOfPortfolio: w.pctOfPortfolio ?? null,
        estIncreaseUsd: increaseUsd,
        estDecreaseUsd: decreaseUsd,
        magnitudeUsd,
        companyName: w.companyName ?? null,
      });
    }
  }

  moves.sort((a, b) => b.magnitudeUsd - a.magnitudeUsd);
  const topMoves = moves.slice(0, topN);

  const congressLines = [];
  if (congressRecent?.senate?.length) {
    for (const r of congressRecent.senate.slice(0, 8)) {
      congressLines.push(
        `Senate: ${r.symbol || '?'} ${r.transaction_type || ''} ${r.amount_range || ''} (${r.office || [r.first_name, r.last_name].filter(Boolean).join(' ')})`
      );
    }
  }
  if (congressRecent?.house?.length) {
    for (const r of congressRecent.house.slice(0, 8)) {
      congressLines.push(
        `House: ${r.symbol || '?'} ${r.transaction_type || ''} ${r.amount_range || ''} (${r.office || [r.first_name, r.last_name].filter(Boolean).join(' ')})`
      );
    }
  }

  return {
    summary: {
      moveCount: moves.length,
      topN: topMoves.length,
    },
    topMoves,
    congressDisclosureLines: congressLines,
  };
}
