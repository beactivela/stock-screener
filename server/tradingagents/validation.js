/** @typedef {{ ticker: string, asOf: string, provider: string }} TradingAgentsRunInput */

export const TRADING_AGENTS_PROVIDERS = [
  'openai',
  'anthropic',
  'google',
  'xai',
  'openrouter',
  'ollama',
]

const TICKER_RE = /^[A-Z0-9.-]{1,12}$/
const AS_OF_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * @param {unknown} body
 * @returns {{ ok: true, value: TradingAgentsRunInput } | { ok: false, error: string }}
 */
export function validateTradingAgentsRunRequest(body) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be a JSON object' }
  }

  const { ticker: rawTicker, asOf: rawAsOf, provider: rawProvider } = /** @type {Record<string, unknown>} */ (body)

  if (typeof rawTicker !== 'string' || !rawTicker.trim()) {
    return { ok: false, error: 'ticker is required (string)' }
  }
  const ticker = rawTicker.trim().toUpperCase()
  if (!TICKER_RE.test(ticker)) {
    return { ok: false, error: 'ticker must be 1–12 chars: letters, digits, . or -' }
  }

  if (typeof rawAsOf !== 'string' || !AS_OF_RE.test(rawAsOf.trim())) {
    return { ok: false, error: 'asOf must be YYYY-MM-DD' }
  }
  const asOf = rawAsOf.trim()
  const d = new Date(`${asOf}T12:00:00.000Z`)
  if (Number.isNaN(d.getTime())) {
    return { ok: false, error: 'asOf is not a valid calendar date' }
  }
  const y = d.getUTCFullYear()
  if (y < 1990 || y > 2100) {
    return { ok: false, error: 'asOf year must be between 1990 and 2100' }
  }
  const today = new Date()
  const max = new Date(today)
  max.setUTCDate(max.getUTCDate() + 1)
  if (d.getTime() > max.getTime()) {
    return { ok: false, error: 'asOf cannot be more than one day in the future' }
  }

  if (typeof rawProvider !== 'string' || !rawProvider.trim()) {
    return { ok: false, error: 'provider is required (string)' }
  }
  const provider = rawProvider.trim().toLowerCase()
  if (!TRADING_AGENTS_PROVIDERS.includes(provider)) {
    return {
      ok: false,
      error: `provider must be one of: ${TRADING_AGENTS_PROVIDERS.join(', ')}`,
    }
  }

  return { ok: true, value: { ticker, asOf, provider } }
}

/**
 * Env var name for API keys (ollama typically needs no key).
 * @param {string} provider
 * @returns {string | null}
 */
export function providerRequiredEnvVar(provider) {
  switch (provider) {
    case 'openai':
      return 'OPENAI_API_KEY'
    case 'anthropic':
      return 'ANTHROPIC_API_KEY'
    case 'google':
      return 'GOOGLE_API_KEY'
    case 'xai':
      return 'XAI_API_KEY'
    case 'openrouter':
      return 'OPENROUTER_API_KEY'
    case 'ollama':
      return null
    default:
      return null
  }
}
