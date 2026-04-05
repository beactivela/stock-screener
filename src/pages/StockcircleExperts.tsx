/**
 * Expert overlap — blended guru portfolios, 13F filers, FMP Congress (unified experts sync).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { API_BASE } from '../utils/api'
import { estimatePositionDollarDeltas } from '../utils/stockcircleActionDollars'
import { abbreviateExpertFirmDisplayName } from '../utils/abbreviateExpertFirmDisplayName'
import { formatUsdCompact } from '../utils/formatUsdCompact'
import {
  buildSortedExpertUniverse,
  computeTickerConsensusRows,
  splitConsensusByNet,
  sortConsensusTickerRows,
  type ExpertWeightLike,
  type ConsensusTickerRow,
  type ConsensusExpertRef,
  type ConsensusSortKey,
  isConsensusLargeBuyChip,
  sumConsensusBuyerPositionUsd,
  sumConsensusSellerPositionUsd,
} from '../utils/expertConsensus'
import {
  defaultBlendedSortDir,
  sortBlendedLeaderboardEntries,
  type BlendedLeaderboardEntry,
  type BlendedSortKey,
} from '../utils/blendedLeaderboardSort'

interface ExpertWeight {
  investorSlug: string
  firmName: string
  displayName: string
  performance1yPct: number | null
  performance3yPct?: number | null
  performance5yPct?: number | null
  performance10yPct?: number | null
  pctOfPortfolio: number | null
  positionValueUsd: number | null
  actionType: string
  /** % change in shares from last action line (when parsed). */
  actionPct?: number | null
  companyName: string | null
}

interface PopularRow {
  ticker: string
  buying_firms: number | null
  selling_firms: number | null
}

interface LatestRun {
  id: string
  started_at: string
  finished_at: string | null
  status: string
  investors_matched: number | null
  investors_fetched: number | null
  error_message: string | null
}

interface GatewayInfo {
  fmpCongress?: {
    finishedAt?: string | null
    senateRows?: number | null
    houseRows?: number | null
    error?: string
  } | null
  fmpInstitutional?: {
    status?: string
    detail?: string
    ok?: boolean
  } | null
}

interface CongressRow {
  chamber: string
  symbol: string | null
  disclosure_date: string | null
  transaction_date: string | null
  first_name: string | null
  last_name: string | null
  office: string | null
  district: string | null
  transaction_type: string | null
  amount_range: string | null
  asset_description: string | null
  link: string | null
}

interface WhalewisdomFilerSummary {
  slug: string
  displayName: string
  managerName: string
}

interface SummaryPayload {
  ok: boolean
  latestRun: LatestRun | null
  popular: PopularRow[]
  expertWeightsByTicker?: Record<string, ExpertWeight[]>
  whalewisdomFilers?: WhalewisdomFilerSummary[]
  gateway?: GatewayInfo
  congressRecent?: { senate: CongressRow[]; house: CongressRow[] }
  error?: string
}

/** Top N experts by 1Y % included in consensus tallies (UI controls removed). */
const CONSENSUS_TOP_K = 10
/** Cap overlap-matrix columns so the table stays usable when the API returns hundreds of tickers. */
const MATRIX_MAX_TICKERS = 500
const WEIGHT_VOTES_BY_PERFORMANCE = false

