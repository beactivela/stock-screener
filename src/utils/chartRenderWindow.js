export function getInitialChartCount(totalCount, batchSize = 12) {
  const safeTotal = Math.max(0, Number(totalCount) || 0)
  const safeBatch = Math.max(1, Number(batchSize) || 12)
  return Math.min(safeTotal, safeBatch)
}

export function getNextChartCount(currentCount, totalCount, batchSize = 12) {
  const safeCurrent = Math.max(0, Number(currentCount) || 0)
  const safeTotal = Math.max(0, Number(totalCount) || 0)
  const safeBatch = Math.max(1, Number(batchSize) || 12)
  return Math.min(safeTotal, safeCurrent + safeBatch)
}
