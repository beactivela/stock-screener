export function readLocalDataCache(cacheKey, opts = {}) {
  if (typeof localStorage === 'undefined') return null

  const now = Number.isFinite(opts.now) ? opts.now : Date.now()
  const ttlMs = Number.isFinite(opts.ttlMs) ? opts.ttlMs : Infinity
  const allowStale = opts.allowStale !== false

  try {
    const raw = localStorage.getItem(cacheKey)
    if (!raw) return null

    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null

    const fetchedAt = Number(parsed.fetchedAt)
    if (!Number.isFinite(fetchedAt)) return null

    const ageMs = Math.max(0, now - fetchedAt)
    const isFresh = ageMs <= ttlMs
    if (!isFresh && !allowStale) return null

    return {
      payload: parsed.payload,
      fetchedAt,
      ageMs,
      isFresh,
    }
  } catch {
    return null
  }
}

export function writeLocalDataCache(cacheKey, payload, opts = {}) {
  if (typeof localStorage === 'undefined') return false

  const now = Number.isFinite(opts.now) ? opts.now : Date.now()

  try {
    localStorage.setItem(
      cacheKey,
      JSON.stringify({
        payload,
        fetchedAt: now,
      }),
    )
    return true
  } catch {
    return false
  }
}

export function clearLocalDataCache(cacheKey) {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(cacheKey)
}
