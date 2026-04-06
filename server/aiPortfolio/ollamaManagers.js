import { generateLlmReply } from '../llm/index.js'
import { AI_PORTFOLIO_MANAGER_IDS, AI_PORTFOLIO_MANAGER_LABELS } from './types.js'

const DEFAULT_MODELS = {
  claude: 'anthropic/claude-3.7-sonnet',
  gpt: 'openai/gpt-4.1',
  gemini: 'google/gemini-2.5-pro',
  deepseek: 'deepseek/deepseek-r1',
}

const MODEL_ENV = {
  claude: 'AI_PORTFOLIO_MODEL_CLAUDE',
  gpt: 'AI_PORTFOLIO_MODEL_GPT',
  gemini: 'AI_PORTFOLIO_MODEL_GEMINI',
  deepseek: 'AI_PORTFOLIO_MODEL_DEEPSEEK',
}

function parseJsonObject(rawText) {
  const raw = String(rawText || '').trim()
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0])
    } catch {
      return null
    }
  }
}

export function getManagerModelMap() {
  /** @type {Record<string, string>} */
  const map = {}
  for (const managerId of AI_PORTFOLIO_MANAGER_IDS) {
    map[managerId] = String(process.env[MODEL_ENV[managerId]] || DEFAULT_MODELS[managerId]).trim()
  }
  return map
}

function sanitizeSuggestion(obj) {
  if (!obj || typeof obj !== 'object') return { action: 'no_trade', reason: 'invalid_payload' }
  const action = String(obj.action || '').toLowerCase()
  if (action !== 'enter') return { action: 'no_trade', reason: String(obj.reason || 'model_no_trade') }
  const ticker = String(obj.ticker || '').trim().toUpperCase()
  if (!ticker) return { action: 'no_trade', reason: 'missing_ticker' }
  return {
    action: 'enter',
    instrumentType: String(obj.instrumentType || 'stock').toLowerCase(),
    strategy: String(obj.strategy || 'stock').toLowerCase(),
    ticker,
    stopLossPct: Number(obj.stopLossPct) || 0.08,
    quantity: Number(obj.quantity) > 0 ? Number(obj.quantity) : undefined,
  }
}

export async function suggestManagerBestEntry({
  managerId,
  asOfDate,
  managerState,
  provider = 'ollama',
  modelMap = getManagerModelMap(),
}) {
  const model = modelMap[managerId]
  if (!model) return { action: 'no_trade', reason: `missing_model_${managerId}` }

  const prompt = [
    'You manage a live paper trading portfolio.',
    'Rules:',
    '- US stocks/options only',
    '- Long exposure only',
    '- Max 10% concentration',
    '- Max 2% risk per trade',
    '- Keep at least 20% cash and max 80% deployed',
    'Return STRICT JSON only, no markdown:',
    '{"action":"enter|no_trade","instrumentType":"stock|option","strategy":"stock|long_call|leap_call|cash_secured_put|bull_put_spread","ticker":"AAPL","stopLossPct":0.08,"quantity":null,"reason":"..."}',
    `Manager: ${AI_PORTFOLIO_MANAGER_LABELS[managerId] || managerId}`,
    `Date: ${asOfDate}`,
    `Portfolio snapshot: ${JSON.stringify({
      equityUsd: managerState?.equityUsd,
      cashUsd: managerState?.cashUsd,
      availableCashUsd: managerState?.availableCashUsd,
      deployedUsd: managerState?.deployedUsd,
      openPositions: Array.isArray(managerState?.positions) ? managerState.positions.length : 0,
    })}`,
  ].join('\n')

  try {
    const raw = await generateLlmReply({
      provider,
      model,
      system:
        'You are a disciplined portfolio manager. Prefer no_trade if uncertain. Output JSON only.',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 260,
      temperature: 0.2,
      reasoningFallback: false,
    })
    const parsed = parseJsonObject(typeof raw === 'string' ? raw : raw?.text)
    return sanitizeSuggestion(parsed)
  } catch {
    return { action: 'no_trade', reason: 'model_error' }
  }
}

