export const TRADING_AGENTS_HISTORY_KEY: string
export const TRADING_AGENTS_HISTORY_LIMIT: number

export type TradingAgentsHistoryEntry = {
  id: string
  ticker: string
  asOf: string
  provider: string
  profile: string
  decision: unknown
  savedAt: string
}

export function normalizeTicker(t: unknown): string

export function createHistoryEntry(p: {
  ticker: string
  asOf?: string
  provider?: string
  profile?: string
  decision: unknown
  id?: string
  savedAt?: string
}): TradingAgentsHistoryEntry

export function appendHistoryEntry(
  entries: unknown[],
  entry: TradingAgentsHistoryEntry,
): TradingAgentsHistoryEntry[]

export function latestRowPerTicker(entries: unknown[]): TradingAgentsHistoryEntry[]

export function parseStoredHistory(raw: string | null | undefined): unknown[]

export function serializeStoredHistory(entries: unknown[]): string

export function loadHistoryFromStorage(): TradingAgentsHistoryEntry[]

export function saveHistoryToStorage(entries: unknown[]): void
