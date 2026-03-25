/**
 * Dashboard "market structure" strip: PROTECT / NEUTRAL / GROW from price vs MAs (and QQQ/SPY for leaders).
 */

import { ema, sma } from './chartIndicators.ts'

export type MarketStance = 'protect' | 'neutral' | 'grow'

export interface MinimalBar {
  t: number
  c: number
}

/** Intersect three daily series (e.g. ^GSPC, QQQ, SPY) on common session timestamps. */
export function alignThreeBarCloses(
  gspc: MinimalBar[],
  qqq: MinimalBar[],
  spy: MinimalBar[],
): { times: number[]; gspc: number[]; qqq: number[]; spy: number[] } {
  const mq = new Map(qqq.map((r) => [r.t, r.c]))
  const ms = new Map(spy.map((r) => [r.t, r.c]))
  const rows: { t: number; gspc: number; qqq: number; spy: number }[] = []
  for (const g of gspc) {
    const q = mq.get(g.t)
    const s = ms.get(g.t)
    if (q != null && s != null) rows.push({ t: g.t, gspc: g.c, qqq: q, spy: s })
  }
  rows.sort((a, b) => a.t - b.t)
  return {
    times: rows.map((r) => r.t),
    gspc: rows.map((r) => r.gspc),
    qqq: rows.map((r) => r.qqq),
    spy: rows.map((r) => r.spy),
  }
}

/** Intersect two daily series on exact bar timestamps (ms), sorted ascending. */
export function alignBarsByTimestamp(a: MinimalBar[], b: MinimalBar[]): { t: number; c1: number; c2: number }[] {
  const byT = new Map<number, number>()
  for (const row of b) byT.set(row.t, row.c)
  const out: { t: number; c1: number; c2: number }[] = []
  for (const row of a) {
    const c2 = byT.get(row.t)
    if (c2 != null) out.push({ t: row.t, c1: row.c, c2 })
  }
  return out.sort((x, y) => x.t - y.t)
}

function lastFinite(values: (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i]
    if (v != null && Number.isFinite(v)) return v
  }
  return null
}

function tailFinite(values: (number | null)[], len: number): number[] {
  const out: number[] = []
  for (let i = values.length - 1; i >= 0 && out.length < len; i--) {
    const v = values[i]
    if (v != null && Number.isFinite(v)) out.push(v)
  }
  return out.reverse()
}

/**
 * Price vs a moving average, with MA slope from the last values of that MA series.
 * - Below MA → protect
 * - Above MA and MA rising (vs ~5 sessions back) → grow
 * - Above MA but MA not rising → neutral
 */
export function classifyStanceFromPriceVsMa(close: number, ma: number | null, recentMaValues: number[]): MarketStance {
  if (ma == null || !Number.isFinite(close) || !Number.isFinite(ma)) return 'neutral'
  if (close < ma) return 'protect'
  const maNow = recentMaValues[recentMaValues.length - 1]
  const maLag = recentMaValues[Math.max(0, recentMaValues.length - 6)]
  if (maNow == null || maLag == null || !Number.isFinite(maNow) || !Number.isFinite(maLag)) return 'neutral'
  const rising = maNow > maLag * 1.0003
  if (rising) return 'grow'
  return 'neutral'
}

/** US short date like 3/6/26 for subtitles (UTC so it matches exchange daily bars). */
export function formatStructureShortDate(barTimeMs: number): string {
  const d = new Date(barTimeMs)
  const m = d.getUTCMonth() + 1
  const day = d.getUTCDate()
  const y = String(d.getUTCFullYear()).slice(-2)
  return `${m}/${day}/${y}`
}

/**
 * Secondary line matching dashboard reference: date + tier hint (protect rows read defensive).
 */
export function formatStructureSubtitle(barTimeMs: number, stance: MarketStance): string {
  const date = formatStructureShortDate(barTimeMs)
  if (stance === 'protect') return `${date} DOWN ≤ NEUTRAL`
  if (stance === 'neutral') return `${date} NEUTRAL ≤ UP`
  return `${date} UP — GROW`
}

export interface StructureRowComputed {
  key: string
  title: string
  stance: MarketStance
  subtitle: string
  subtitleTone: 'danger' | 'muted' | 'positive'
  /** True if stance rank dropped vs ~1 week ago (optional UI hint). */
  weakeningVsWeek: boolean
}

