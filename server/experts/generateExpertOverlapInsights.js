/**
 * LLM narrative for expert overlap matrix (estimated $ moves).
 */
import { generateLlmReply, resolveExpertsInsightsConfig } from '../llm/index.js';

/** @param {Record<string, unknown>} digest */
export async function generateExpertOverlapInsights(digest) {
  const { provider, model } = resolveExpertsInsightsConfig();

  const system = [
    'You summarize institutional-style stock overlap data for a pro user.',
    'Dollar amounts are MODEL ESTIMATES from position size and action % — not audited filings.',
    'Output 2–5 sentences in plain English. Lead with the largest estimated adds and trims (by firm name + ticker + rough $).',
    'If the digest is empty or only has tiny moves, say there are no large estimated position changes in this snapshot.',
    'Optionally mention 1–2 Congress disclosure lines if present — they are separate from the expert matrix.',
    'Never invent tickers or amounts not in the JSON.',
  ].join(' ');

  const user = [
    'Analyze this JSON digest. Focus on major estimated buys/adds (estIncreaseUsd) and sells/trims (estDecreaseUsd).',
    JSON.stringify(digest, null, 2),
  ].join('\n\n');

  const text = await generateLlmReply({
    provider,
    model,
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: Math.min(900, Number(process.env.EXPERTS_INSIGHTS_MAX_TOKENS) || 600),
    temperature: 0.25,
  });

  return text.trim();
}
