/**
 * POST /api/experts/ai-insights — LLM summary of largest estimated expert moves (overlap matrix + optional Congress lines).
 * POST /api/experts/consensus-buys-ai — sector / thesis narrative from consensus table (OpenRouter + Kimi K2.5 by default).
 */
import { buildExpertsSummaryPayload } from '../experts/buildExpertsSummaryPayload.js';
import { buildExpertMovesDigest } from '../experts/buildExpertMovesDigest.js';
import { buildConsensusBuysDigest } from '../experts/buildConsensusBuysDigest.js';
import { generateExpertOverlapInsights } from '../experts/generateExpertOverlapInsights.js';
import { generateConsensusBuysInsights } from '../experts/generateConsensusBuysInsights.js';

export function registerExpertsInsightsRoutes(app) {
  app.post('/api/experts/ai-insights', async (req, res) => {
    try {
      if (
        !process.env.OPENROUTER_API_KEY &&
        !process.env.ANTHROPIC_API_KEY &&
        !process.env.OPENAI_API_KEY
      ) {
        return res.status(503).json({
          ok: false,
          disabled: true,
          error:
            'Set OPENROUTER_API_KEY (recommended: Kimi K2.5), or ANTHROPIC_API_KEY / OPENAI_API_KEY for expert AI insights.',
        });
      }

      const summary = await buildExpertsSummaryPayload();
      if (!summary.ok) {
        return res.status(503).json({ ok: false, error: summary.error || 'Experts summary unavailable' });
      }

      const { popular, expertWeightsByTicker, congressRecent } = summary;
      if (!popular?.length) {
        return res.json({
          ok: true,
          skipped: true,
          text: 'No overlap tickers yet — run an experts sync first.',
        });
      }

      const digest = buildExpertMovesDigest({ popular, expertWeightsByTicker, congressRecent });
      if (!digest.topMoves.length && !digest.congressDisclosureLines.length) {
        return res.json({
          ok: true,
          skipped: true,
          text:
            'No estimated position changes or Congress disclosures in this snapshot — the matrix may reflect stable holds only.',
        });
      }

      const text = await generateExpertOverlapInsights(digest);
      res.json({ ok: true, text });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post('/api/experts/consensus-buys-ai', async (_req, res) => {
    try {
      if (!process.env.OPENROUTER_API_KEY) {
        return res.status(503).json({
          ok: false,
          disabled: true,
          error:
            'Set OPENROUTER_API_KEY for consensus sector analysis (default model: moonshotai/kimi-k2.5 via EXPERTS_INSIGHTS_MODEL).',
        });
      }

      const summary = await buildExpertsSummaryPayload();
      if (!summary.ok) {
        return res.status(503).json({ ok: false, error: summary.error || 'Experts summary unavailable' });
      }

      const { popular, expertWeightsByTicker } = summary;
      if (!popular?.length) {
        return res.json({
          ok: true,
          skipped: true,
          text: 'No overlap tickers yet — run an experts sync first.',
        });
      }

      const digest = buildConsensusBuysDigest({ popular, expertWeightsByTicker });
      const hasConsensus =
        digest.consensusMultiBuys.length > 0 ||
        (digest.singleExpertNetBuys?.length ?? 0) > 0 ||
        digest.consensusSells.length > 0 ||
        digest.mixedNetZero.length > 0 ||
        digest.largeBuyPositions.length > 0 ||
        digest.largeSellPositions.length > 0;

      if (!hasConsensus) {
        return res.json({
          ok: true,
          skipped: true,
          text:
            'No consensus buy/sell rows in this snapshot (or all filtered out). Try another sync when overlap data populates.',
        });
      }

      const text = await generateConsensusBuysInsights(digest);
      res.json({ ok: true, text });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}
