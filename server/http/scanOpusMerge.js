/**
 * Shared helpers for merging cached Opus4.5 signals into API payloads (scan results + Opus endpoints).
 */
import { getBars as getBarsFromDb } from '../db/bars.js';
import { computeRankScore, isNewBuyToday } from '../opus45Signal.js';

// Map cached signal objects (entryDate may be ms number) to allScores shape for Dashboard Open Trade column.
// Dashboard expects entryDate as ISO date string and pctChange for P/L display.
export function mapCachedSignalsToAllScores(cachedSignals) {
  if (!cachedSignals?.length) return [];
  return cachedSignals.map((s) => {
    const entryMs = s.entryDate != null
      ? (s.entryDate < 1e12 ? s.entryDate * 1000 : s.entryDate)
      : null;
    const entryDateIso = entryMs != null ? new Date(entryMs).toISOString().slice(0, 10) : (typeof s.entryDate === 'string' ? s.entryDate : null);
    let pctChange = s.pctChange;
    if (pctChange == null && s.entryPrice != null && s.currentPrice != null && s.entryPrice > 0) {
      pctChange = Math.round((s.currentPrice - s.entryPrice) / s.entryPrice * 1000) / 10;
    }
    const rankScore = s.rankScore ?? computeRankScore(s.opus45Confidence ?? 0, s.daysSinceBuy);
    return {
      ticker: s.ticker,
      opus45Confidence: s.opus45Confidence ?? 0,
      opus45Grade: s.opus45Grade ?? 'F',
      entryDate: entryDateIso,
      daysSinceBuy: s.daysSinceBuy,
      isNewBuyToday: s.isNewBuyToday ?? isNewBuyToday(s.daysSinceBuy),
      rankScore,
      pctChange: pctChange ?? null,
      entryPrice: s.entryPrice ?? null,
      stopLossPrice: s.stopLossPrice ?? null,
      riskRewardRatio: s.riskRewardRatio ?? null,
    };
  });
}

// When serving from cache, signals may lack currentPrice (old cache or never set). Fetch latest close from bars so we can show P/L.
// Also set pctChange when we have entryPrice and currentPrice so Dashboard Open Trade column can display it.
export async function enrichCachedSignalsWithCurrentPrice(signals) {
  const needPrice = signals.filter((s) => s.entryPrice != null && s.currentPrice == null && s.ticker);
  if (needPrice.length > 0) {
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - 30);
    const toStr = to.toISOString().slice(0, 10);
    const fromStr = from.toISOString().slice(0, 10);
    await Promise.all(
      needPrice.map(async (s) => {
        try {
          const bars = await getBarsFromDb(s.ticker, fromStr, toStr, '1d');
          if (bars?.length) {
            const sorted = [...bars].sort((a, b) => a.t - b.t);
            s.currentPrice = sorted[sorted.length - 1].c;
          }
        } catch {
          // leave currentPrice null so P/L won't show for this ticker
        }
      })
    );
  }
  // Ensure pctChange is set for Open Trade display when we have both prices
  for (const s of signals) {
    if (s.pctChange == null && s.entryPrice != null && s.currentPrice != null && s.entryPrice > 0) {
      s.pctChange = Math.round((s.currentPrice - s.entryPrice) / s.entryPrice * 1000) / 10;
    }
  }
}
