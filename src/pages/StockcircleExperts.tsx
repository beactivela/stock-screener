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
  convictionScoreBucket,
  syncFreshnessLabel,
  DEFAULT_CONSENSUS_TOP_K_CAP,
  filterConsensusRowsByMinTotalUsd,
} from '../utils/expertConsensus'
import {
  defaultBlendedSortDir,
  sortBlendedLeaderboardEntries,
  type BlendedLeaderboardEntry,
  type BlendedSortKey,
} from '../utils/blendedLeaderboardSort'
import { CONGRESS_TRADES_LEADERBOARD } from '../data/congressTradesLeaderboard'

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

interface QuiverTradeRow {
  symbol?: string | null
  transaction_date?: string | null
  transaction_type?: string | null
  amount_range?: string | null
  description?: string | null
}

interface QuiverCongressMemberPayload {
  bioguideId: string
  fullName: string
  perf1yPct: number | null
  perf3yPct: number | null
  perf5yPct: number | null
  perf10yPct: number | null
  strategyStartDate?: string | null
  recentTrades: QuiverTradeRow[]
}

interface SummaryPayload {
  ok: boolean
  latestRun: LatestRun | null
  popular: PopularRow[]
  expertWeightsByTicker?: Record<string, ExpertWeight[]>
  whalewisdomFilers?: WhalewisdomFilerSummary[]
  gateway?: GatewayInfo
  congressRecent?: { senate: CongressRow[]; house: CongressRow[] }
  quiverCongress?: {
    finishedAt?: string | null
    runId?: string
    members?: QuiverCongressMemberPayload[]
  } | null
  /** Per-ticker overlap with WhaleWisdom 13F + Congress (conviction multipliers). */
  crossSourceTickers?: Record<string, { whalewisdom: boolean; congress: boolean }>
  error?: string
}

/** Max experts in the consensus voting panel (effective = min(this, universe size)). */
const CONSENSUS_TOP_K_CAP = DEFAULT_CONSENSUS_TOP_K_CAP
/** Cap overlap-matrix columns so the table stays usable when the API returns hundreds of tickers. */
const MATRIX_MAX_TICKERS = 500
/** Weight votes by blended trailing performance; matches conviction scoring defaults. */
const WEIGHT_VOTES_BY_PERFORMANCE = true

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
        const topHolding = Boolean(e.isTopHolding)
        return (
        <Link
          key={e.investorSlug}
          to={`/experts/${e.investorSlug}`}
          title={`${topHolding ? "Largest position in this expert's book (by % of portfolio). " : ''}${
            largeBuy
              ? 'Large buy (≥$50M position) · % of portfolio (guru data)'
              : 'Position value (USD) · % of portfolio (guru data)'
          }`}
          className={`inline-flex max-w-[22rem] min-w-0 flex-nowrap items-baseline gap-1.5 rounded border px-1.5 py-0.5 text-left text-[14px] leading-none hover:bg-slate-800/80 ${border}`}
        >
          <span className="min-w-0 flex-1 truncate">
            {abbreviateExpertFirmDisplayName(e.firmName)}
            {topHolding ? (
              <span className="text-amber-400/90 ml-0.5" aria-hidden="true">
                ★
              </span>
            ) : null}
          </span>
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
  if (column === 'ticker') return 'asc'
  /** Conviction / vote counts: higher first */
  return 'desc'
}

