/**
 * LLM adapter: minimal wrapper for Anthropic + OpenAI chat.
 * Keeps provider/model selection centralized for multi-agent orchestration.
 */

export function normalizeProvider(provider) {
  const p = String(provider || '').trim().toLowerCase();
  if (!p || p === 'anthropic') return 'anthropic';
  if (p === 'openai') return 'openai';
  throw new Error(`Unsupported LLM provider: ${provider}`);
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

  throw new Error(`Unsupported LLM provider: ${provider}`);
}
