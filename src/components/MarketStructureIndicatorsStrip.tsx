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
  const box = compact ? 'w-[1.8rem] h-[1.8rem] rounded border' : 'w-9 h-9 rounded-md border-2'
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

  const sw = compact ? 1.92 : 2.2
  const dim = compact ? 16.8 : 22

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
                className="rounded-lg border border-slate-800/90 bg-slate-950/40 px-2 py-1.5 flex flex-col min-w-0"
              >
                {/* Title + Protect/Neutral/Grow on one row so each chart cell reads left→right like a single headline. */}
                <div className="flex flex-row items-center justify-between gap-2 min-w-0">
                  <div className="min-w-0 flex-1 flex items-center gap-1">
                    <div className="text-xs font-semibold text-slate-200 uppercase tracking-wide leading-tight truncate">
                      {row.title}
                    </div>
                    {row.weakeningVsWeek && (
                      <span
                        className="shrink-0 text-red-500"
                        title="Stance weakened vs ~1 week ago"
                        aria-hidden
                      >
                        <svg width="11" height="9" viewBox="0 0 12 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                          <path d="M8 1 L3 5 L8 9" />
                        </svg>
                      </span>
                    )}
                  </div>
                  <div
                    className="flex shrink-0 items-end gap-1"
                    role="group"
                    aria-label={`${row.title}: ${row.stance}`}
                  >
                    <div className="flex flex-col items-center gap-0.5 min-w-0">
                      <span className="text-xs font-semibold uppercase tracking-wide text-red-400/90 leading-none text-center w-full truncate">
                        Protect
                      </span>
                      <StanceIcon stance="protect" active={col === 0} compact />
                    </div>
                    <div className="flex flex-col items-center gap-0.5 min-w-0">
                      <span className="text-xs font-semibold uppercase tracking-wide text-amber-300/90 leading-none text-center w-full truncate">
                        Neutral
                      </span>
                      <StanceIcon stance="neutral" active={col === 1} compact />
                    </div>
                    <div className="flex flex-col items-center gap-0.5 min-w-0">
                      <span className="text-xs font-semibold uppercase tracking-wide text-emerald-400/90 leading-none text-center w-full truncate">
                        Grow
                      </span>
                      <StanceIcon stance="grow" active={col === 2} compact />
                    </div>
                  </div>
                </div>
                <div
                  className={`text-xs leading-tight mt-1 line-clamp-2 ${subtitleClass(row.subtitleTone)}`}
                  title={row.subtitle}
                >
                  {row.subtitle}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