function fmtStockcirclePct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${Number(n).toFixed(1)}%`
}

/** One side’s summed guru position $ (millions band, or K/B for small/large). */
function formatInvestedUsd(usd: number): string {
  if (usd <= 0 || !Number.isFinite(usd)) return '—'
  if (usd >= 1e9 || usd < 1e6) return formatUsdCompact(usd)
  return `$${(usd / 1e6).toFixed(1)}M`
}

/** Sortable column header for the blended guru + 13F leaderboard (`aria-sort` + keyboard-focusable button). */
function BlendedSortHeader({
  column,
  label,
  activeKey,
  dir,
  alignRight,
  onSort,
}: {
  column: BlendedSortKey
  label: string
  activeKey: BlendedSortKey | null
  dir: 'asc' | 'desc'
  alignRight?: boolean
  onSort: (k: BlendedSortKey) => void
}) {
  const active = activeKey != null && column === activeKey
  return (
    <th
      scope="col"
      className={alignRight ? 'px-3 py-2 text-right' : 'px-3 py-2'}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`group inline-flex w-full min-h-[1.25rem] items-center gap-1 bg-transparent p-0 font-inherit text-[14px] uppercase tracking-wide text-inherit hover:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/80 rounded ${
          alignRight ? 'justify-end' : 'justify-start'
        }`}
      >
        <span>{label}</span>
        {active && (
          <span className="shrink-0 text-sky-400" aria-hidden="true">
            {dir === 'asc' ? '↑' : '↓'}
          </span>
        )}
      </button>
    </th>
  )
}

/** Sortable header for ticker consensus tables (`ConsensusTable`); mirrors `BlendedSortHeader` a11y pattern. */
function ConsensusSortHeader({
  column,
  label,
  title: headerTitle,
  activeKey,
  dir,
  alignRight,
  onSort,
}: {
  column: ConsensusSortKey
  label: string
  /** Extra context for the dollar column (sort key = net buy USD − sell USD). */
  title?: string
  activeKey: ConsensusSortKey | null
  dir: 'asc' | 'desc'
  alignRight?: boolean
  onSort: (k: ConsensusSortKey) => void
}) {
  const active = activeKey === column
  return (
    <th
      scope="col"
      className={alignRight ? 'px-3 py-2 text-right' : 'px-3 py-2'}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        title={headerTitle}
        onClick={() => onSort(column)}
        className={`group inline-flex w-full min-h-[1.25rem] items-center gap-1 bg-transparent p-0 font-inherit text-[14px] uppercase tracking-wide text-inherit hover:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/80 rounded ${
          alignRight ? 'justify-end' : 'justify-start'
        }`}
      >
        <span>{label}</span>
        {active && (
          <span className="shrink-0 text-sky-400" aria-hidden="true">
            {dir === 'asc' ? '↑' : '↓'}
          </span>
        )}
      </button>
    </th>
  )
}

function ExpertChips({
  experts,
  variant,
}: {
  experts: ConsensusExpertRef[]
  variant: 'buy' | 'sell'
}) {
  const max = 6
  const shown = experts.slice(0, max)
  const rest = experts.length - shown.length
  const border =
    variant === 'buy' ? 'border-emerald-800/60 text-emerald-200/90' : 'border-rose-800/60 text-rose-200/90'
  return (
    <div className="flex min-w-0 w-full flex-wrap gap-1">
      {shown.map((e) => {
        const largeBuy = isConsensusLargeBuyChip(variant, e.positionValueUsd)
        return (
        <Link
          key={e.investorSlug}
          to={`/experts/${e.investorSlug}`}
          title={
            largeBuy
              ? 'Large buy (≥$50M position) · % of portfolio (guru data)'
              : 'Position value (USD) · % of portfolio (guru data)'
          }
          className={`inline-flex max-w-[22rem] min-w-0 flex-nowrap items-baseline gap-1.5 rounded border px-1.5 py-0.5 text-left text-[14px] leading-none ${
            largeBuy
              ? 'border-emerald-400/75 bg-emerald-950/55 text-emerald-50 ring-1 ring-emerald-400/40 hover:bg-emerald-950/75'
              : `hover:bg-slate-800/80 ${border}`
          }`}
        >
          <span className="min-w-0 flex-1 truncate">{abbreviateExpertFirmDisplayName(e.firmName)}</span>
          <span
            className={`shrink-0 whitespace-nowrap text-[12px] font-normal tabular-nums ${
              largeBuy ? 'text-emerald-300/95' : 'text-slate-400/95'
            }`}
          >
            {formatUsdCompact(e.positionValueUsd ?? NaN)}{' '}
            <span className={largeBuy ? 'text-emerald-600/75' : 'text-slate-600'}>·</span>{' '}
            {fmtStockcirclePct(e.pctOfPortfolio)}
          </span>
        </Link>
        )
      })}
      {rest > 0 && <span className="self-center text-[14px] text-slate-500">+{rest}</span>}
    </div>
  )
}

function consensusDefaultSortDir(column: ConsensusSortKey): 'asc' | 'desc' {
  return column === 'ticker' ? 'asc' : 'desc'
}

function ConsensusTable({
  rows,
  weightVotesByPerformance,
}: {
  rows: ConsensusTickerRow[]
  weightVotesByPerformance: boolean
}) {
  const netLabel = weightVotesByPerformance ? 'Wtd net' : 'Net'
  /** `null` = preserve API / section order until the user picks a column. */
  const [consensusSort, setConsensusSort] = useState<{
    key: ConsensusSortKey
    dir: 'asc' | 'desc'
  } | null>(null)

  const displayRows = useMemo(() => {
    if (!consensusSort) return rows
    return sortConsensusTickerRows(
      rows,
      consensusSort.key,
      consensusSort.dir,
      weightVotesByPerformance
    )
  }, [rows, consensusSort, weightVotesByPerformance])

  const onConsensusSort = useCallback((column: ConsensusSortKey) => {
    setConsensusSort((prev) => {
      if (!prev || prev.key !== column) {
        return { key: column, dir: consensusDefaultSortDir(column) }
      }
      return { key: column, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
    })
  }, [])

  const activeKey = consensusSort?.key ?? null
  const dir = consensusSort?.dir ?? 'desc'

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-800">
      {/* text-[14px]: explicit px in CSS so DevTools never shows ~12px from stale 0.875rem text-sm */}
      <table className="min-w-[40rem] w-full text-left text-[14px] text-slate-300">
        <thead className="bg-slate-900/90 text-slate-400 text-[14px] uppercase tracking-wide">
          <tr>
            <ConsensusSortHeader
              column="ticker"
              label="Ticker"
              activeKey={activeKey}
              dir={dir}
              onSort={onConsensusSort}
            />
            <ConsensusSortHeader
              column="buyVotes"
              label="Buy"
              activeKey={activeKey}
              dir={dir}
              onSort={onConsensusSort}
            />
            <ConsensusSortHeader
              column="sellVotes"
              label="Sell"
              activeKey={activeKey}
              dir={dir}
              onSort={onConsensusSort}
            />
            <ConsensusSortHeader
              column="net"
              label={netLabel}
              activeKey={activeKey}
              dir={dir}
              onSort={onConsensusSort}
            />
            <ConsensusSortHeader
              column="dollarNet"
              label="Dollar invested"
              title="Sort by net buy minus sell dollars (reported positions, same expert cohort as chips)"
              activeKey={activeKey}
              dir={dir}
              onSort={onConsensusSort}
            />
            <ConsensusSortHeader
              column="bulls"
              label="Bulls (add / new)"
              activeKey={activeKey}
              dir={dir}
              onSort={onConsensusSort}
            />
            <ConsensusSortHeader
              column="bears"
              label="Bears (trim / sold)"
              activeKey={activeKey}
              dir={dir}
              onSort={onConsensusSort}
            />
          </tr>
        </thead>
        <tbody>
          {displayRows.map((r) => {
            const netDisplay = weightVotesByPerformance
              ? (r.weightedNet >= 0 ? '+' : '') + r.weightedNet.toFixed(1)
              : (r.net >= 0 ? '+' : '') + r.net
            const buyUsd = sumConsensusBuyerPositionUsd(r)
            const sellUsd = sumConsensusSellerPositionUsd(r)
            return (
              <tr key={r.ticker} className="border-t border-slate-800/80 hover:bg-slate-800/25 align-top">
                <td className="px-3 py-2 font-medium">
                  <Link to={`/stock/${r.ticker}`} className="text-sky-400 hover:text-sky-300">
                    {r.ticker}
                  </Link>
                </td>
                <td className="px-3 py-2 tabular-nums text-emerald-200/90">{r.buyVotes}</td>
                <td className="px-3 py-2 tabular-nums text-rose-200/90">{r.sellVotes}</td>
                <td className="px-3 py-2 tabular-nums text-slate-200">{netDisplay}</td>
                <td
                  className="px-3 py-2"
                  title="Sum of reported position sizes (USD) on buy vs sell among top-ranked experts in this row"
                >
                  <div className="flex min-w-[7.5rem] flex-col gap-0.5 tabular-nums leading-tight">
                    <span className="text-emerald-200/90">
                      Buy {formatInvestedUsd(buyUsd)}
                    </span>
                    <span className="text-rose-200/90">
                      Sell {formatInvestedUsd(sellUsd)}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <ExpertChips experts={r.buyers} variant="buy" />
                </td>
                <td className="px-3 py-2">
                  <ExpertChips experts={r.sellers} variant="sell" />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function StockcircleExperts() {
  const [data, setData] = useState<SummaryPayload | null>(null)
  const [err, setErr] = useState<string | null>(null)
  /** Bump to reload summary (initial load + after Sync). */
  const [refreshToken, setRefreshToken] = useState(0)
  const [postInFlight, setPostInFlight] = useState(false)
  const [syncBanner, setSyncBanner] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  /** LLM summary of largest estimated $ moves (loads once per summary refresh). */
  const [aiInsight, setAiInsight] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ready'; text: string; skipped?: boolean }
    | { status: 'no_llm' }
    | { status: 'error'; message: string }
  >({ status: 'idle' })
  /** OpenRouter Kimi K2.5: sector / money-flow narrative from consensus digest (replaces static coverage line). */
  const [moneyFlowNarrative, setMoneyFlowNarrative] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ready'; text: string; skipped?: boolean }
    | { status: 'no_llm' }
    | { status: 'error'; message: string }
  >({ status: 'idle' })
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [matrixOpen, setMatrixOpen] = useState(false)
  /** Tab 1 = ticker consensus; tab 2 = full expert list with multi-year performance. */
  const [expertsMainTab, setExpertsMainTab] = useState<'consensus' | 'experts'>('consensus')
  /** `key: null` = pipeline order, no header highlighted (matches original table). */
  const [blendedSort, setBlendedSort] = useState<{ key: BlendedSortKey | null; dir: 'asc' | 'desc' }>({
    key: null,
    dir: 'asc',
  })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/experts/summary`)
        const text = await res.text()
        let json: SummaryPayload & { error?: string }
        try {
          json = text.trim()
            ? (JSON.parse(text) as SummaryPayload)
            : { ok: false, error: 'Empty response', latestRun: null, popular: [] }
        } catch {
          if (!cancelled) {
            setErr(
              `Bad response (HTTP ${res.status}): ${text.trim().slice(0, 280) || res.statusText || 'not JSON'}. If you use Vite alone, run the API on port 3001 (\`npm run dev:server\`) or use \`npm run dev\` (Express + Vite on 5173).`
            )
          }
          return
        }
        if (!cancelled) {
          if (!res.ok) {
            const hint =
              json.error ||
              (text.trim() ? text.trim().slice(0, 280) : null) ||
              `${res.status} ${res.statusText}`
            setErr(hint)
            setData(null)
          } else if (!json.ok) {
            setErr(json.error || 'Unknown error')
            setData(null)
          } else {
            setErr(null)
            setData(json)
          }
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshToken])

  const summaryFingerprint =
    data?.ok && data.latestRun
      ? `${data.latestRun.finished_at ?? ''}|${data.latestRun.id ?? ''}|${(data.popular ?? []).length}`
      : ''

  useEffect(() => {
    if (!data?.ok || !summaryFingerprint || (data.popular ?? []).length === 0) {
      setAiInsight({ status: 'idle' })
      return
    }
    let cancelled = false
    setAiInsight({ status: 'loading' })
    ;(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/experts/ai-insights`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          disabled?: boolean
          error?: string
          text?: string
          skipped?: boolean
        }
        if (cancelled) return
        if (res.status === 503 && json.disabled) {
          setAiInsight({ status: 'no_llm' })
          return
        }
        if (!res.ok) {
          setAiInsight({ status: 'error', message: json.error || res.statusText })
          return
        }
        if (json.ok && typeof json.text === 'string') {
          setAiInsight({ status: 'ready', text: json.text, skipped: json.skipped })
        } else {
          setAiInsight({ status: 'error', message: json.error || 'Unexpected response' })
        }
      } catch (e) {
        if (!cancelled) {
          setAiInsight({ status: 'error', message: e instanceof Error ? e.message : String(e) })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [summaryFingerprint, refreshToken, data?.ok])

  useEffect(() => {
    if (!data?.ok || !summaryFingerprint || (data.popular ?? []).length === 0) {
      setMoneyFlowNarrative({ status: 'idle' })
      return
    }
    let cancelled = false
    setMoneyFlowNarrative({ status: 'loading' })
    ;(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/experts/consensus-buys-ai`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          disabled?: boolean
          error?: string
          text?: string
          skipped?: boolean
        }
        if (cancelled) return
        if (res.status === 503 && json.disabled) {
          setMoneyFlowNarrative({ status: 'no_llm' })
          return
        }
        if (!res.ok) {
          setMoneyFlowNarrative({ status: 'error', message: json.error || res.statusText })
          return
        }
        if (json.ok && typeof json.text === 'string') {
          setMoneyFlowNarrative({ status: 'ready', text: json.text, skipped: json.skipped })
        } else {
          setMoneyFlowNarrative({ status: 'error', message: json.error || 'Unexpected response' })
        }
      } catch (e) {
        if (!cancelled) {
          setMoneyFlowNarrative({ status: 'error', message: e instanceof Error ? e.message : String(e) })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [summaryFingerprint, refreshToken, data?.ok])

  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [])

  async function postExpertsSync(authHeader?: string) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (authHeader) headers.Authorization = authHeader
    return fetch(`${API_BASE}/api/cron/experts-sync`, { method: 'POST', headers })
  }

  async function handleExpertsSync() {
    if (postInFlight) return
    setPostInFlight(true)
    setSyncBanner(null)
    try {
      let res = await postExpertsSync()
      if (res.status === 401) {
        const secret = window.prompt(
          'This server requires CRON_SECRET. Paste it (only used for this request, not stored):'
        )
        if (!secret?.trim()) {
          setSyncBanner({ kind: 'error', text: 'Sync cancelled — secret required.' })
          return
        }
        res = await postExpertsSync(`Bearer ${secret.trim()}`)
      }
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (res.status === 503 && String(json.error || '').includes('CRON_SECRET')) {
        setSyncBanner({
          kind: 'error',
          text: 'Server is not configured for cron triggers (CRON_SECRET).',
        })
        return
      }
      if (!res.ok && res.status !== 202) {
        throw new Error(json.error || res.statusText)
      }
      setSyncBanner({
        kind: 'ok',
        text:
          'Unified sync started (Congress, guru portfolios, 13F filers). Refreshing this page every 12s…',
      })
      setRefreshToken((t) => t + 1)
      if (pollRef.current) clearInterval(pollRef.current)
      let n = 0
      pollRef.current = setInterval(() => {
        n += 1
        setRefreshToken((t) => t + 1)
        if (n >= 25) {
          if (pollRef.current) clearInterval(pollRef.current)
          pollRef.current = null
          setSyncBanner({
            kind: 'ok',
            text: 'Auto-refresh paused. Run Sync again or reload if the job was still running.',
          })
        }
      }, 12000)
    } catch (e) {
      setSyncBanner({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setPostInFlight(false)
    }
  }

  const popular = data?.popular ?? []
  /** First N tickers by “firms buying” for the wide overlap matrix only (full `popular` drives consensus). */
  const popularMatrix = useMemo(
    () => popular.slice(0, MATRIX_MAX_TICKERS),
    [popular]
  )
  const weights = data?.expertWeightsByTicker ?? {}
  const gateway = data?.gateway
  const congressRecent = data?.congressRecent
  const fmpInst = gateway?.fmpInstitutional

  function weightsForTicker(ticker: string): ExpertWeight[] {
    const k = String(ticker || '').trim().toUpperCase()
    return weights[k] ?? weights[ticker] ?? []
  }

  /** Experts that appear on at least one popular ticker, sorted by 1Y performance (highest first). */
  const expertRows = useMemo(
    () => buildSortedExpertUniverse(popular, weights as Record<string, ExpertWeightLike[]>),
    [popular, weights]
  )

  const consensusRows = useMemo(
    () =>
      computeTickerConsensusRows(popular, weights as Record<string, ExpertWeightLike[]>, {
        topK: CONSENSUS_TOP_K,
        minVotes: 1,
        weightByPerformance: WEIGHT_VOTES_BY_PERFORMANCE,
      }),
    [popular, weights]
  )

  const { buyLeaning, sellLeaning, mixed } = useMemo(
    () => splitConsensusByNet(consensusRows),
    [consensusRows]
  )

  /** True multi-expert overlap (what most people mean by “consensus”). */
  const buyMultiExpert = useMemo(() => buyLeaning.filter((r) => r.buyVotes >= 2), [buyLeaning])
  /** Net buy but only one of the selected experts is adding — informative, noisy if listed alone. */
  const buySingleExpert = useMemo(() => buyLeaning.filter((r) => r.buyVotes === 1), [buyLeaning])

  const expertsInDataset = expertRows.length
  const effectiveTopK = Math.min(CONSENSUS_TOP_K, Math.max(1, expertsInDataset))

  /** Guru overlap rows first (with return % when synced), then 13F filers not already in that set. */
  const blendedLeaderboard = useMemo((): BlendedLeaderboardEntry[] => {
    const ww = data?.whalewisdomFilers ?? []
    const guruSlugs = new Set(expertRows.map((e) => e.investorSlug))
    const guru: BlendedLeaderboardEntry[] = expertRows.map((row) => ({ kind: 'guru', row }))
    const extra: BlendedLeaderboardEntry[] = ww
      .filter((w) => !guruSlugs.has(w.slug))
      .map((w) => ({
        kind: 'whalewisdom' as const,
        slug: w.slug,
        displayName: w.displayName,
        managerName: w.managerName,
      }))
    return [...guru, ...extra]
  }, [expertRows, data?.whalewisdomFilers])

  const handleBlendedSort = useCallback((key: BlendedSortKey) => {
    setBlendedSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: defaultBlendedSortDir(key) }
    )
  }, [])

  const sortedBlendedLeaderboard = useMemo(
    () =>
      sortBlendedLeaderboardEntries(
        blendedLeaderboard,
        expertRows,
        CONSENSUS_TOP_K,
        blendedSort.key ?? 'pipeline',
        blendedSort.dir
      ),
    [blendedLeaderboard, expertRows, blendedSort]
  )

  function findWeight(slug: string, ticker: string): ExpertWeight | null {
    const list = weightsForTicker(ticker)
    return list.find((w) => w.investorSlug === slug) ?? null
  }

  return (
    <div className="w-full max-w-none px-1 sm:px-0">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <h1 className="text-2xl font-semibold text-slate-100">Expert consensus</h1>
        <button
          type="button"
          onClick={() => void handleExpertsSync()}
          disabled={postInFlight}
          className="shrink-0 rounded-lg border border-sky-600/80 bg-sky-900/40 px-4 py-2 text-sm font-medium text-sky-200 hover:bg-sky-800/50 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Sync experts: Congress disclosures, guru portfolios, WhaleWisdom 13F filers"
        >
          {postInFlight ? 'Starting…' : 'Sync'}
        </button>
      </div>
      {syncBanner && (
        <p
          className={`mb-3 text-sm ${syncBanner.kind === 'error' ? 'text-amber-400' : 'text-emerald-400/95'}`}
          role="status"
        >
          {syncBanner.text}
        </p>
      )}

      {err && (
        <p className="text-amber-400 text-sm mb-4" role="alert">
          {err}
        </p>
      )}

      {data?.latestRun && (
        <p className="text-slate-500 text-xs mb-3">
          Last sync:{' '}
          <span className="text-slate-300">
            {data.latestRun.finished_at ? new Date(data.latestRun.finished_at).toLocaleString() : '—'}
          </span>
          {' · '}
          Guru portfolios in run: {data.latestRun.investors_fetched ?? data.latestRun.investors_matched ?? '—'} (matched:{' '}
          {data.latestRun.investors_matched ?? '—'})
        </p>
      )}

      {!data && !err && <p className="text-slate-500">Loading expert data…</p>}

      {data?.ok && popular.length === 0 && (
        <p className="text-slate-500">
          No overlap data yet. Run <code className="text-sky-400">npm run experts:sync</code> or use{' '}
          <strong>Sync</strong> (applies migration for FMP tables in Supabase first — see{' '}
          <code className="text-sky-400">docs/supabase/migration-fmp-congress.sql</code>).
        </p>
      )}

      {data?.ok && (popular.length > 0 || blendedLeaderboard.length > 0) && (
        <div className="mb-4">
          <div
            role="tablist"
            aria-label="Expert views"
            className="flex flex-wrap gap-1 border-b border-slate-800"
          >
            <button
              type="button"
              role="tab"
              id="experts-tab-consensus"
              aria-selected={expertsMainTab === 'consensus'}
              aria-controls="experts-panel-consensus"
              tabIndex={expertsMainTab === 'consensus' ? 0 : -1}
              onClick={() => setExpertsMainTab('consensus')}
              className={`rounded-t-md px-4 py-2.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/80 ${
                expertsMainTab === 'consensus'
                  ? 'border border-b-0 border-slate-700 bg-slate-900/90 text-slate-100'
                  : 'border border-transparent text-slate-500 hover:text-slate-300'
              }`}
            >
              Consensus overlap
            </button>
            <button
              type="button"
              role="tab"
              id="experts-tab-all"
              aria-selected={expertsMainTab === 'experts'}
              aria-controls="experts-panel-experts"
              tabIndex={expertsMainTab === 'experts' ? 0 : -1}
              onClick={() => setExpertsMainTab('experts')}
              className={`rounded-t-md px-4 py-2.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/80 ${
                expertsMainTab === 'experts'
                  ? 'border border-b-0 border-slate-700 bg-slate-900/90 text-slate-100'
                  : 'border border-transparent text-slate-500 hover:text-slate-300'
              }`}
            >
              All experts · performance (1Y–10Y)
            </button>
          </div>

          <div
            role="tabpanel"
            id="experts-panel-consensus"
            aria-labelledby="experts-tab-consensus"
            hidden={expertsMainTab !== 'consensus'}
            className={expertsMainTab === 'consensus' ? 'pt-4' : ''}
          >
            {popular.length > 0 ? (
              <>
                <div
                  className="mb-4 rounded-lg border border-teal-500/25 bg-teal-950/20 px-3 py-3 text-sm text-slate-300"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  <h3 className="text-sm font-semibold text-teal-200/95 mb-2">
                    AI — money flow &amp; sectors
                  </h3>
                  {(moneyFlowNarrative.status === 'idle' || moneyFlowNarrative.status === 'loading') && (
                    <p className="text-xs text-slate-500">
                      Mapping buys/sells to sector themes and where capital is clustering…
                    </p>
                  )}
                  {moneyFlowNarrative.status === 'no_llm' && (
                    <p className="text-xs text-slate-500">
                      Set <code className="text-slate-400">OPENROUTER_API_KEY</code> for this narrative (same default
                      model as server: Kimi K2.5).
                    </p>
                  )}
                  {moneyFlowNarrative.status === 'error' && (
                    <p className="text-xs text-amber-400/95" role="alert">
                      {moneyFlowNarrative.message}
                    </p>
                  )}
                  {moneyFlowNarrative.status === 'ready' && (
                    <div className="text-sm text-slate-200/95 leading-relaxed space-y-2">
                      {moneyFlowNarrative.skipped && (
                        <p className="text-xs text-slate-500">Light snapshot — limited consensus rows in this run.</p>
                      )}
                      <p className="whitespace-pre-wrap">{moneyFlowNarrative.text}</p>
                      <p className="text-xs text-slate-500">
                        Votes and USD come from StockCircle overlap data (reported positions, not verified filings).
                      </p>
                    </div>
                  )}
                </div>

            {buyMultiExpert.length > 0 && (
              <section className="mb-6" aria-labelledby="consensus-buys-strong-heading">
                <h2 id="consensus-buys-strong-heading" className="text-lg font-semibold text-emerald-200/95 mb-2">
                  Strong consensus buys (2+ experts)
                </h2>
                <p className="text-xs text-slate-500 mb-2">
                  At least two of the up-to-{effectiveTopK} ranked experts show an add or new position; sells/trims on
                  the same ticker count against that.
                </p>
                <ConsensusTable rows={buyMultiExpert} weightVotesByPerformance={WEIGHT_VOTES_BY_PERFORMANCE} />
              </section>
            )}

            {buySingleExpert.length > 0 && (
              <section className="mb-6" aria-labelledby="consensus-buys-solo-heading">
                <h2
                  id="consensus-buys-solo-heading"
                  className="text-base font-semibold text-emerald-300/85 mb-2"
                >
                  Other net buys (single expert among top ranks)
                </h2>
                <p className="text-xs text-slate-500 mb-2">
                  Net positive among ranked experts, but only one expert has an add/increase on this symbol — useful for
                  ideas, not multi-manager overlap.
                </p>
                <ConsensusTable rows={buySingleExpert} weightVotesByPerformance={WEIGHT_VOTES_BY_PERFORMANCE} />
              </section>
            )}

            {sellLeaning.length > 0 && (
              <section className="mb-6" aria-labelledby="consensus-sells-heading">
                <h2 id="consensus-sells-heading" className="text-lg font-semibold text-rose-200/95 mb-2">
                  Consensus sells / trims (net lean sell)
                </h2>
                <ConsensusTable rows={sellLeaning} weightVotesByPerformance={WEIGHT_VOTES_BY_PERFORMANCE} />
              </section>
            )}

            {mixed.length > 0 && (
              <section className="mb-6" aria-labelledby="mixed-heading">
                <h2 id="mixed-heading" className="text-base font-semibold text-slate-300 mb-2">
                  Split / tied (net 0 among selected experts)
                </h2>
                <p className="text-xs text-slate-500 mb-2">
                  Same number of buy and sell votes from the up-to-{effectiveTopK} ranked experts on this ticker.
                </p>
                <ConsensusTable rows={mixed} weightVotesByPerformance={WEIGHT_VOTES_BY_PERFORMANCE} />
              </section>
            )}

            {expertRows.length > 0 && consensusRows.length === 0 && (
              <p className="mb-6 text-sm text-slate-500">
                No buy or sell votes from the ranked experts on these tickers — check again after another sync.
              </p>
            )}
              </>
            ) : (
              <p className="text-sm text-slate-500 py-2">
                No ticker overlap data in this run. Use the <strong>All experts · performance</strong> tab to browse
                names and multi-year returns (guru portfolios show 1Y–10Y when synced).
              </p>
            )}
          </div>

          <div
            role="tabpanel"
            id="experts-panel-experts"
            aria-labelledby="experts-tab-all"
            hidden={expertsMainTab !== 'experts'}
            className={expertsMainTab === 'experts' ? 'pt-4' : ''}
          >
          {blendedLeaderboard.length > 0 ? (
            <section className="mb-2" aria-labelledby="blended-leaderboard-heading">
              <h2 id="blended-leaderboard-heading" className="text-lg font-semibold text-slate-100 mb-2">
                All tracked experts &amp; filers
              </h2>
              <p className="text-xs text-slate-500 mb-2">
                Single blended list from your unified pipeline: guru portfolios (return % when the sync captured
                performance) plus configured WhaleWisdom filers. <strong>Source</strong> marks the track; open a row for
                the detail page. To add more guru portfolios, raise{' '}
                <code className="text-slate-400">STOCKCIRCLE_MAX_INVESTORS</code> and complete runs (match “portfolios
                in run” to “matched”). Multi-year return columns need the performance migration + sync.
              </p>
              <div className="overflow-x-auto rounded-lg border border-slate-800">
                <table className="min-w-[56rem] w-full text-left text-[14px] text-slate-300">
                  <thead className="bg-slate-900/90 text-slate-400 text-[14px] uppercase tracking-wide">
                    <tr>
                      <BlendedSortHeader
                        column="pipeline"
                        label="#"
                        activeKey={blendedSort.key}
                        dir={blendedSort.dir}
                        onSort={handleBlendedSort}
                      />
                      <BlendedSortHeader
                        column="name"
                        label="Name"
                        activeKey={blendedSort.key}
                        dir={blendedSort.dir}
                        onSort={handleBlendedSort}
                      />
                      <BlendedSortHeader
                        column="source"
                        label="Source"
                        activeKey={blendedSort.key}
                        dir={blendedSort.dir}
                        onSort={handleBlendedSort}
                      />
                      <BlendedSortHeader
                        column="perf1y"
                        label="1Y"
                        alignRight
                        activeKey={blendedSort.key}
                        dir={blendedSort.dir}
                        onSort={handleBlendedSort}
                      />
                      <BlendedSortHeader
                        column="perf3y"
                        label="3Y"
                        alignRight
                        activeKey={blendedSort.key}
                        dir={blendedSort.dir}
                        onSort={handleBlendedSort}
                      />
                      <BlendedSortHeader
                        column="perf5y"
                        label="5Y"
                        alignRight
                        activeKey={blendedSort.key}
                        dir={blendedSort.dir}
                        onSort={handleBlendedSort}
                      />
                      <BlendedSortHeader
                        column="perf10y"
                        label="10Y"
                        alignRight
                        activeKey={blendedSort.key}
                        dir={blendedSort.dir}
                        onSort={handleBlendedSort}
                      />
                      <BlendedSortHeader
                        column="overlap"
                        label="Overlap vote"
                        activeKey={blendedSort.key}
                        dir={blendedSort.dir}
                        onSort={handleBlendedSort}
                      />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedBlendedLeaderboard.map((entry, i) => {
                      const rank = i + 1
                      if (entry.kind === 'whalewisdom') {
                        const label = entry.managerName || entry.displayName
                        return (
                          <tr key={`ww-${entry.slug}`} className="border-t border-slate-800/80 hover:bg-slate-800/25">
                            <td className="px-3 py-2 tabular-nums text-slate-500">{rank}</td>
                            <td className="px-3 py-2">
                              <Link
                                to={`/whalewisdom-filers/${encodeURIComponent(entry.slug)}`}
                                className="text-sky-400 hover:text-sky-300 font-medium"
                              >
                                {abbreviateExpertFirmDisplayName(label)}
                              </Link>
                            </td>
                            <td className="px-3 py-2 text-slate-400">13F (WhaleWisdom)</td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-500">—</td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-500">—</td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-500">—</td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-500">—</td>
                            <td className="px-3 py-2 text-slate-600">—</td>
                          </tr>
                        )
                      }
                      const ex = entry.row
                      const guruRank = expertRows.findIndex((e) => e.investorSlug === ex.investorSlug)
                      const inPanel = guruRank >= 0 && guruRank < CONSENSUS_TOP_K
                      return (
                        <tr key={ex.investorSlug} className="border-t border-slate-800/80 hover:bg-slate-800/25">
                          <td className="px-3 py-2 tabular-nums text-slate-500">{rank}</td>
                          <td className="px-3 py-2">
                            <Link
                              to={`/experts/${ex.investorSlug}`}
                              className="text-sky-400 hover:text-sky-300 font-medium"
                            >
                              {abbreviateExpertFirmDisplayName(ex.firmName)}
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-slate-400">Guru portfolio</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-200">
                            {fmtStockcirclePct(ex.performance1yPct)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-200">
                            {fmtStockcirclePct(ex.performance3yPct)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-200">
                            {fmtStockcirclePct(ex.performance5yPct)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-200">
                            {fmtStockcirclePct(ex.performance10yPct)}
                          </td>
                          <td className="px-3 py-2">
                            {inPanel ? (
                              <span className="inline-flex rounded border border-emerald-500/40 bg-emerald-950/40 px-2 py-0.5 text-xs text-emerald-200/95">
                                In top ranks
                              </span>
                            ) : (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <p className="text-sm text-slate-500">
              No experts in this dataset yet — run <strong>Sync</strong> after unified experts sync completes.
            </p>
          )}
          </div>
        </div>
      )}

      {popular.length > 0 && aiInsight.status !== 'idle' && (
        <div
          className="mb-6 rounded-lg border border-violet-500/25 bg-violet-950/20 px-4 py-3"
          aria-live="polite"
        >
          <h2 className="text-sm font-semibold text-violet-200/95 mb-2">AI snapshot — major moves</h2>
          {aiInsight.status === 'loading' && (
            <p className="text-xs text-slate-500">Analyzing estimated adds, trims, and recent Congress lines…</p>
          )}
          {aiInsight.status === 'no_llm' && (
            <p className="text-xs text-slate-500">
              Add <code className="text-slate-400">OPENROUTER_API_KEY</code> (default model Kimi K2.5) or{' '}
              <code className="text-slate-400">ANTHROPIC_API_KEY</code> /{' '}
              <code className="text-slate-400">OPENAI_API_KEY</code> for automatic summaries.
            </p>
          )}
          {aiInsight.status === 'error' && (
            <p className="text-xs text-amber-400/95" role="alert">
              {aiInsight.message}
            </p>
          )}
          {aiInsight.status === 'ready' && (
            <div className="text-sm text-slate-200/95 leading-relaxed space-y-2">
              {aiInsight.skipped && (
                <p className="text-xs text-slate-500">Light snapshot — limited change data in this run.</p>
              )}
              <p className="whitespace-pre-wrap">{aiInsight.text}</p>
              <p className="text-xs text-slate-500">
                Estimates match the table math (position × action %) — not audited filings.
              </p>
            </div>
          )}
        </div>
      )}

      <details className="mb-4 rounded-lg border border-slate-800 bg-slate-950/30">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-400 hover:text-slate-300">
          Gateway: FMP Congress sync &amp; 13F API probe
        </summary>
        <div className="border-t border-slate-800 px-3 py-2 text-xs text-slate-500 space-y-2">
          {gateway?.fmpCongress && !gateway.fmpCongress.error && (
            <p>
              FMP Congress:{' '}
              {gateway.fmpCongress.finishedAt
                ? new Date(gateway.fmpCongress.finishedAt).toLocaleString()
                : '—'}
              {gateway.fmpCongress.senateRows != null && (
                <span>
                  {' '}
                  · Senate {gateway.fmpCongress.senateRows} · House {gateway.fmpCongress.houseRows ?? '—'}
                </span>
              )}
            </p>
          )}
          {fmpInst && (
            <p title={fmpInst.detail}>
              FMP 13F / institutional:{' '}
              <span className="text-slate-300">
                {fmpInst.status === 'available'
                  ? 'available on your plan (probe succeeded).'
                  : fmpInst.status === 'subscription_or_plan'
                    ? 'not available on current plan.'
                    : fmpInst.status ?? '—'}
              </span>
            </p>
          )}
        </div>
      </details>

      {congressRecent &&
        (congressRecent.senate.length > 0 || congressRecent.house.length > 0) && (
          <div className="mb-6 rounded-lg border border-slate-800 bg-slate-950/40 p-4">
            <h2 className="text-sm font-semibold text-slate-200 mb-1">Congress (latest synced disclosures)</h2>
            <p className="text-xs text-slate-500 mb-3">
              Legislative stock disclosures from the same unified sync — alongside guru / 13F data above.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              {congressRecent.senate.length > 0 && (
                <div>
                  <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-2">Senate</h3>
                  <ul className="space-y-2 text-xs text-slate-300 max-h-48 overflow-y-auto">
                    {congressRecent.senate.slice(0, 12).map((r, i) => (
                      <li key={`s-${i}`} className="border-b border-slate-800/80 pb-2">
                        <span className="text-sky-400 font-medium">{r.symbol ?? '—'}</span>{' '}
                        <span className="text-slate-500">{r.transaction_type}</span>
                        {r.amount_range && <span className="text-slate-500"> · {r.amount_range}</span>}
                        <span className="block text-slate-500 mt-0.5">
                          {r.office ?? [r.first_name, r.last_name].filter(Boolean).join(' ')}
                          {r.disclosure_date && ` · disclosed ${r.disclosure_date}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {congressRecent.house.length > 0 && (
                <div>
                  <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-2">House</h3>
                  <ul className="space-y-2 text-xs text-slate-300 max-h-48 overflow-y-auto">
                    {congressRecent.house.slice(0, 12).map((r, i) => (
                      <li key={`h-${i}`} className="border-b border-slate-800/80 pb-2">
                        <span className="text-sky-400 font-medium">{r.symbol ?? '—'}</span>{' '}
                        <span className="text-slate-500">{r.transaction_type}</span>
                        {r.amount_range && <span className="text-slate-500"> · {r.amount_range}</span>}
                        <span className="block text-slate-500 mt-0.5">
                          {r.office ?? [r.first_name, r.last_name].filter(Boolean).join(' ')}
                          {r.disclosure_date && ` · disclosed ${r.disclosure_date}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

      {data?.ok && data.latestRun != null && (data.latestRun.investors_fetched ?? 0) < 25 && (
        <div
          className="mb-4 rounded border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-100/95"
          role="note"
        >
          <p className="font-medium text-amber-200/95">Why “Firms buying” is often 1</p>
          <p className="mt-1 text-amber-100/85">
            That column counts experts in the last sync with a <strong>new</strong> or <strong>increased</strong>{' '}
            position — not total purchases.
          </p>
          <p className="mt-2 text-amber-100/85">
            Your last run loaded <strong>{data.latestRun.investors_fetched ?? '—'}</strong> guru portfolio(s). For more
            overlap on the same ticker, run a <strong>full</strong> unified sync or raise{' '}
            <code className="text-amber-200">STOCKCIRCLE_MAX_INVESTORS</code>.
          </p>
        </div>
      )}

      {popular.length > 0 && (
        <details
          className="group mb-6 rounded-lg border border-slate-800"
          open={matrixOpen}
          onToggle={(e) => setMatrixOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium text-slate-300 hover:bg-slate-900/50 [&::-webkit-details-marker]:hidden">
            <span className="text-slate-400 group-open:hidden">▸</span>
            <span className="text-slate-400 hidden group-open:inline">▾</span>
            {' '}
            Overlap matrix (advanced) — experts × tickers
          </summary>
          <div className="border-t border-slate-800 px-3 pb-3">
            {expertRows.length > 0 && (
              <p className="my-3 text-xs text-slate-500">
                Rows are experts; columns are tickers from the latest sync (first {MATRIX_MAX_TICKERS} by “firms buying”
                — full ticker set drives the consensus tables above). Each cell shows % of that expert’s portfolio and
                estimated $ change for adds (green) or trims/sells (red) — not audited.
              </p>
            )}
            {expertRows.length === 0 ? (
              <p className="text-slate-500 text-sm py-2">No expert rows — matrix is empty for this dataset.</p>
            ) : (
              <div className="overflow-x-auto max-h-[min(85vh,1200px)] overflow-y-auto">
                <table className="min-w-max text-xs text-left text-slate-300 border-collapse">
                  <thead className="bg-slate-900/95 text-slate-400 uppercase sticky top-0 z-20 shadow-sm">
                    <tr>
                      <th
                        scope="col"
                        className="sticky left-0 z-30 bg-slate-900/95 px-2 py-2 text-left font-medium border-b border-r border-slate-800 min-w-[10rem]"
                      >
                        Expert
                      </th>
                      {popularMatrix.map((row) => (
                        <th
                          key={row.ticker}
                          scope="col"
                          className="px-1.5 py-2 text-center font-medium border-b border-slate-800 align-bottom min-w-[4.5rem] max-w-[6rem]"
                          title={`Buying firms: ${row.buying_firms ?? 0} · Selling: ${row.selling_firms ?? 0}`}
                        >
                          <Link
                            to={`/stock/${row.ticker}`}
                            className="text-sky-400 hover:text-sky-300 font-semibold normal-case tracking-normal"
                          >
                            {row.ticker}
                          </Link>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {expertRows.map((ex) => (
                      <tr key={ex.investorSlug} className="border-t border-slate-800/80 hover:bg-slate-800/30">
                        <th
                          scope="row"
                          className="sticky left-0 z-10 bg-slate-950/95 px-2 py-1.5 text-left font-normal border-r border-slate-800 align-top whitespace-nowrap"
                        >
                          <Link
                            to={`/experts/${ex.investorSlug}`}
                            className="text-sky-400 hover:underline font-medium text-sm"
                            title={[
                              ex.performance1yPct != null ? `1Y ${fmtStockcirclePct(ex.performance1yPct)}` : null,
                              ex.performance3yPct != null ? `3Y ${fmtStockcirclePct(ex.performance3yPct)}` : null,
                              ex.performance5yPct != null ? `5Y ${fmtStockcirclePct(ex.performance5yPct)}` : null,
                              ex.performance10yPct != null ? `10Y ${fmtStockcirclePct(ex.performance10yPct)}` : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          >
                            {abbreviateExpertFirmDisplayName(ex.firmName)}
                          </Link>
                          <span className="block text-xs leading-tight text-slate-500 mt-0.5 max-w-[11rem]">
                            1Y {fmtStockcirclePct(ex.performance1yPct)} · 3Y {fmtStockcirclePct(ex.performance3yPct)} ·
                            5Y {fmtStockcirclePct(ex.performance5yPct)} · 10Y {fmtStockcirclePct(ex.performance10yPct)}
                          </span>
                        </th>
                        {popularMatrix.map((row) => {
                          const w = findWeight(ex.investorSlug, row.ticker)
                          const { increaseUsd, decreaseUsd } = w
                            ? estimatePositionDollarDeltas(
                                w.actionType,
                                w.actionPct ?? null,
                                w.positionValueUsd ?? null
                              )
                            : { increaseUsd: null, decreaseUsd: null }
                          return (
                            <td
                              key={`${ex.investorSlug}-${row.ticker}`}
                              className="px-1 py-1 border-l border-slate-800/60 align-top text-center"
                            >
                              {!w ? (
                                <span className="text-slate-700">·</span>
                              ) : (
                                <div className="flex flex-col items-center gap-0.5 leading-tight">
                                  {w.pctOfPortfolio != null ? (
                                    <span className="text-slate-200 tabular-nums">{w.pctOfPortfolio.toFixed(1)}%</span>
                                  ) : (
                                    <span className="text-slate-600">—</span>
                                  )}
                                  {increaseUsd != null && (
                                    <span
                                      className="text-emerald-400/95 tabular-nums"
                                      title={`Est. add / new $ (full ~${increaseUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })})`}
                                    >
                                      +{formatUsdCompact(increaseUsd)}
                                    </span>
                                  )}
                                  {decreaseUsd != null && (
                                    <span
                                      className="text-rose-400/95 tabular-nums"
                                      title={`Est. trim / sell $ (full ~${decreaseUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })})`}
                                    >
                                      {formatUsdCompact(-decreaseUsd)}
                                    </span>
                                  )}
                                  {increaseUsd == null &&
                                    decreaseUsd == null &&
                                    w.actionType !== 'unknown' && (
                                      <span className="text-slate-600 text-xs" title={w.actionType}>
                                        {w.actionType.replace('_', ' ')}
                                      </span>
                                    )}
                                </div>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  )
}
