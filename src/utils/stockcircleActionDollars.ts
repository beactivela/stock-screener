/**
 * Approximate dollar size of a buy/add or sell/reduction from current position value
 * and StockCircle action line (% change in shares). Not audited — for UI hints only.
 */

export function estimatePositionDollarDeltas(
  actionType: string,
  actionPct: number | null | undefined,
  positionValueUsd: number | null | undefined
): { increaseUsd: number | null; decreaseUsd: number | null } {
  const V = positionValueUsd
  if (V == null || !Number.isFinite(V) || V <= 0) return { increaseUsd: null, decreaseUsd: null }
  const p = actionPct

  switch (actionType) {
    case 'new_holding':
      return { increaseUsd: V, decreaseUsd: null }
    case 'increased':
      if (p == null || !Number.isFinite(p) || p <= 0) return { increaseUsd: null, decreaseUsd: null }
      return { increaseUsd: (V * p) / (100 + p), decreaseUsd: null }
    case 'decreased':
    case 'sold': {
      if (p == null || !Number.isFinite(p) || p <= 0) return { increaseUsd: null, decreaseUsd: null }
      if (p >= 100) return { increaseUsd: null, decreaseUsd: V }
      return { increaseUsd: null, decreaseUsd: (V * p) / (100 - p) }
    }
    default:
      return { increaseUsd: null, decreaseUsd: null }
  }
}
