export interface LocalDataCacheEntry<T = unknown> {
  payload: T
  fetchedAt: number
  ageMs: number
  isFresh: boolean
}

export interface ReadLocalDataCacheOptions {
  ttlMs?: number
  now?: number
  allowStale?: boolean
}

export interface WriteLocalDataCacheOptions {
  now?: number
}

export function readLocalDataCache<T = unknown>(
  cacheKey: string,
  opts?: ReadLocalDataCacheOptions,
): LocalDataCacheEntry<T> | null

export function writeLocalDataCache<T = unknown>(
  cacheKey: string,
  payload: T,
  opts?: WriteLocalDataCacheOptions,
): boolean

export function clearLocalDataCache(cacheKey: string): void
