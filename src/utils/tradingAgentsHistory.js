/**
 * Persist TradingAgents runs in the browser (localStorage) for a ticker summary table
 * and reopening full analysis without re-running the graph.
 */

export const TRADING_AGENTS_HISTORY_KEY = 'stock-screener:tradingagents:history'

/** Cap stored runs so localStorage stays bounded (oldest dropped). */
export const TRADING_AGENTS_HISTORY_LIMIT = 200

/**
 * @param {unknown} t
 * @returns {string}
 */
export function normalizeTicker(t) {
  return String(t ?? '')
    .trim()
    .toUpperCase()
}

/**
 * @returns {string}
 */
function newEntryId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    /* ignore */
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

/**
 * @param {{
 *   ticker: string
 *   asOf?: string
 *   provider?: string
 *   profile?: string
 *   decision: unknown
 *   id?: string
 *   savedAt?: string
 * }} p
 * @returns {{
 *   id: string
 *   ticker: string
 *   asOf: string
 *   provider: string
 *   profile: string
 *   decision: unknown
 *   savedAt: string
 * }}
 */
export function createHistoryEntry(p) {
  const sym = normalizeTicker(p.ticker)
  return {
    id: p.id != null ? String(p.id) : newEntryId(),
    ticker: sym,
    asOf: p.asOf != null ? String(p.asOf) : '',
    provider: p.provider != null ? String(p.provider) : '',
    profile: p.profile != null ? String(p.profile) : '',
    decision: p.decision,
    savedAt: p.savedAt != null ? String(p.savedAt) : new Date().toISOString(),
  }
}

/**
 * Newest-first list; trims to TRADING_AGENTS_HISTORY_LIMIT.
 * @param {unknown[]} entries
 * @param {ReturnType<typeof createHistoryEntry>} entry
 * @returns {unknown[]}
 */
export function appendHistoryEntry(entries, entry) {
  const prev = Array.isArray(entries) ? entries : []
  return [entry, ...prev].slice(0, TRADING_AGENTS_HISTORY_LIMIT)
}

/**
 * One row per ticker: most recently saved run wins.
 * @param {unknown[]} entries
 * @returns {unknown[]}
 */
export function latestRowPerTicker(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return []
  const sorted = [...entries].sort((a, b) => {
    const ta = a && typeof a === 'object' && 'savedAt' in a ? String(/** @type {{savedAt?:string}} */ (a).savedAt) : ''
    const tb = b && typeof b === 'object' && 'savedAt' in b ? String(/** @type {{savedAt?:string}} */ (b).savedAt) : ''
    return tb.localeCompare(ta)
  })
  /** @type {Set<string>} */
  const seen = new Set()
  /** @type {unknown[]} */
  const out = []
  for (const row of sorted) {
    if (!row || typeof row !== 'object') continue
    const t = normalizeTicker(/** @type {{ticker?:string}} */ (row).ticker)
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(row)
  }
  return out
}

/**
 * @param {string | null | undefined} raw
 * @returns {unknown[]}
 */
export function parseStoredHistory(raw) {
  if (!raw || typeof raw !== 'string') return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

/**
 * @param {unknown[]} entries
 * @returns {string}
 */
export function serializeStoredHistory(entries) {
  return JSON.stringify(Array.isArray(entries) ? entries : [])
}

/**
 * @returns {unknown[]}
 */
export function loadHistoryFromStorage() {
  if (typeof localStorage === 'undefined') return []
  try {
    return parseStoredHistory(localStorage.getItem(TRADING_AGENTS_HISTORY_KEY))
  } catch {
    return []
  }
}

/**
 * @param {unknown[]} entries
 */
export function saveHistoryToStorage(entries) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(TRADING_AGENTS_HISTORY_KEY, serializeStoredHistory(entries))
  } catch {
    /* quota or private mode */
  }
}
