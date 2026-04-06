/**
 * LLM narrative: sector / thesis themes from consensus multi-buys + large positions (Ollama or OpenRouter per resolveExpertsInsightsConfig).
 */
import { generateLlmReply, resolveExpertsInsightsConfig } from '../llm/index.js';
import {
  collectAllowedTickersFromSlimDigest,
  findDisallowedTickerMentions,
} from './consensusBuysAllowlists.js';
import { filterConsensusDigestToStrongBuysOnly } from './filterConsensusDigestToStrongBuysOnly.js';
import { slimConsensusDigestForLlm } from './slimConsensusDigestForLlm.js';

/**
 * Gemini / OpenRouter sometimes emit a lone "thought" or "Thinking:" line before the column, or the
 * API counts chain-of-thought against the same completion budget — strip obvious lead-in labels only.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripConsensusBuysNarrativeLeadIn(text) {
  if (typeof text !== 'string') return '';
  let t = text.replace(/\r\n/g, '\n');
  for (;;) {
    const m = t.match(/^\s*(thought|thinking|analysis)\s*:?\s*\n+/i);
    if (m) {
      t = t.slice(m[0].length);
      continue;
    }
    break;
  }
  return t.trim();
}

/**
 * @param {Record<string, unknown>} digest from buildConsensusBuysDigest
 */
