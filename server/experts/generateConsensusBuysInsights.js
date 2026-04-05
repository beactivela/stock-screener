/**
 * LLM narrative: sector / thesis themes from consensus multi-buys + large positions (OpenRouter Kimi K2.5 by default).
 */
import { generateLlmReply, DEFAULT_EXPERTS_OPENROUTER_MODEL } from '../llm/index.js';

/**
 * @param {Record<string, unknown>} digest from buildConsensusBuysDigest
 */
export async function generateConsensusBuysInsights(digest) {
  const model = process.env.EXPERTS_INSIGHTS_MODEL || DEFAULT_EXPERTS_OPENROUTER_MODEL;

  const system = [
    'You analyze institutional "expert consensus" stock overlap for a sophisticated retail user.',
    'Data are StockCircle-derived: votes among the top-K experts by 1Y performance; position USD is reported holding size, not an audited 13F filing.',
    'Your job: (1) Cluster tickers by plausible industry / sector using ticker symbols and company names only.',
    '(2) Call out experts with positions at or above largePositionUsdThreshold on the buy side, and meaningful sell-side lines in consensusSells / largeSellPositions.',
    '(3) Propose 1–3 emerging *theses* (why capital might cluster) as clearly-labeled speculation — not facts.',
    '(4) If the digest has few tickers, keep the answer short; do not pad.',
    'Use concise sections or short bullets. 400–900 words max unless the JSON is tiny.',
    'Never invent tickers, firms, or dollar amounts not present in the JSON.',
  ].join(' ');

  const user = [
    'Digest JSON (consensus multi-buys, sell-leaning names, and large positions):',
    JSON.stringify(digest, null, 2),
  ].join('\n\n');

  const maxEnv = Number(process.env.EXPERTS_CONSENSUS_BUYS_MAX_TOKENS);
  const maxTokens = Number.isFinite(maxEnv) && maxEnv > 0 ? Math.min(2000, maxEnv) : 1200;

  const text = await generateLlmReply({
    provider: 'openrouter',
    model,
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens,
    temperature: 0.3,
  });

  return text.trim();
}
