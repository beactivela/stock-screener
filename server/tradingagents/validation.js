/**
 * @typedef {{ ticker: string, asOf: string, provider: string, analysts: string[] }} TradingAgentsRunInput
 */

/** Canonical order for defaults and CLI. */
export const TRADING_AGENTS_ANALYST_IDS = ['market', 'social', 'news', 'fundamentals']

/** @type {Set<string>} */
const ANALYST_SET = new Set(TRADING_AGENTS_ANALYST_IDS)

export const TRADING_AGENTS_PROFILES = /** @type {const} */ (['full', 'fast'])

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
 * @param {unknown} raw
 * @returns {{ ok: true, value: string[] } | { ok: false, error: string }}
 */
export function normalizeTradingAgentsAnalysts(raw) {
  if (raw === undefined || raw === null) {
    return { ok: true, value: [...TRADING_AGENTS_ANALYST_IDS] }
  }
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'analysts must be an array of analyst ids' }
  }
  /** @type {string[]} */
  const out = []
  const seen = new Set()
  for (const item of raw) {
    if (typeof item !== 'string' || !item.trim()) {
      return { ok: false, error: 'each analyst must be a non-empty string' }
    }
    const id = item.trim().toLowerCase()
    if (!ANALYST_SET.has(id)) {
      return {
        ok: false,
        error: `unknown analyst "${id}"; use: ${TRADING_AGENTS_ANALYST_IDS.join(', ')}`,
      }
    }
    if (!seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  if (out.length === 0) {
    return { ok: false, error: 'analysts must include at least one analyst' }
  }
  return { ok: true, value: out }
}

/**
 * Expand `profile` when `analysts` is omitted. Explicit `analysts` wins over `profile`.
 * @param {unknown} body
 * @returns {{ ok: true, value: string[] } | { ok: false, error: string }}
 */
export function resolveAnalystsFromBody(body) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'invalid body' }
  }
  const rec = /** @type {Record<string, unknown>} */ (body)
  const rawAnalysts = rec.analysts
  const rawProfile = rec.profile

  if (rawAnalysts !== undefined && rawAnalysts !== null) {
    return normalizeTradingAgentsAnalysts(rawAnalysts)
  }

  if (rawProfile === undefined || rawProfile === null) {
    return { ok: true, value: [...TRADING_AGENTS_ANALYST_IDS] }
  }
  if (typeof rawProfile !== 'string' || !rawProfile.trim()) {
    return { ok: false, error: 'profile must be "full" or "fast"' }
  }
  const p = rawProfile.trim().toLowerCase()
  if (p === 'full') {
    return { ok: true, value: [...TRADING_AGENTS_ANALYST_IDS] }
  }
  if (p === 'fast') {
    return { ok: true, value: ['market', 'fundamentals'] }
  }
  return { ok: false, error: 'profile must be "full" or "fast"' }
}

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

  const analystsRes = resolveAnalystsFromBody(body)
  if (!analystsRes.ok) {
    return { ok: false, error: analystsRes.error }
  }

  return { ok: true, value: { ticker, asOf, provider, analysts: analystsRes.value } }
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