function ConsensusTable({
  rows,
  weightVotesByPerformance,
}: {
  rows: ConsensusTickerRow[]
  weightVotesByPerformance: boolean
}) {
  const netLabel = weightVotesByPerformance ? 'Wtd net' : 'Net'
  /** Default: Score (conviction) high → low; user can change column or toggle direction. */
  const [consensusSort, setConsensusSort] = useState<{
    key: ConsensusSortKey
    dir: 'asc' | 'desc'
  }>({ key: 'conviction', dir: 'desc' })

  const displayRows = useMemo(
    () =>
      sortConsensusTickerRows(
        rows,
        consensusSort.key,
        consensusSort.dir,
        weightVotesByPerformance
      ),
    [rows, consensusSort, weightVotesByPerformance]
  )

  const onConsensusSort = useCallback((column: ConsensusSortKey) => {
    setConsensusSort((prev) => {
      if (prev.key !== column) {
        return { key: column, dir: consensusDefaultSortDir(column) }
      }
      return { key: column, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
    })
  }, [])

  const activeKey = consensusSort.key
  const dir = consensusSort.dir

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
              column="conviction"
              label="Score"
              title="Composite conviction 0–100 (overlap, position %, blended performance, action strength; ×1.2 WW / ×1.1 Congress when applicable)"
              activeKey={activeKey}
              dir={dir}
              alignRight
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
            const bucket = convictionScoreBucket(r.convictionScore)
            const scoreCls =
              bucket === 'high'
                ? 'text-emerald-300 font-semibold'
                : bucket === 'medium'
                  ? 'text-amber-200/95'
                  : 'text-slate-400'
            const avgDom =
              r.net >= 0 ? r.avgBuyerPctOfPortfolio : r.avgSellerPctOfPortfolio
            return (
              <tr key={r.ticker} className="border-t border-slate-800/80 hover:bg-slate-800/25 align-top">
                <td className="px-3 py-2 font-medium">
                  <Link to={`/stock/${r.ticker}`} className="text-sky-400 hover:text-sky-300">
                    {r.ticker}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right align-top">
                  <div className={`tabular-nums text-lg leading-tight ${scoreCls}`}>
                    {Math.round(r.convictionScore)}
                  </div>
                  <div className="text-[11px] text-slate-500 leading-tight mt-0.5">
                    {avgDom != null && Number.isFinite(avgDom) ? (
                      <span title="Average % of portfolio (dominant side among panel experts)">
                        Avg {avgDom.toFixed(1)}% port
                      </span>
                    ) : (
                      <span className="invisible">—</span>
                    )}
                  </div>
                  <div className="flex flex-wrap justify-end gap-1 mt-1">
                    {r.crossSourceWhalewisdom ? (
                      <span
                        className="text-[10px] uppercase tracking-wide rounded border border-sky-700/50 px-1 text-sky-300/90"
                        title="Ticker also appears in latest WhaleWisdom 13F snapshot"
                      >
                        WW
                      </span>
                    ) : null}
                    {r.crossSourceCongress ? (
                      <span
                        className="text-[10px] uppercase tracking-wide rounded border border-violet-700/50 px-1 text-violet-300/90"
                        title="Ticker in latest synced Congress disclosures"
                      >
                        Cong
                      </span>
                    ) : null}
                  </div>
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
  /** LLM money-flow narrative from consensus digest (Ollama or OpenRouter per server env). */
  const [moneyFlowNarrative, setMoneyFlowNarrative] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ready'; text: string; skipped?: boolean }
    | { status: 'no_llm' }
    | { status: 'error'; message: string }
  >({ status: 'idle' })
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  /** Tab: consensus tickers · experts×tickers matrix · full leaderboard + Congress tables. */
  const [expertsMainTab, setExpertsMainTab] = useState<'consensus' | 'matrix' | 'experts'>('consensus')
  /** Which consensus bucket is visible (strong multi-buy, single-buy, sells, mixed). */
  const [consensusSubTab, setConsensusSubTab] = useState<
    'strongBuys' | 'singleBuys' | 'sells' | 'mixed'
  >('strongBuys')
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

  /** Refresh AI when summary data changes; do not require latestRun (avoids stuck idle if run metadata is missing). */
  const summaryFingerprint =
    data?.ok && (data.popular ?? []).length > 0
      ? `${data.latestRun?.finished_at ?? ''}|${data.latestRun?.id ?? ''}|${(data.popular ?? []).length}`
      : ''

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

  useEffect(() => {
    if (popular.length === 0 && expertsMainTab === 'matrix') {
      setExpertsMainTab('consensus')
    }
  }, [popular.length, expertsMainTab])

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
        topK: CONSENSUS_TOP_K_CAP,
        minVotes: 1,
        weightByPerformance: WEIGHT_VOTES_BY_PERFORMANCE,
        crossSourceByTicker: data?.crossSourceTickers,
      }),
    [popular, weights, data?.crossSourceTickers]
  )

  const { buyLeaning, sellLeaning: sellLeaningSplit, mixed: mixedSplit } = useMemo(
    () => splitConsensusByNet(consensusRows),
    [consensusRows]
  )

  /** True multi-expert overlap (what most people mean by “consensus”). Rows ≥ $20M buy+sell reported USD. */
  const buyMultiExpert = useMemo(
    () => filterConsensusRowsByMinTotalUsd(buyLeaning.filter((r) => r.buyVotes >= 2)),
    [buyLeaning]
  )
  /** Net buy but only one of the selected experts is adding — informative, noisy if listed alone. */
  const buySingleExpert = useMemo(
    () => filterConsensusRowsByMinTotalUsd(buyLeaning.filter((r) => r.buyVotes === 1)),
    [buyLeaning]
  )

  const sellLeaning = useMemo(
    () => filterConsensusRowsByMinTotalUsd(sellLeaningSplit),
    [sellLeaningSplit]
  )

  const mixed = useMemo(() => filterConsensusRowsByMinTotalUsd(mixedSplit), [mixedSplit])

  /** Rows for the nested consensus sub-tab (each group is mutually exclusive). */
  const consensusSubTabRows = useMemo(() => {
    switch (consensusSubTab) {
      case 'strongBuys':
        return buyMultiExpert
      case 'singleBuys':
        return buySingleExpert
      case 'sells':
        return sellLeaning
      case 'mixed':
        return mixed
      default: {
        const _x: never = consensusSubTab
        return _x
      }
    }
  }, [consensusSubTab, buyMultiExpert, buySingleExpert, sellLeaning, mixed])

  const expertsInDataset = expertRows.length
  const effectiveTopK = Math.min(CONSENSUS_TOP_K_CAP, Math.max(1, expertsInDataset))

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
        CONSENSUS_TOP_K_CAP,
        blendedSort.key ?? 'pipeline',
        blendedSort.dir
      ),
    [blendedLeaderboard, expertRows, blendedSort]
  )

  /** Quiver-backed congress metrics when sync has run; else curated static list. */
  const congressDisplayRows = useMemo(() => {
    const qm = data?.quiverCongress?.members
    if (qm && qm.length > 0) {
      const sorted = [...qm].sort((a, b) => {
        const pa = a.perf1yPct
        const pb = b.perf1yPct
        if (pa == null && pb == null) return a.fullName.localeCompare(b.fullName)
        if (pa == null) return 1
        if (pb == null) return -1
        return pb - pa
      })
      return sorted.map((m, i) => ({
        kind: 'quiver' as const,
        rank: i + 1,
        name: m.fullName,
        perf1y: m.perf1yPct,
        perf3y: m.perf3yPct,
        perf5y: m.perf5yPct,
        perf10y: m.perf10yPct,
        trades: m.recentTrades ?? [],
      }))
    }
    return CONGRESS_TRADES_LEADERBOARD.map((r) => ({
      kind: 'static' as const,
      rank: r.rank,
      name: r.name,
      perf1yLabel: r.perf1y,
      trades: [] as const,
    }))
  }, [data?.quiverCongress?.members])

  function findWeight(slug: string, ticker: string): ExpertWeight | null {
    const list = weightsForTicker(ticker)
    return list.find((w) => w.investorSlug === slug) ?? null
  }

  const syncFreshness = syncFreshnessLabel(data?.latestRun?.finished_at ?? null)

  return (
    <div className="w-full max-w-none px-1 sm:px-0">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <div className="flex flex-wrap items-baseline gap-2 min-w-0">
          <h1 className="text-2xl font-semibold text-slate-100">Expert consensus</h1>
          {data?.latestRun?.finished_at && syncFreshness.label !== 'Unknown' ? (
            <span
              className={`shrink-0 text-xs font-medium rounded border px-2 py-0.5 tabular-nums ${
                syncFreshness.label === 'Fresh'
                  ? 'border-emerald-700/60 text-emerald-300/95 bg-emerald-950/40'
                  : syncFreshness.label === 'Stale'
                    ? 'border-amber-700/60 text-amber-300/95 bg-amber-950/30'
                    : 'border-slate-600/60 text-slate-400 bg-slate-900/50'
              }`}
              title={
                syncFreshness.days != null
                  ? `Guru data age: ~${syncFreshness.days.toFixed(0)} days since last sync finished`
                  : 'Sync recency'
              }
            >
              {syncFreshness.label}
            </span>
          ) : null}
        </div>
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
            {popular.length > 0 && (
              <button
                type="button"
                role="tab"
                id="experts-tab-matrix"
                aria-selected={expertsMainTab === 'matrix'}
                aria-controls="experts-panel-matrix"
                tabIndex={expertsMainTab === 'matrix' ? 0 : -1}
                onClick={() => setExpertsMainTab('matrix')}
                className={`rounded-t-md px-4 py-2.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/80 ${
                  expertsMainTab === 'matrix'
                    ? 'border border-b-0 border-slate-700 bg-slate-900/90 text-slate-100'
                    : 'border border-transparent text-slate-500 hover:text-slate-300'
                }`}
              >
                Overlap matrix
              </button>
            )}
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
                      Set <code className="text-slate-400">OLLAMA_API_KEY</code> or{' '}
                      <code className="text-slate-400">OPENROUTER_API_KEY</code> (see server defaults for model).
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

            {consensusRows.length > 0 && (
              <section className="mb-6" aria-labelledby="consensus-groups-heading">
                <h2 id="consensus-groups-heading" className="sr-only">
                  Consensus by group
                </h2>
                <div
                  role="tablist"
                  aria-label="Consensus ticker groups"
                  className="flex flex-wrap gap-1 border-b border-slate-800/90 mb-3"
                >
                  <button
                    type="button"
                    role="tab"
                    id="consensus-subtab-strongBuys"
                    aria-selected={consensusSubTab === 'strongBuys'}
                    aria-controls="consensus-subtab-panel"
                    tabIndex={consensusSubTab === 'strongBuys' ? 0 : -1}
                    onClick={() => setConsensusSubTab('strongBuys')}
                    className={`rounded-t-md px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/80 ${
                      consensusSubTab === 'strongBuys'
                        ? 'border border-b-0 border-slate-700 bg-slate-900/90 text-emerald-200/95'
                        : 'border border-transparent text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    Strong buys (2+){' '}
                    <span className="tabular-nums text-slate-500">({buyMultiExpert.length})</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    id="consensus-subtab-singleBuys"
                    aria-selected={consensusSubTab === 'singleBuys'}
                    aria-controls="consensus-subtab-panel"
                    tabIndex={consensusSubTab === 'singleBuys' ? 0 : -1}
                    onClick={() => setConsensusSubTab('singleBuys')}
                    className={`rounded-t-md px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/80 ${
                      consensusSubTab === 'singleBuys'
                        ? 'border border-b-0 border-slate-700 bg-slate-900/90 text-emerald-300/85'
                        : 'border border-transparent text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    Single-expert buys{' '}
                    <span className="tabular-nums text-slate-500">({buySingleExpert.length})</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    id="consensus-subtab-sells"
                    aria-selected={consensusSubTab === 'sells'}
                    aria-controls="consensus-subtab-panel"
                    tabIndex={consensusSubTab === 'sells' ? 0 : -1}
                    onClick={() => setConsensusSubTab('sells')}
                    className={`rounded-t-md px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/80 ${
                      consensusSubTab === 'sells'
                        ? 'border border-b-0 border-slate-700 bg-slate-900/90 text-rose-200/95'
                        : 'border border-transparent text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    Sells / trims{' '}
                    <span className="tabular-nums text-slate-500">({sellLeaning.length})</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    id="consensus-subtab-mixed"
                    aria-selected={consensusSubTab === 'mixed'}
                    aria-controls="consensus-subtab-panel"
                    tabIndex={consensusSubTab === 'mixed' ? 0 : -1}
                    onClick={() => setConsensusSubTab('mixed')}
                    className={`rounded-t-md px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/80 ${
                      consensusSubTab === 'mixed'
                        ? 'border border-b-0 border-slate-700 bg-slate-900/90 text-slate-200'
                        : 'border border-transparent text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    Split / tied{' '}
                    <span className="tabular-nums text-slate-500">({mixed.length})</span>
                  </button>
                </div>

                <div
                  role="tabpanel"
                  id="consensus-subtab-panel"
                  aria-labelledby={`consensus-subtab-${consensusSubTab}`}
                  className="min-h-[12rem]"
                >
                  {consensusSubTab === 'strongBuys' && (
                    <>
                      <h3 className="text-lg font-semibold text-emerald-200/95 mb-2">
                        Strong consensus buys (2+ experts)
                      </h3>
                      <p className="text-xs text-slate-500 mb-3">
                        At least two of the up-to-{effectiveTopK} ranked experts show an add or new position; sells/trims
                        on the same ticker count against that. Table lists names with ≥ $20M total reported position
                        (buy + sell).
                      </p>
                    </>
                  )}
                  {consensusSubTab === 'singleBuys' && (
                    <>
                      <h3 className="text-base font-semibold text-emerald-300/85 mb-2">
                        Other net buys (single expert among top ranks)
                      </h3>
                      <p className="text-xs text-slate-500 mb-3">
                        Net positive among ranked experts, but only one expert has an add/increase on this symbol —
                        useful for ideas, not multi-manager overlap. Same $20M position filter as other groups.
                      </p>
                    </>
                  )}
                  {consensusSubTab === 'sells' && (
                    <>
                      <h3 className="text-lg font-semibold text-rose-200/95 mb-2">
                        Consensus sells / trims (net lean sell)
                      </h3>
                      <p className="text-xs text-slate-500 mb-3">
                        More sell than buy votes from the panel on this ticker. ≥ $20M total reported position (buy +
                        sell).
                      </p>
                    </>
                  )}
                  {consensusSubTab === 'mixed' && (
                    <>
                      <h3 className="text-base font-semibold text-slate-300 mb-2">
                        Split / tied (net 0 among selected experts)
                      </h3>
                      <p className="text-xs text-slate-500 mb-3">
                        Same number of buy and sell votes from the up-to-{effectiveTopK} ranked experts on this ticker.
                        ≥ $20M total reported position (buy + sell).
                      </p>
                    </>
                  )}

                  {consensusSubTabRows.length > 0 ? (
                    <ConsensusTable
                      key={consensusSubTab}
                      rows={consensusSubTabRows}
                      weightVotesByPerformance={WEIGHT_VOTES_BY_PERFORMANCE}
                    />
                  ) : (
                    <p className="text-sm text-slate-500 py-4" role="status">
                      No tickers in this group for the current sync (or none meet the minimum position size).
                    </p>
                  )}
                </div>
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

          {popular.length > 0 && (
            <div
              role="tabpanel"
              id="experts-panel-matrix"
              aria-labelledby="experts-tab-matrix"
              hidden={expertsMainTab !== 'matrix'}
              className={expertsMainTab === 'matrix' ? 'pt-4' : ''}
            >
              <section className="mb-6" aria-labelledby="overlap-matrix-heading">
                <h2 id="overlap-matrix-heading" className="text-lg font-semibold text-slate-100 mb-1">
                  Experts × tickers
                </h2>
                <p className="text-xs text-slate-500 mb-4">
                  Advanced grid: each row is an expert, each column a ticker (first {MATRIX_MAX_TICKERS} by “firms buying”
                  — the full ticker set powers the Consensus overlap tab). Cells show % of portfolio and estimated $ on
                  adds (green) or trims/sells (red) — not audited.
                </p>

                {data?.ok && data.latestRun != null && (data.latestRun.investors_fetched ?? 0) < 25 && (
                  <div
                    className="mb-4 rounded border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-100/95"
                    role="note"
                  >
                    <p className="font-medium text-amber-200/95">Why “Firms buying” is often 1</p>
                    <p className="mt-1 text-amber-100/85">
                      That column counts experts in the last sync with a <strong>new</strong> or{' '}
                      <strong>increased</strong> position — not total purchases.
                    </p>
                    <p className="mt-2 text-amber-100/85">
                      Your last run loaded <strong>{data.latestRun.investors_fetched ?? '—'}</strong> guru portfolio(s).
                      For more overlap on the same ticker, run a <strong>full</strong> unified sync or raise{' '}
                      <code className="text-amber-200">STOCKCIRCLE_MAX_INVESTORS</code>.
                    </p>
                  </div>
                )}

                {expertRows.length === 0 ? (
                  <p className="text-slate-500 text-sm py-2">No expert rows — matrix is empty for this dataset.</p>
                ) : (
                  <div className="overflow-x-auto max-h-[min(85vh,1200px)] overflow-y-auto rounded-lg border border-slate-800">
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
                                1Y {fmtStockcirclePct(ex.performance1yPct)} · 3Y {fmtStockcirclePct(ex.performance3yPct)}{' '}
                                · 5Y {fmtStockcirclePct(ex.performance5yPct)} · 10Y{' '}
                                {fmtStockcirclePct(ex.performance10yPct)}
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
              </section>
            </div>
          )}

          <div
            role="tabpanel"
            id="experts-panel-experts"
            aria-labelledby="experts-tab-all"
            hidden={expertsMainTab !== 'experts'}
            className={expertsMainTab === 'experts' ? 'pt-4' : ''}
          >
          <>
            {blendedLeaderboard.length > 0 ? (
              <section className="mb-2" aria-labelledby="blended-leaderboard-heading">
                <h2 id="blended-leaderboard-heading" className="text-lg font-semibold text-slate-100 mb-2">
                  All tracked experts &amp; filers
                </h2>
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
                        const inPanel = guruRank >= 0 && guruRank < CONSENSUS_TOP_K_CAP
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

            <section className="mb-2 mt-8" aria-labelledby="congress-trades-leaderboard-heading">
              <h2 id="congress-trades-leaderboard-heading" className="text-lg font-semibold text-slate-100 mb-2">
                Congress Trades
              </h2>
              {data?.quiverCongress?.members && data.quiverCongress.members.length > 0 ? (
                <p className="text-xs text-slate-500 mb-2">
                  From Quiver Quant strategy pages (estimated horizons vs SPY baseline). Last sync:{' '}
                  {data.quiverCongress.finishedAt
                    ? new Date(data.quiverCongress.finishedAt).toLocaleString()
                    : '—'}
                  . Recent filings: last {90} days. Set <code className="text-slate-400">QUIVER_SYNC=1</code> on
                  experts sync to refresh.
                </p>
              ) : null}
              <div className="overflow-x-auto rounded-lg border border-slate-800">
                <table className="min-w-[56rem] w-full text-left text-[14px] text-slate-300">
                  <thead className="bg-slate-900/90 text-slate-400 text-[14px] uppercase tracking-wide">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">
                        #
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Name
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Source
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium text-right">
                        1Y
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium text-right">
                        3Y
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium text-right">
                        5Y
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium text-right">
                        10Y
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Overlap vote
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {congressDisplayRows.map((row) => (
                      <tr
                        key={row.kind === 'quiver' ? `q-${row.name}-${row.rank}` : `s-${row.rank}`}
                        className="border-t border-slate-800/80 hover:bg-slate-800/25"
                      >
                        <td className="px-3 py-2 tabular-nums text-slate-500">{row.rank}</td>
                        <td className="px-3 py-2 text-slate-200 font-medium align-top">
                          <div>{abbreviateExpertFirmDisplayName(row.name)}</div>
                          {row.kind === 'quiver' && row.trades.length > 0 && (
                            <details className="mt-1.5 text-xs text-slate-500">
                              <summary className="cursor-pointer text-sky-500/90 hover:text-sky-400">
                                Recent trades (90d): {row.trades.length}
                              </summary>
                              <ul className="mt-1.5 max-h-40 overflow-y-auto list-disc pl-4 text-slate-400 space-y-0.5">
                                {row.trades.slice(0, 20).map((t, j) => (
                                  <li key={`${t.symbol ?? 'x'}-${t.transaction_date ?? j}-${j}`}>
                                    {t.transaction_date?.slice(0, 10) ?? '—'} · {t.symbol ?? '—'} ·{' '}
                                    {t.transaction_type ?? '—'}
                                    {t.amount_range ? ` · ${t.amount_range}` : ''}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-400 align-top">Congress Trades</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-200 align-top">
                          {row.kind === 'quiver' ? fmtStockcirclePct(row.perf1y) : row.perf1yLabel}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-200 align-top">
                          {row.kind === 'quiver' ? fmtStockcirclePct(row.perf3y) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-200 align-top">
                          {row.kind === 'quiver' ? fmtStockcirclePct(row.perf5y) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-200 align-top">
                          {row.kind === 'quiver' ? fmtStockcirclePct(row.perf10y) : '—'}
                        </td>
                        <td className="px-3 py-2 text-slate-600 align-top">—</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
          </div>
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

    </div>
  )
}
