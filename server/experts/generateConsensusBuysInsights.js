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
    'You write a compact narrative on where capital appears to be flowing among tracked "smart money" overlap, for a sophisticated retail user.',
    'Data are StockCircle-derived: buy/sell votes among the top-K experts by 1Y performance; position USD is reported holding size, not trade delta or audited 13F.',
    '',
    'LENGTH (strict): The entire response must stay under 400 words. Count carefully. Prefer tight prose or short bullets; no filler. If there are many tickers, prioritize naming those in consensusMultiBuys, largeBuyPositions, and largeSellPositions; batch the rest by sector or comma-separated lists rather than skipping stocks entirely.',
    '',
    'STOCK NAMES: Cite tickers as SYMBOL (Company Name) when companyName exists in the JSON. Mention expert fund names where they add signal. Include USD from largeBuyPositions / largeSellPositions when those arrays are non-empty.',
    '',
    'STRUCTURE: 2–4 short blocks: (1) one-paragraph overview of buy vs sell tilt; (2) strongest themes / sectors with named tickers; (3) trims/sells or mixed names briefly; (4) one or two speculative "why" lines labeled as speculation.',
    '',
    'Never invent tickers, firms, or dollar amounts not present in the JSON.',
  ].join('\n');

  const user = [
    'Digest JSON (consensus rows, single-expert net buys, sells, mixed, large positions, meta.tickerCatalog):',
    JSON.stringify(digest, null, 2),
  ].join('\n\n');

  const maxEnv = Number(process.env.EXPERTS_CONSENSUS_BUYS_MAX_TOKENS);
  // ~400 English words ≈ 520–600 tokens; cap output so the model cannot ramble past the word budget.
  const maxTokens =
    Number.isFinite(maxEnv) && maxEnv > 0 ? Math.min(900, maxEnv) : 650;

  const text = await generateLlmReply({
    provider: 'openrouter',
    model,
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens,
    temperature: 0.25,
  });

  return text.trim();
}
