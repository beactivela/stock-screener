export const OPUS_STALE_FALLBACK_MS = 12 * 60 * 60 * 1000;

function hasCachedOpusPayload(cachedOpus) {
  const signalsCount = Array.isArray(cachedOpus?.signals) ? cachedOpus.signals.length : 0;
  const allScoresCount = Array.isArray(cachedOpus?.allScores) ? cachedOpus.allScores.length : 0;
  return signalsCount > 0 || allScoresCount > 0;
}

/**
 * Decide whether cached Opus data should be used for current scan rows.
 *
 * During scan completion, scan-results can become visible before Opus recompute
 * finishes. In that window we keep serving the previous Opus cache briefly
 * to avoid Open Trade / P&L flicker to dashes.
 */
export function shouldUseCachedOpusForScan(
  scanData,
  cachedOpus,
  { staleFallbackMs = OPUS_STALE_FALLBACK_MS } = {},
) {
  if (!scanData?.scannedAt || !cachedOpus?.computedAt) return false;

  const scanAtMs = Date.parse(scanData.scannedAt);
  const computedAtMs = Date.parse(cachedOpus.computedAt);
  if (!Number.isFinite(scanAtMs) || !Number.isFinite(computedAtMs)) return false;

  if (computedAtMs >= scanAtMs) return true;
  if (!hasCachedOpusPayload(cachedOpus)) return false;
  return scanAtMs - computedAtMs <= staleFallbackMs;
}

/**
 * Explain which cache mode is active for Opus merge.
 * - current: cache computed at/after current scan timestamp
 * - stale_fallback: older cache used temporarily to avoid flicker
 * - none: cache not usable
 */
export function resolveOpusCacheState(
  scanData,
  cachedOpus,
  { staleFallbackMs = OPUS_STALE_FALLBACK_MS } = {},
) {
  if (!scanData?.scannedAt || !cachedOpus?.computedAt) return 'none';

  const scanAtMs = Date.parse(scanData.scannedAt);
  const computedAtMs = Date.parse(cachedOpus.computedAt);
  if (!Number.isFinite(scanAtMs) || !Number.isFinite(computedAtMs)) return 'none';

  if (computedAtMs >= scanAtMs) return 'current';
  if (!hasCachedOpusPayload(cachedOpus)) return 'none';
  if (scanAtMs - computedAtMs <= staleFallbackMs) return 'stale_fallback';
  return 'none';
}
