/**
 * LLM narrative for expert overlap matrix (estimated $ moves).
 */
import { generateLlmReply, resolveExpertsInsightsConfig } from '../llm/index.js';
import { finalizeExpertOverlapInsightText } from './expertOverlapInsightText.js';

/** @param {Record<string, unknown>} digest */
export async function generateExpertOverlapInsights(digest) {
  const { provider, model } = resolveExpertsInsightsConfig();

  // Keep rules in system but forbid echoing them (same pattern as generateConsensusBuysInsights.js).
  const system = [
    'You are a financial editor writing a 2–5 sentence snapshot for a pro user.',
    'Dollar amounts in the JSON are MODEL ESTIMATES (position × action %) — not audited filings.',
    'Your ONLY job is to output the finished snapshot text inside XML tags (see user message).',
    'Do not output: meta-commentary, task restatement, numbered lists of rules, markdown "Requirements" sections,',
    'phrases like "The user wants", "Key requirements", "Looking at the JSON", "Data analysis", or scratchpad structure.',
    'Lead with the largest estimated trims and adds (firm name + ticker + rough $). Mention Congress lines only if present in the JSON.',
    'If there are no material moves, say so in one short sentence. Never invent tickers or $ not in the JSON.',
  ].join('\n');

  const user = [
    'JSON digest (estIncreaseUsd / estDecreaseUsd are the main signals):',
    JSON.stringify(digest, null, 2),
    '',
    'Write the snapshot now.',
    'Put the ENTIRE answer inside a single XML element, with nothing outside it:',
    '<insight>...</insight>',
    'First character inside <insight> must start the factual summary (e.g. a fund name or ticker) — no preamble.',
  ].join('\n');

  const text = await generateLlmReply({
    provider,
    model,
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: Math.min(900, Number(process.env.EXPERTS_INSIGHTS_MAX_TOKENS) || 600),
    temperature: 0.25,
    // Avoid surfacing OpenRouter `reasoning` when `content` is empty (user-facing copy only).
    reasoningFallback: false,
  });

  const finalized = finalizeExpertOverlapInsightText(text);
  const trimmed = finalized.trim();
  if (!trimmed || trimmed === 'No response.') {
    throw new Error(
      'LLM returned no usable assistant text for expert overlap (empty or reasoning-only). Try again, set EXPERTS_AI_DEBUG=1, or adjust EXPERTS_INSIGHTS_MODEL.'
    );
  }
  return trimmed;
}
