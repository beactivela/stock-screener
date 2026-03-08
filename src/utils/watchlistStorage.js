export const WATCHLIST_STORAGE_KEY = 'stock-screener:watchlist'

function normalizeTicker(ticker) {
  return String(ticker || '').trim().toUpperCase()
}

function safeNow() {
  return new Date().toISOString()
}

export function readWatchlist() {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(WATCHLIST_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return parsed
      .filter((item) => item && typeof item === 'object')
      .map((item) => {
        const ticker = normalizeTicker(item.ticker)
        if (!ticker) return null
        return {
          ticker,
          note: typeof item.note === 'string' ? item.note : '',
          createdAt: typeof item.createdAt === 'string' ? item.createdAt : safeNow(),
          updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : safeNow(),
          noteUpdatedAt: typeof item.noteUpdatedAt === 'string' ? item.noteUpdatedAt : null,
        }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

function writeWatchlist(next) {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(next))
}

export function upsertWatchlistItem(ticker, options = {}) {
  const normalizedTicker = normalizeTicker(ticker)
  if (!normalizedTicker) throw new Error('Ticker is required')

  const now = safeNow()
  const note = typeof options.note === 'string' ? options.note : ''
  const setNoteTimestamp = options.setNoteTimestamp === true
  const existing = readWatchlist()
  const index = existing.findIndex((entry) => entry.ticker === normalizedTicker)

  if (index === -1) {
    const created = {
      ticker: normalizedTicker,
      note,
      createdAt: now,
      updatedAt: now,
      noteUpdatedAt: setNoteTimestamp ? now : null,
    }
    writeWatchlist([...existing, created])
    return created
  }

  const updated = {
    ...existing[index],
    note,
    updatedAt: now,
    noteUpdatedAt: setNoteTimestamp ? now : (existing[index].noteUpdatedAt ?? null),
  }
  const next = [...existing]
  next[index] = updated
  writeWatchlist(next)
  return updated
}

export function removeWatchlistItem(ticker) {
  const normalizedTicker = normalizeTicker(ticker)
  if (!normalizedTicker) return
  const existing = readWatchlist()
  writeWatchlist(existing.filter((entry) => entry.ticker !== normalizedTicker))
}

export function getWatchlistItem(ticker) {
  const normalizedTicker = normalizeTicker(ticker)
  if (!normalizedTicker) return null
  return readWatchlist().find((entry) => entry.ticker === normalizedTicker) || null
}

export function isTickerInWatchlist(ticker) {
  return Boolean(getWatchlistItem(ticker))
}

export function getWatchlistTickersSet() {
  return new Set(readWatchlist().map((entry) => entry.ticker))
}
