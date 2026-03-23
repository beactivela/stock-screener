export function createMemoryCache() {
  return {
    value: null,
    at: 0,
    promise: null,
  };
}

export function isCacheFresh(entry, ttlMs) {
  return entry.value != null && Date.now() - entry.at <= ttlMs;
}

export async function readThroughMemoryCache(entry, ttlMs, loader) {
  if (isCacheFresh(entry, ttlMs)) return entry.value;
  if (entry.promise) return entry.promise;

  entry.promise = (async () => {
    const value = await loader();
    entry.value = value;
    entry.at = Date.now();
    return value;
  })().finally(() => {
    entry.promise = null;
  });

  return entry.promise;
}
