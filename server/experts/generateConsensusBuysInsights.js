/**
 * LLM narrative: sector / thesis themes from consensus multi-buys + large positions (OpenRouter Kimi K2.5 by default).
 */
import { generateLlmReply, DEFAULT_EXPERTS_OPENROUTER_MODEL } from '../llm/index.js';

/**
 * @param {Record<string, unknown>} digest from buildConsensusBuysDigest
 */
export async function generateConsensusBuysInsights(digest) {
  const model = process.env.EXPERTS_INSIGHTS_MODEL || DEFAULT_EXPERTS_OPENROUTER_MODEL;

  // Keep system minimal so the model does not parrot long rule lists. Details live in the user block + closing instruction.
  const system = [
    'You are a financial editor writing a short column for readers.',
    'You will receive JSON: expert overlap votes and position sizes (StockCircle; not audited filings).',
    'Your ONLY job is to output the finished column text — polished prose, ready to publish.',
    'Do not output: meta-commentary, task restatement, numbered lists of rules, phrases like "The user wants", "Key constraints", "First I need to", "I will analyze", or a raw inventory of every ticker before the narrative.',
    'Do not label sections "Requirement summary" or "Process step". Integrate tickers and fund names inside flowing paragraphs.',
    'Max 400 words. Name important tickers as SYMBOL (Company) when companyName exists. Mention large USD lines from the JSON when present. Label speculation as speculation.',
  ].join('\n');

  const user = [
    'Use this data only (do not invent symbols or dollars):',
    JSON.stringify(digest, null, 2),
    '',
    'Write the column now.',
    'Start with your opening sentence of analysis immediately — no preamble.',
    'Use 2–4 short paragraphs (or tight bullets only if needed for clarity). End with the analysis; do not append checklists or repeat these instructions.',
  ].join('\n');

  const maxEnv = Number(process.env.EXPERTS_CONSENSUS_BUYS_MAX_TOKENS);
  /** Output budget for OpenRouter completion (default 5000; env may set lower; upper clamp avoids runaway spend). */
  const DEFAULT_MAX = 5000;
  const HARD_CAP = 5000;
  const maxTokens =
    Number.isFinite(maxEnv) && maxEnv > 0
      ? Math.min(HARD_CAP, maxEnv)
      : DEFAULT_MAX;

  const text = await generateLlmReply({
    provider: 'openrouter',
    model,
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens,
    temperature: 0.35,
    reasoningFallback: false,
  });

  const trimmed = text.trim();
  if (!trimmed || trimmed === 'No response.') {
    throw new Error(
      'OpenRouter returned no assistant text in `content` (reasoning-only or empty). Try again, set EXPERTS_AI_DEBUG=1 for logs, or adjust EXPERTS_INSIGHTS_MODEL.'
    );
  }
  return trimmed;
}
