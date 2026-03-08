export interface WatchlistItem {
  ticker: string
  note: string
  createdAt: string
  updatedAt: string
  noteUpdatedAt: string | null
}

export const WATCHLIST_STORAGE_KEY: string

export function readWatchlist(): WatchlistItem[]

export function upsertWatchlistItem(
  ticker: string,
  options?: { note?: string; setNoteTimestamp?: boolean },
): WatchlistItem

export function removeWatchlistItem(ticker: string): void

export function getWatchlistItem(ticker: string): WatchlistItem | null

export function isTickerInWatchlist(ticker: string): boolean

export function getWatchlistTickersSet(): Set<string>