export async function generateConsensusBuysInsights(digest) {
  const { provider, model } = resolveExpertsInsightsConfig();
  const forLlm = slimConsensusDigestForLlm(filterConsensusDigestToStrongBuysOnly(digest));
  const allowedTickers = collectAllowedTickersFromSlimDigest(forLlm);
  const allowedCsv = allowedTickers.join(', ');

  const system = [
    'You are a financial editor writing a short column for readers.',
    'You will receive JSON for the Strong buys (2+) tab only: multi-expert net buy rows (buyVotes ≥ 2) and large buy position lines tied to those rows — not single-expert buys, sells, or mixed (StockCircle; not audited filings).',
    'Your ONLY job is to output the finished column text — polished prose, ready to publish.',
    'Do not output: meta-commentary, task restatement, numbered lists of rules, phrases like "The user wants", "Key constraints", "First I need to", "I will analyze".',
    'Do not print standalone labels such as "thought", "Thinking:", or "Analysis:" before the column — start with the opening sentence or the first stock block only.',
    'Do not label sections "Requirement summary" or "Process step".',
    'GROUND TRUTH — NO OUTSIDE KNOWLEDGE: The JSON block is the ONLY source of tickers, company names, fund names (firmName), dollar sizes, and percentages. Do not use financial news, prior years, ETFs, or “typical” holdings you remember. If a fact is not in the JSON, do not write it. Do not invent sector plays (e.g. “financial sector via XLF”) unless those exact tickers and rows appear in the JSON.',
    `SYMBOL RULE: You may ONLY cite stock tickers that appear in the ALLOWED_TICKERS line. Every symbol in parentheses like (TICK) and every ALL-CAPS ticker token must be from that list. If a ticker is not in ALLOWED_TICKERS, it must not appear anywhere in your text — including in examples, contrasts, or “mixed conviction” paragraphs.`,
    'MANAGER RULE: Only name investment managers using firmName strings exactly as they appear in the JSON for that ticker’s buyers, sellers, or large-position rows. Do not add famous funds from memory.',
    'ORGANIZE BY STOCK: Cover the important tickers from the JSON in separate blocks. Each block starts with one line: SYMBOL (Company Name) when companyName exists, else SYMBOL. Then 1–3 sentences for that stock only (who is buying/selling, conviction, net votes, large USD lines from the JSON). Put a blank line between stock blocks. Order blocks by conviction / importance in the data (strongest or most notable first). Do not split the same ticker across two blocks.',
    'Optional: at most one short opening sentence before the first stock block — it must not name any ticker or fund unless that string appears in the JSON.',
    'Max 400 words. Mention large USD lines from the JSON when present. Label speculation as speculation.',
  ].join('\n');

  const jsonBlock = JSON.stringify(forLlm);
  const allowLine =
    allowedTickers.length > 0
      ? `ALLOWED_TICKERS — you may cite ONLY these symbols as stocks (no others, no ETFs from memory, no invented symbols): ${allowedCsv}`
      : 'ALLOWED_TICKERS: (none) — do not cite stock symbols.';

  const user = [
    'Evaluate and describe ONLY what is in the JSON below (Strong buys 2+ tab only). Do not supplement with general market knowledge.',
    allowLine,
    'Repeat: every (TICK) and every ticker-like symbol in your answer must appear in ALLOWED_TICKERS above.',
    jsonBlock,
    '',
    'Write the column now.',
    'Use the stock-by-stock layout from the system instructions (ticker line, then sentences for that stock, blank line, repeat).',
    'End with the last stock block; do not append checklists or repeat these instructions.',
  ].join('\n');

  /** First request to the model: system + user (user embeds jsonBlock). Used for temporary size telemetry. */
  const firstCallPromptStats = {
    systemChars: system.length,
    userChars: user.length,
    jsonChars: jsonBlock.length,
    totalFirstCallChars: system.length + user.length,
  };

  if (String(process.env.EXPERTS_AI_DEBUG || '').trim() === '1') {
    console.log('[consensus-buys-ai] prompt sizes', { jsonChars: jsonBlock.length, userChars: user.length });
  }
  const promptLog = String(process.env.EXPERTS_CONSENSUS_PROMPT_LOG || '').trim() === '1';
  if (promptLog) {
    console.log('[consensus-buys-ai] FIRST_LLM_CALL char counts (temporary telemetry)', firstCallPromptStats);
  }

  const maxEnv = Number(process.env.EXPERTS_CONSENSUS_BUYS_MAX_TOKENS);
  /** Gemini / reasoning models count hidden chain-of-thought + visible text toward the same completion cap — budget high enough for full column + overhead. */
  const DEFAULT_MAX = 8192;
  const HARD_CAP = 16384;
  const maxTokens =
    Number.isFinite(maxEnv) && maxEnv > 0
      ? Math.min(HARD_CAP, maxEnv)
      : DEFAULT_MAX;

  const maxContEnv = Number(process.env.EXPERTS_CONSENSUS_BUYS_MAX_CONTINUATIONS);
  const maxContinuationRounds =
    Number.isFinite(maxContEnv) && maxContEnv >= 0 ? Math.min(4, maxContEnv) : 2;

  const CONTINUATION_USER = [
    'Your previous answer was cut off by the output limit.',
    'Continue exactly where you stopped. Do NOT repeat paragraphs or sentences already written.',
    'Complete the incomplete word or sentence, then finish the remaining stock blocks.',
    'Ground every fact in the JSON only; obey ALLOWED_TICKERS and firm names from the JSON.',
  ].join(' ');

  /** Returns `{ text, finishReason }` so we can chain when the API returns `finish_reason: length`. */
  const callWithMeta = async (messages, reasoningFallback) => {
    const out = await generateLlmReply({
      provider,
      model,
      system,
      messages,
      maxTokens,
      temperature: 0.18,
      reasoningFallback,
      returnFinishReason: true,
    });
    if (out && typeof out === 'object' && 'text' in out) {
      return /** @type {{ text: string, finishReason: string | null }} */ (out);
    }
    return { text: String(out ?? ''), finishReason: null };
  };

  /**
   * Gemini / reasoning models often hit `max_tokens` mid-sentence; request one or more continuations.
   * @param {Array<{ role: string, content: string }>} seedMessages
   */
  async function runWithContinuation(seedMessages, reasoningFallbackFirst) {
    let messages = [...seedMessages];
    let { text: lastSegment, finishReason } = await callWithMeta(messages, reasoningFallbackFirst);
    lastSegment = stripConsensusBuysNarrativeLeadIn(lastSegment.trim());
    let accumulated = lastSegment;

    let continuations = 0;
    while (
      finishReason === 'length' &&
      continuations < maxContinuationRounds &&
      lastSegment &&
      lastSegment !== 'No response.'
    ) {
      continuations += 1;
      messages = [
        ...messages,
        { role: 'assistant', content: lastSegment },
        { role: 'user', content: CONTINUATION_USER },
      ];
      const next = await callWithMeta(messages, true);
      lastSegment = stripConsensusBuysNarrativeLeadIn(next.text.trim());
      accumulated = accumulated.trimEnd() + '\n\n' + lastSegment;
      finishReason = next.finishReason ?? null;
    }

    if (continuations > 0 && String(process.env.EXPERTS_AI_DEBUG || '').trim() === '1') {
      console.warn(
        `[consensus-buys-ai] stitched ${continuations} continuation(s) after finish_reason=length`
      );
    }

    return accumulated;
  }

  let text = await runWithContinuation([{ role: 'user', content: user }], false);

  if (!text || text === 'No response.') {
    throw new Error(
      'LLM returned no assistant text in `content` (reasoning-only or empty). Try again, set EXPERTS_AI_DEBUG=1 for logs, or adjust EXPERTS_INSIGHTS_MODEL / provider.'
    );
  }

  let bad = findDisallowedTickerMentions(text, allowedTickers);
  if (bad.length > 0 && allowedTickers.length > 0) {
    if (String(process.env.EXPERTS_AI_DEBUG || '').trim() === '1') {
      console.warn('[consensus-buys-ai] disallowed ticker mentions, retrying', { bad });
    }
    const firstDraft = text;
    const fixUser = [
      'Your previous answer cited stock symbols that are NOT in the dataset and NOT in ALLOWED_TICKERS:',
      bad.join(', '),
      '',
      `ALLOWED_TICKERS (only symbols you may use): ${allowedCsv}`,
      '',
      'Rewrite the ENTIRE column from scratch. Use ONLY those tickers. Every (TICK) parenthetical must be one of them. Do not name ETFs, funds, or dollar amounts unless they appear in the JSON with matching firmName/ticker. Do not use outside knowledge.',
      '',
      'Previous draft (do not copy sentences; replace with JSON-grounded text only):',
      firstDraft.slice(0, 4000),
    ].join('\n');

    // Retry: allow reasoning fallback — some models (e.g. Gemini via OpenRouter) omit `content` on follow-ups.
    text = await runWithContinuation(
      [
        { role: 'user', content: user },
        { role: 'assistant', content: firstDraft },
        { role: 'user', content: fixUser },
      ],
      true
    );

    if (!text || text === 'No response.') {
      console.warn(
        '[consensus-buys-ai] hallucination-correct pass returned no text; using first draft (may include extra symbols)'
      );
      text = firstDraft;
    }

    bad = findDisallowedTickerMentions(text, allowedTickers);
    if (bad.length > 0) {
      console.warn('[consensus-buys-ai] disallowed tickers remain after retry', { bad: bad.join(', ') });
      if (String(process.env.EXPERTS_CONSENSUS_REJECT_ON_HALLUCINATION || '').trim() === '1') {
        throw new Error(
          `Consensus narrative cited symbols not in the table: ${bad.join(', ')}. Adjust the model or prompt.`
        );
      }
    }
  }

  /** For pasting into another chat UI — same strings as the first OpenAI-style `system` + `user` messages. */
  const rawFirstLlmPrompt = promptLog
    ? {
        system,
        user,
        promptCopyText: `--- SYSTEM ---\n\n${system}\n\n--- USER ---\n\n${user}`,
      }
    : undefined;

  return {
    text: stripConsensusBuysNarrativeLeadIn(text),
    firstCallPromptStats,
    rawFirstLlmPrompt,
  };
}
