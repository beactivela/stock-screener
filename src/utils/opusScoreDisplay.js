function hasTradeMetadata(opus = {}) {
  return (
    opus.entryDate != null ||
    opus.daysSinceBuy != null ||
    opus.pctChange != null ||
    opus.entryPrice != null ||
    opus.stopLossPrice != null ||
    opus.riskRewardRatio != null
  )
}

export function getOpusDisplayState(opus) {
  const confidence = Number(opus?.opus45Confidence ?? 0)
  const grade = String(opus?.opus45Grade ?? 'F')
  const activeByMetadata = hasTradeMetadata(opus)

  // API fallback for non-active names is usually 0/F without trade fields.
  // Treat that as "no active setup" to avoid implying a failed grade.
  const isFallbackNoSetup = confidence <= 0 && grade === 'F' && !activeByMetadata
  if (isFallbackNoSetup) {
    return {
      hasActiveSetup: false,
      label: '–',
      confidence,
      grade,
    }
  }

  return {
    hasActiveSetup: true,
    label: `${confidence}% ${grade}`,
    confidence,
    grade,
  }
}

