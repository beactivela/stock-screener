/**
 * Decide whether to persist scan results at a checkpoint.
 * Strategy defaults to stream_batches to keep long scans responsive.
 */
export function getScanPersistenceStrategy(rawStrategy = process.env.SCAN_PERSISTENCE_STRATEGY) {
  const normalized = String(rawStrategy || 'stream_batches').trim().toLowerCase()
  return normalized === 'final_only' ? 'final_only' : 'stream_batches'
}

export function shouldPersistCheckpoint({ index, total, strategy = 'final_only', batchSize = 20 }) {
  const safeIndex = Number(index) || 0;
  const safeTotal = Number(total) || 0;
  const safeBatchSize = Math.max(1, Number(batchSize) || 20);
  const normalized = getScanPersistenceStrategy(strategy);
  if (normalized === 'stream_batches') {
    return safeIndex > 0 && safeTotal > 0 && safeIndex <= safeTotal && (safeIndex === safeTotal || safeIndex % safeBatchSize === 0);
  }
  if (normalized === 'final_only') return safeTotal > 0 && safeIndex === safeTotal;
  return false;
}
