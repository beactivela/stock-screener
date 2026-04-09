/**
 * LLM adapter: minimal wrapper for Anthropic, OpenAI, OpenRouter, and Ollama (OpenAI-compatible) chat.
 * Keeps provider/model selection centralized for multi-agent orchestration.
 */

/** Default model for POST /api/experts/ai-insights when using OpenRouter. */
export const DEFAULT_EXPERTS_OPENROUTER_MODEL = 'gemini-3-flash-preview:cloud';

/** Default model for expert insights when using Ollama (cloud model name). */
export const DEFAULT_EXPERTS_OLLAMA_MODEL = 'minimax-m2.7:cloud';

export function normalizeProvider(provider) {
  const p = String(provider || '').trim().toLowerCase();
  if (!p || p === 'anthropic') return 'anthropic';
  if (p === 'openai') return 'openai';
  if (p === 'openrouter') return 'openrouter';
  if (p === 'ollama') return 'ollama';
  throw new Error(`Unsupported LLM provider: ${provider}`);
}

/** OpenAI-compatible base URL: local default or Ollama Cloud when `OLLAMA_API_KEY` is set. */
export function resolveOllamaOpenAiBaseUrl() {
  const explicit = String(process.env.OLLAMA_BASE_URL || '').trim().replace(/\/$/, '');
  if (explicit) return explicit;
  if (process.env.OLLAMA_API_KEY) return 'https://ollama.com/v1';
  return 'http://127.0.0.1:11434/v1';
}

/**
 * Provider + model for expert overlap AI snapshot.
 * Precedence: EXPERTS_INSIGHTS_PROVIDER (if set) → else Ollama when OLLAMA_API_KEY exists → else OpenRouter → else AGENT_DIALOGUE / Anthropic / OpenAI.
 */
export function resolveExpertsInsightsConfig() {
  const explicit = String(process.env.EXPERTS_INSIGHTS_PROVIDER || '').trim().toLowerCase();

  if (explicit === 'ollama') {
    return {
      provider: 'ollama',
      model: process.env.EXPERTS_INSIGHTS_MODEL || DEFAULT_EXPERTS_OLLAMA_MODEL,
    };
  }
  if (explicit === 'openrouter') {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('EXPERTS_INSIGHTS_PROVIDER=openrouter requires OPENROUTER_API_KEY.');
    return {
      provider: 'openrouter',
      model: process.env.EXPERTS_INSIGHTS_MODEL || DEFAULT_EXPERTS_OPENROUTER_MODEL,
    };
  }
  if (explicit === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('EXPERTS_INSIGHTS_PROVIDER=openai requires OPENAI_API_KEY.');
    return {
      provider: 'openai',
      model: process.env.EXPERTS_INSIGHTS_MODEL || 'gpt-4o-mini',
    };
  }
  if (explicit === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('EXPERTS_INSIGHTS_PROVIDER=anthropic requires ANTHROPIC_API_KEY.');
    const cfg = resolveDialogueConfig({});
    return {
      provider: 'anthropic',
      model: process.env.EXPERTS_INSIGHTS_MODEL || cfg.modelFast || 'claude-sonnet-4-5',
    };
  }

  if (process.env.OLLAMA_API_KEY) {
    return {
      provider: 'ollama',
      model: process.env.EXPERTS_INSIGHTS_MODEL || DEFAULT_EXPERTS_OLLAMA_MODEL,
    };
  }
  if (process.env.OPENROUTER_API_KEY) {
    return {
      provider: 'openrouter',
      model: process.env.EXPERTS_INSIGHTS_MODEL || DEFAULT_EXPERTS_OPENROUTER_MODEL,
    };
  }

  const cfg = resolveDialogueConfig({});
  const model =
    process.env.EXPERTS_INSIGHTS_MODEL ||
    cfg.modelFast ||
    'claude-sonnet-4-5';
  return { provider: cfg.provider, model };
}

export function resolveDialogueConfig(overrides = {}) {
  const explicitProvider = overrides.provider || process.env.AGENT_DIALOGUE_PROVIDER;
  const inferredProvider = explicitProvider
    ? explicitProvider
    : (process.env.ANTHROPIC_API_KEY ? 'anthropic' : (process.env.OPENAI_API_KEY ? 'openai' : 'anthropic'));
  const provider = normalizeProvider(inferredProvider);
  const modelStrong =
    overrides.modelStrong ||
    process.env.AGENT_DIALOGUE_MODEL_STRONG ||
    process.env.ANTHROPIC_CHAT_MODEL ||
    'claude-sonnet-4-5';
  const modelFast =
    overrides.modelFast ||
    process.env.AGENT_DIALOGUE_MODEL_FAST ||
    modelStrong;

  const maxTokens =
    Number(overrides.maxTokens || process.env.AGENT_DIALOGUE_MAX_TOKENS) || 800;

  return { provider, modelStrong, modelFast, maxTokens };
}

