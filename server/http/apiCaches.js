import { createMemoryCache } from './memoryCache.js';

export const FUNDAMENTALS_RESPONSE_CACHE_TTL_MS = 60 * 1000;
export const SCAN_DATA_CACHE_TTL_MS = 15 * 1000;
export const SCAN_RESULTS_RESPONSE_CACHE_TTL_MS = 15 * 1000;
export const OPUS_PRICE_REFRESH_TTL_MS = 60 * 60 * 1000;

export const fundamentalsMemoryCache = createMemoryCache();
export const latestScanDataMemoryCache = createMemoryCache();
export const latestScanResponseCache = new Map();

export function invalidateScanResponseCaches() {
  latestScanDataMemoryCache.value = null;
  latestScanDataMemoryCache.at = 0;
  latestScanDataMemoryCache.promise = null;
  latestScanResponseCache.clear();
}

export function invalidateFundamentalsCache() {
  fundamentalsMemoryCache.value = null;
  fundamentalsMemoryCache.at = 0;
  fundamentalsMemoryCache.promise = null;
}

export function shouldRefreshCachedOpusPrices(cachedOpus) {
  const signals = cachedOpus?.signals || [];
  if (!signals.some((signal) => signal.entryPrice != null && signal.currentPrice == null && signal.ticker)) {
    return false;
  }
  if (!cachedOpus?.computedAt) return true;
  return Date.now() - new Date(cachedOpus.computedAt).getTime() > OPUS_PRICE_REFRESH_TTL_MS;
}
