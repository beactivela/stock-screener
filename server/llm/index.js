/**
 * LLM adapter: minimal wrapper for Anthropic, OpenAI, and OpenRouter (OpenAI-compatible) chat.
 * Keeps provider/model selection centralized for multi-agent orchestration.
 */

/** Default model for POST /api/experts/ai-insights when using OpenRouter. */
export const DEFAULT_EXPERTS_OPENROUTER_MODEL = 'moonshotai/kimi-k2.5';

export function normalizeProvider(provider) {
  const p = String(provider || '').trim().toLowerCase();
  if (!p || p === 'anthropic') return 'anthropic';
  if (p === 'openai') return 'openai';
  if (p === 'openrouter') return 'openrouter';
  throw new Error(`Unsupported LLM provider: ${provider}`);
}

/**
 * Provider + model for expert overlap AI snapshot.
 * Precedence: EXPERTS_INSIGHTS_PROVIDER (if set) → else OpenRouter when OPENROUTER_API_KEY exists → else AGENT_DIALOGUE / Anthropic / OpenAI.
 */
export function resolveExpertsInsightsConfig() {
  const explicit = String(process.env.EXPERTS_INSIGHTS_PROVIDER || '').trim().toLowerCase();

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

export async function generateLlmReply({
  provider,
  model,
  system = '',
  messages = [],
  maxTokens = 800,
  temperature = 0.2,
}) {
  const normalizedProvider = normalizeProvider(provider);
  const cleanMessages = normalizeMessages(messages);

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
    return text;
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

    const text = response.choices?.[0]?.message?.content?.trim() || 'No response.';
    return text;
  }

  if (normalizedProvider === 'openrouter') {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set.');

    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({
      apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        ...(process.env.OPENROUTER_HTTP_REFERER
          ? { 'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER }
          : {}),
        ...(process.env.OPENROUTER_APP_TITLE ? { 'X-Title': process.env.OPENROUTER_APP_TITLE } : {}),
      },
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

    const text = response.choices?.[0]?.message?.content?.trim() || 'No response.';
    return text;
  }

  throw new Error(`Unsupported LLM provider: ${provider}`);
}
