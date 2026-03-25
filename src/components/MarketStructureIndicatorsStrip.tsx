import { useEffect, useMemo, useState } from 'react'
import { API_BASE } from '../utils/api'
import {
  alignThreeBarCloses,
  computeMarketStructureRows,
  type MarketStance,
} from '../utils/marketStructureIndicators.ts'

interface Bar {
  t: number
  o: number
  h: number
  l: number
  c: number
}

async function fetchIndexBars(ticker: string): Promise<Bar[]> {
  const r = await fetch(
    `${API_BASE}/api/bars/${encodeURIComponent(ticker)}?days=400&interval=1d`,
    { cache: 'no-store' },
  )
  const text = await r.text()
  let payload: { error?: string; results?: Bar[] } | null = null
  if (text.trim()) {
    try {
      payload = JSON.parse(text)
    } catch {
      if (!r.ok) throw new Error(text.trim() || `HTTP ${r.status}`)
      throw new Error('Unexpected response format from API')
    }
  }
  if (!r.ok) {
    const message = payload?.error || text.trim() || `HTTP ${r.status}`
    throw new Error(message)
  }
  if (payload?.error) throw new Error(payload.error)
  const raw = (payload?.results || []) as Bar[]
  return [...raw].sort((a, b) => a.t - b.t)
}

function StanceIcon({
  stance,
  active,
  compact,
}: {
  stance: 'protect' | 'neutral' | 'grow'
  active: boolean
  compact?: boolean
}) {
  const box = compact ? 'w-6 h-6 rounded border' : 'w-9 h-9 rounded-md border-2'
  const base = `${box} flex items-center justify-center transition-opacity`
  const inactive = `${base} border-slate-600 text-slate-600 opacity-35`
  const activeProtect = `${base} border-red-500 bg-red-500/25 text-red-400 opacity-100`
  const activeNeutral = `${base} border-amber-400 bg-amber-500/20 text-amber-300 opacity-100`
  const activeGrow = `${base} border-emerald-500 bg-emerald-500/20 text-emerald-400 opacity-100`
  const cls =
    stance === 'protect'
      ? active
        ? activeProtect
        : inactive
      : stance === 'neutral'
        ? active
          ? activeNeutral
          : inactive
        : active
          ? activeGrow
          : inactive

  const sw = compact ? 1.6 : 2.2
  const dim = compact ? 14 : 22

  return (
    <div className={cls} aria-hidden>
      {stance === 'protect' && (
        <svg width={dim} height={dim} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round">
          <path d="M12 5v14M7 14l5 5 5-5" />
        </svg>
      )}
      {stance === 'neutral' && (
        <svg width={dim} height={dim} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round">
          <path d="M4 12h16M18 9l3 3-3 3M6 9L3 12l3 3" />
        </svg>
      )}
      {stance === 'grow' && (
        <svg width={dim} height={dim} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round">
          <path d="M12 19V5M17 10l-5-5-5 5" />
        </svg>
      )}
    </div>
  )
}

function stanceColumn(stance: MarketStance): 0 | 1 | 2 {
  if (stance === 'protect') return 0
  if (stance === 'neutral') return 1
  return 2
}

function subtitleClass(tone: 'danger' | 'muted' | 'positive'): string {
  if (tone === 'danger') return 'text-red-400'
  if (tone === 'positive') return 'text-emerald-400'
  return 'text-slate-300'
}

/**
 * Compact 4-column strip: QQQ/SPY vs 21 EMA (leaders), SPX vs 21 EMA / 50 / 200 SMA.
 */
export default function MarketStructureIndicatorsStrip() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aligned, setAligned] = useState<ReturnType<typeof alignThreeBarCloses> | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const [gspcRaw, qqqRaw, spyRaw] = await Promise.all([
          fetchIndexBars('^GSPC'),
          fetchIndexBars('QQQ'),
          fetchIndexBars('SPY'),
        ])
        if (cancelled) return
        const merged = alignThreeBarCloses(
          gspcRaw.map((b) => ({ t: b.t, c: b.c })),
          qqqRaw.map((b) => ({ t: b.t, c: b.c })),
          spyRaw.map((b) => ({ t: b.t, c: b.c })),
        )
        setAligned(merged)
      } catch (e: unknown) {
        if (!cancelled) {
          setAligned(null)
          setError(e instanceof Error ? e.message : 'Failed to load')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const rows = useMemo(() => {
    if (!aligned || aligned.times.length === 0) return []
    return computeMarketStructureRows(aligned)
  }, [aligned])

  return (
    <section
      className="rounded-xl border border-slate-700 bg-slate-900/40 overflow-hidden"
      aria-label="Market structure: protect, neutral, grow"
    >
      {loading ? (
        <div className="px-3 py-3 text-center text-slate-500 text-xs">Loading market structure…</div>
      ) : error ? (
        <div className="px-3 py-3 text-center text-red-400 text-xs">{error}</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-2">
          {rows.map((row) => {
            const col = stanceColumn(row.stance)
            return (
              <div
                key={row.key}
                className="relative rounded-lg border border-slate-800/90 bg-slate-950/40 px-2 py-1.5 flex flex-col min-w-0"
              >
                {row.weakeningVsWeek && (
                  <div
                    className="absolute top-1 right-1 text-red-500 pointer-events-none"
                    title="Stance weakened vs ~1 week ago"
                    aria-hidden
                  >
                    <svg width="11" height="9" viewBox="0 0 12 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                      <path d="M8 1 L3 5 L8 9" />
                    </svg>
                  </div>
                )}
                <div className="text-[10px] font-semibold text-slate-200 uppercase tracking-wide leading-tight pr-4">
                  {row.title}
                </div>
                <div
                  className={`text-[9px] leading-tight mt-1 line-clamp-2 ${subtitleClass(row.subtitleTone)}`}
                  title={row.subtitle}
                >
                  {row.subtitle}
                </div>
                <div className="mt-1.5 pt-1.5 border-t border-slate-800/80">
                  <div className="flex justify-between gap-0.5 text-[7px] font-semibold uppercase tracking-wide mb-1 px-0.5">
                    <span className="text-red-400/90 truncate text-center flex-1">Protect</span>
                    <span className="text-amber-300/90 truncate text-center flex-1">Neutral</span>
                    <span className="text-emerald-400/90 truncate text-center flex-1">Grow</span>
                  </div>
                  <div className="flex gap-1 justify-between" role="group" aria-label={`${row.title}: ${row.stance}`}>
                    <StanceIcon stance="protect" active={col === 0} compact />
                    <StanceIcon stance="neutral" active={col === 1} compact />
                    <StanceIcon stance="grow" active={col === 2} compact />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