function normalizeMessages(messages = []) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => m && typeof m.content === 'string' && m.content.trim().length > 0)
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));
}

/**
 * OpenAI-compatible chat: `message.content` may be a string, null, or an array of text/tool parts.
 * OpenRouter recommends HTTP-Referer + X-Title; without them some models return empty content.
 *
 * Some models put chain-of-thought in `reasoning` while leaving `content` empty — set
 * `reasoningFallback: false` for user-facing copy so we do not surface internal reasoning.
 *
 * @param {Record<string, unknown> | null | undefined} message
 * @param {{ reasoningFallback?: boolean }} [options]
 * @returns {string}
 */
export function assistantTextFromChatMessage(message, options = {}) {
  const { reasoningFallback = true } = options;
  if (!message || typeof message !== 'object') return '';
  const c = message.content;
  if (typeof c === 'string') {
    const t = c.trim();
    if (t) return t;
  } else if (Array.isArray(c)) {
    const parts = [];
    for (const part of c) {
      if (typeof part === 'string') parts.push(part);
      else if (part && typeof part === 'object') {
        const ty = part.type;
        // OpenRouter / Gemini: chain-of-thought chunks; omit from user-facing copy unless we use reasoning fallback below.
        if (ty === 'reasoning' && !reasoningFallback) continue;
        if (ty === 'tool_calls' || ty === 'function_call') continue;
        if ('text' in part && part.text != null) parts.push(String(part.text));
        else if (part.type === 'text' && 'text' in part) parts.push(String(part.text ?? ''));
      }
    }
    const joined = parts.join('').trim();
    if (joined) return joined;
  }
  if (reasoningFallback) {
    const reasoning = message.reasoning;
    if (typeof reasoning === 'string' && reasoning.trim()) return reasoning.trim();
  }
  return '';
}

function openRouterDefaultHeaders() {
  return {
    'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER || 'http://127.0.0.1:5174',
    'X-Title': process.env.OPENROUTER_APP_TITLE || 'stock-screener',
  };
}

/**
 * OpenRouter extends the OpenAI usage object with `cost` (USD charged). See usage accounting docs.
 * @param {unknown} response
 * @returns {{ costUsd: number | null, promptTokens: number | null, completionTokens: number | null, totalTokens: number | null } | null}
 */
export function extractOpenRouterUsageFromResponse(response) {
  const u = response?.usage;
  if (!u || typeof u !== 'object') return null;
  const costRaw = u.cost ?? u.total_cost;
  const costUsd =
    typeof costRaw === 'number' && Number.isFinite(costRaw)
      ? costRaw
      : typeof costRaw === 'string' && costRaw.trim() !== ''
        ? Number(costRaw)
        : null;
  return {
    costUsd: costUsd != null && Number.isFinite(costUsd) ? costUsd : null,
    promptTokens: typeof u.prompt_tokens === 'number' ? u.prompt_tokens : null,
    completionTokens: typeof u.completion_tokens === 'number' ? u.completion_tokens : null,
    totalTokens: typeof u.total_tokens === 'number' ? u.total_tokens : null,
  };
}

/**
 * @param {{ provider: string, model: string, system?: string, messages?: unknown[], maxTokens?: number, temperature?: number, reasoningFallback?: boolean, returnFinishReason?: boolean, returnOpenRouterUsage?: boolean }} opts
 * @returns {Promise<string | { text: string, finishReason: string | null, openRouterUsage?: object | null }>}
 */
