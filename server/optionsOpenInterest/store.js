import { getSupabase, isSupabaseConfigured } from '../supabase.js'

const TABLE = 'options_open_interest_cache'

function normalizeTicker(ticker) {
  return String(ticker || '').trim().toUpperCase()
}

function normalizeCacheKey(cacheKey) {
  return String(cacheKey || 'default').trim() || 'default'
}

function isFresh(fetchedAt, ttlMs, nowMs = Date.now()) {
  if (!ttlMs || ttlMs <= 0) return false
  const fetchedTime = new Date(fetchedAt).getTime()
  return Number.isFinite(fetchedTime) && nowMs - fetchedTime <= ttlMs
}

export function createOptionsOpenInterestStore(opts = {}) {
  const supabase = opts.supabaseClient || (isSupabaseConfigured() ? getSupabase() : null)

  async function getCachedPayload(ticker, cacheKey = 'default', ttlMs = 0) {
    if (!supabase) return null
    const symbol = normalizeTicker(ticker)
    const key = normalizeCacheKey(cacheKey)
    if (!symbol) return null

    const { data, error } = await supabase
      .from(TABLE)
      .select('payload_json, fetched_at')
      .eq('ticker', symbol)
      .eq('cache_key', key)
      .maybeSingle()

    if (error || !data || !isFresh(data.fetched_at, ttlMs)) return null
    return data.payload_json || null
  }

  async function savePayload(payload, cacheKey = 'default') {
    if (!supabase || !payload?.ticker) return false
    const symbol = normalizeTicker(payload.ticker)
    const key = normalizeCacheKey(cacheKey)
    const now = new Date().toISOString()
    const row = {
      ticker: symbol,
      cache_key: key,
      expiration_date: key === 'default' ? payload.selectedExpiration || null : key,
      payload_json: payload,
      fetched_at: now,
      updated_at: now,
    }

    const { error } = await supabase.from(TABLE).upsert(row, { onConflict: 'ticker,cache_key' })
    return !error
  }

  return {
    getCachedPayload,
    savePayload,
  }
}
