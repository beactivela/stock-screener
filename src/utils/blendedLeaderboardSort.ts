/**
 * Sortable "All experts" blended table: guru rows (performance %) + WhaleWisdom filers.
 * Pure helpers — unit-tested without React.
 */

import type { ExpertLeaderboardRow } from './expertConsensus'

export type BlendedLeaderboardEntry =
  | { kind: 'guru'; row: ExpertLeaderboardRow }
  | { kind: 'whalewisdom'; slug: string; displayName: string; managerName: string }

/** `#` = pipeline order; performance columns use numeric null-as-missing semantics (nulls last). */
export type BlendedSortKey =
  | 'pipeline'
  | 'name'
  | 'source'
  | 'perf1y'
  | 'perf3y'
  | 'perf5y'
  | 'perf10y'
  | 'overlap'

/** First click on a column uses this direction (toggle on repeat clicks). */
export function defaultBlendedSortDir(key: BlendedSortKey): 'asc' | 'desc' {
  switch (key) {
    case 'pipeline':
    case 'name':
    case 'source':
      return 'asc'
    case 'perf1y':
    case 'perf3y':
    case 'perf5y':
    case 'perf10y':
    case 'overlap':
      return 'desc'
  }
}

function guruInConsensusPanel(
  row: ExpertLeaderboardRow,
  expertRowsOrdered: ExpertLeaderboardRow[],
  consensusTopK: number
): boolean {
  const r = expertRowsOrdered.findIndex((e) => e.investorSlug === row.investorSlug)
  return r >= 0 && r < consensusTopK
}

function displayName(entry: BlendedLeaderboardEntry): string {
  if (entry.kind === 'whalewisdom') {
    return entry.managerName || entry.displayName
  }
  return entry.row.firmName
}

function sourceLabel(entry: BlendedLeaderboardEntry): string {
  return entry.kind === 'guru' ? 'Guru portfolio' : '13F (WhaleWisdom)'
}

function perf(
  entry: BlendedLeaderboardEntry,
  horizon: '1y' | '3y' | '5y' | '10y'
): number | null {
  if (entry.kind !== 'guru') return null
  const r = entry.row
  switch (horizon) {
    case '1y':
      return r.performance1yPct
    case '3y':
      return r.performance3yPct
    case '5y':
      return r.performance5yPct
    case '10y':
      return r.performance10yPct
  }
}

/** Overlap column: in top-K panel > other guru > 13F-only rows (for consistent desc = “most relevant first”). */
function overlapRank(
  entry: BlendedLeaderboardEntry,
  expertRowsOrdered: ExpertLeaderboardRow[],
  consensusTopK: number
): number {
  if (entry.kind === 'whalewisdom') return 0
  return guruInConsensusPanel(entry.row, expertRowsOrdered, consensusTopK) ? 2 : 1
}

function cmpFiniteNum(a: number, b: number, dir: 'asc' | 'desc'): number {
  const diff = a - b
  return dir === 'asc' ? diff : -diff
}

/**
 * Numeric compare with null/invalid treated as missing — always sorted after finite values (both directions).
 */
function cmpPerf(
  a: number | null,
  b: number | null,
  dir: 'asc' | 'desc'
): number {
  const aOk = a != null && Number.isFinite(a)
  const bOk = b != null && Number.isFinite(b)
  if (!aOk && !bOk) return 0
  if (!aOk) return 1
  if (!bOk) return -1
  return cmpFiniteNum(a as number, b as number, dir)
}

function cmpStr(a: string, b: string, dir: 'asc' | 'desc'): number {
  const diff = a.localeCompare(b, undefined, { sensitivity: 'base' })
  return dir === 'asc' ? diff : -diff
}

/**
 * Returns a new array; does not mutate `entries`. Stable: ties keep pipeline order.
 */
export function sortBlendedLeaderboardEntries(
  entries: BlendedLeaderboardEntry[],
  expertRowsOrdered: ExpertLeaderboardRow[],
  consensusTopK: number,
  key: BlendedSortKey,
  dir: 'asc' | 'desc'
): BlendedLeaderboardEntry[] {
  const indexed = entries.map((entry, origIndex) => ({ entry, origIndex }))

  indexed.sort((A, B) => {
    const a = A.entry
    const b = B.entry
    let c = 0
    switch (key) {
      case 'pipeline':
        c = dir === 'asc' ? A.origIndex - B.origIndex : B.origIndex - A.origIndex
        break
      case 'name':
        c = cmpStr(displayName(a), displayName(b), dir)
        break
      case 'source':
        c = cmpStr(sourceLabel(a), sourceLabel(b), dir)
        break
      case 'perf1y':
        c = cmpPerf(perf(a, '1y'), perf(b, '1y'), dir)
        break
      case 'perf3y':
        c = cmpPerf(perf(a, '3y'), perf(b, '3y'), dir)
        break
      case 'perf5y':
        c = cmpPerf(perf(a, '5y'), perf(b, '5y'), dir)
        break
      case 'perf10y':
        c = cmpPerf(perf(a, '10y'), perf(b, '10y'), dir)
        break
      case 'overlap': {
        const va = overlapRank(a, expertRowsOrdered, consensusTopK)
        const vb = overlapRank(b, expertRowsOrdered, consensusTopK)
        c = cmpFiniteNum(va, vb, dir)
        break
      }
    }
    if (c !== 0) return c
    return A.origIndex - B.origIndex
  })

  return indexed.map(({ entry }) => entry)
}