export async function generateLlmReply({
  provider,
  model,
  system = '',
  messages = [],
  maxTokens = 800,
  temperature = 0.2,
  /** When false, ignore `message.reasoning` (avoids showing model scratchpad on OpenAI-compatible APIs). */
  reasoningFallback = true,
  /** When true, return `{ text, finishReason }` so callers can continue on `length` / max_tokens. */
  returnFinishReason = false,
  /** When true (OpenRouter only), return `{ text, finishReason, openRouterUsage }` with billed USD when the API provides it. */
  returnOpenRouterUsage = false,
}) {
  const normalizedProvider = normalizeProvider(provider);
  const cleanMessages = normalizeMessages(messages);

  const pack = (text, finishReason) => {
    if (returnFinishReason) {
      return { text, finishReason: finishReason ?? null };
    }
    return text;
  };

  if (normalizedProvider === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set.');

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system: system || undefined,
      messages: cleanMessages,
    });

    const text =
      response.content
        ?.filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim() || 'No response.';
    const fr =
      response.stop_reason === 'max_tokens' ? 'length' : response.stop_reason != null ? String(response.stop_reason) : null;
    return pack(text, fr);
  }

  if (normalizedProvider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not set.');

    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({ apiKey });

    const openaiMessages = [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...cleanMessages,
    ];

    const response = await client.chat.completions.create({
      model,
      messages: openaiMessages,
      max_tokens: maxTokens,
      temperature,
    });

    const choice = response.choices?.[0];
    const text =
      assistantTextFromChatMessage(choice?.message, { reasoningFallback }) ||
      'No response.';
    return pack(text, choice?.finish_reason ?? null);
  }

  if (normalizedProvider === 'ollama') {
    const OpenAI = (await import('openai')).default;
    const apiKey = process.env.OLLAMA_API_KEY || 'ollama';
    const baseURL = resolveOllamaOpenAiBaseUrl();
    const client = new OpenAI({
      apiKey,
      baseURL,
    });

    const openaiMessages = [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...cleanMessages,
    ];

    const response = await client.chat.completions.create({
      model,
      messages: openaiMessages,
      max_tokens: maxTokens,
      temperature,
    });

    const choice = response.choices?.[0];
    const msg = choice?.message;
    if (String(process.env.EXPERTS_AI_DEBUG || '').trim() === '1') {
      const ct = msg?.content;
      const contentDesc =
        typeof ct === 'string'
          ? `string(len=${ct.length})`
          : Array.isArray(ct)
            ? `array(len=${ct.length})`
            : String(ct);
      console.log('[ollama]', {
        baseURL,
        model,
        finish_reason: choice?.finish_reason,
        content: contentDesc,
        hasReasoning: typeof msg?.reasoning === 'string' && msg.reasoning.length > 0,
        reasoningFallback,
      });
    }
    if (choice?.finish_reason === 'length') {
      console.warn(
        '[ollama] finish_reason=length (completion hit max_tokens). If narratives truncate, raise EXPERTS_CONSENSUS_BUYS_MAX_TOKENS (consensus) or EXPERTS_INSIGHTS_MAX_TOKENS (overlap).'
      );
    }

    const text =
      assistantTextFromChatMessage(msg, { reasoningFallback }) || 'No response.';
    return pack(text, choice?.finish_reason ?? null);
  }

  if (normalizedProvider === 'openrouter') {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set.');

    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: openRouterDefaultHeaders(),
    });

    const openaiMessages = [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...cleanMessages,
    ];

    const response = await client.chat.completions.create({
      model,
      messages: openaiMessages,
      max_tokens: maxTokens,
      temperature,
    });

    const choice = response.choices?.[0];
    const msg = choice?.message;
    if (String(process.env.EXPERTS_AI_DEBUG || '').trim() === '1') {
      const ct = msg?.content;
      const contentDesc =
        typeof ct === 'string'
          ? `string(len=${ct.length})`
          : Array.isArray(ct)
            ? `array(len=${ct.length})`
            : String(ct);
      console.log('[openrouter]', {
        model,
        finish_reason: choice?.finish_reason,
        content: contentDesc,
        hasReasoning: typeof msg?.reasoning === 'string' && msg.reasoning.length > 0,
        reasoningFallback,
      });
    }
    if (choice?.finish_reason === 'length') {
      console.warn(
        '[openrouter] finish_reason=length (completion hit max_tokens). If narratives truncate, raise EXPERTS_CONSENSUS_BUYS_MAX_TOKENS or EXPERTS_INSIGHTS_MAX_TOKENS.'
      );
    }

    const text =
      assistantTextFromChatMessage(msg, { reasoningFallback }) || 'No response.';
    const finishReason = choice?.finish_reason ?? null;
    if (returnOpenRouterUsage) {
      return {
        text,
        finishReason,
        openRouterUsage: extractOpenRouterUsageFromResponse(response),
      };
    }
    return pack(text, finishReason);
  }

  throw new Error(`Unsupported LLM provider: ${provider}`);
}