function stanceRank(s: MarketStance): number {
  if (s === 'protect') return 0
  if (s === 'neutral') return 1
  return 2
}

function subtitleToneForStance(stance: MarketStance): 'danger' | 'muted' | 'positive' {
  if (stance === 'protect') return 'danger'
  if (stance === 'neutral') return 'muted'
  return 'positive'
}

/**
 * Build the four dashboard rows from aligned SPY/QQQ/GSPC closes (each series same length, sorted by t).
 */
export function computeMarketStructureRows(series: {
  times: number[]
  gspc: number[]
  qqq: number[]
  spy: number[]
}): StructureRowComputed[] {
  const { times, gspc, qqq, spy } = series
  if (times.length < 210) {
    return [
      {
        key: 'leaders',
        title: 'MARKET LEADERS',
        stance: 'neutral',
        subtitle: 'Need more history',
        subtitleTone: 'muted',
        weakeningVsWeek: false,
      },
      {
        key: 'st21',
        title: 'SHORT TERM (21ema)',
        stance: 'neutral',
        subtitle: 'Need more history',
        subtitleTone: 'muted',
        weakeningVsWeek: false,
      },
      {
        key: 'mt50',
        title: 'MEDIUM TERM (50sma)',
        stance: 'neutral',
        subtitle: 'Need more history',
        subtitleTone: 'muted',
        weakeningVsWeek: false,
      },
      {
        key: 'lt200',
        title: 'LONG TERM (200sma)',
        stance: 'neutral',
        subtitle: 'Need more history',
        subtitleTone: 'muted',
        weakeningVsWeek: false,
      },
    ]
  }

  const ratios = gspc.map((_, i) => qqq[i]! / spy[i]!)
  const ema21Ratio = ema(ratios, 21)
  const ema21Gspc = ema(gspc, 21)
  const sma50 = sma(gspc, 50)
  const sma200 = sma(gspc, 200)

  const lastIdx = gspc.length - 1
  const lastT = times[lastIdx]!
  const closeG = gspc[lastIdx]!
  const closeR = ratios[lastIdx]!
  const maLeaders = lastFinite(ema21Ratio)
  const ma21 = lastFinite(ema21Gspc)
  const ma50 = lastFinite(sma50)
  const ma200 = lastFinite(sma200)

  const leadersMaTail = tailFinite(ema21Ratio, 8)
  const ema21Tail = tailFinite(ema21Gspc, 8)
  const sma50Tail = tailFinite(sma50, 8)
  const sma200Tail = tailFinite(sma200, 8)

  const stanceLeaders = classifyStanceFromPriceVsMa(closeR, maLeaders, leadersMaTail)
  const stance21 = classifyStanceFromPriceVsMa(closeG, ma21, ema21Tail)
  const stance50 = classifyStanceFromPriceVsMa(closeG, ma50, sma50Tail)
  const stance200 = classifyStanceFromPriceVsMa(closeG, ma200, sma200Tail)

  const weekAgo = Math.max(0, lastIdx - 5)
  const stanceAt = (maSeries: (number | null)[], priceSeries: number[]): MarketStance => {
    const i = weekAgo
    const ma = maSeries[i]
    const c = priceSeries[i]
    const tail = tailFinite(maSeries.slice(0, i + 1), 8)
    if (c == null || ma == null) return 'neutral'
    return classifyStanceFromPriceVsMa(c, ma, tail)
  }

  const prevLeaders = stanceAt(ema21Ratio, ratios)
  const prev21 = stanceAt(ema21Gspc, gspc)
  const prev50 = stanceAt(sma50, gspc)
  const prev200 = stanceAt(sma200, gspc)

  const row = (
    key: string,
    title: string,
    stance: MarketStance,
    prev: MarketStance,
    barTime: number,
  ): StructureRowComputed => ({
    key,
    title,
    stance,
    subtitle: formatStructureSubtitle(barTime, stance),
    subtitleTone: subtitleToneForStance(stance),
    weakeningVsWeek: stanceRank(stance) < stanceRank(prev),
  })

  return [
    row('leaders', 'MARKET LEADERS', stanceLeaders, prevLeaders, lastT),
    row('st21', 'SHORT TERM (21ema)', stance21, prev21, lastT),
    row('mt50', 'MEDIUM TERM (50sma)', stance50, prev50, lastT),
    row('lt200', 'LONG TERM (200sma)', stance200, prev200, lastT),
  ]
}
