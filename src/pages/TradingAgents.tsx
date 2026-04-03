/**
 * TradingAgents — run the vendored TauricResearch TradingAgents graph from the browser (server-side).
 */

import { useCallback, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { API_BASE } from '../utils/api'
import {
  appendHistoryEntry,
  createHistoryEntry,
  latestRowPerTicker,
  loadHistoryFromStorage,
  saveHistoryToStorage,
} from '../utils/tradingAgentsHistory.js'
import type { TradingAgentsHistoryEntry } from '../utils/tradingAgentsHistory.js'
import {
  parseTradingAgentsDecision,
  ratingVisualToken,
  streamEventToThinkingLine,
} from '../utils/tradingAgentsDisplay.js'
import { appendSseDataLines, flushSseDataLines } from '../utils/tradingAgentsSse.js'

const PROVIDERS = ['openai', 'anthropic', 'google', 'xai', 'openrouter', 'ollama'] as const
/** Full = 4 analysts (slowest); Fast = market + fundamentals only (~2× fewer analyst steps). */
const PROFILE_OPTIONS = ['full', 'fast'] as const
type StreamStatus = 'idle' | 'running' | 'done' | 'error'

type SseEvent =
  | {
      type: 'start'
      runId?: string
      ticker?: string
      asOf?: string
      provider?: string
      analysts?: string[]
      at?: string
    }
  | { type: 'progress'; phase?: string; message?: string; at?: string }
  | { type: 'result'; decision?: unknown; at?: string }
  | { type: 'error'; message?: string; at?: string }

function todayIsoDate() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Match Decision panel badge colors for the history table. */
function ratingPillClass(rating: string | null) {
  const t = ratingVisualToken(rating)
  if (t === 'buy') return 'border-emerald-500/50 bg-emerald-950/50 text-emerald-200'
  if (t === 'sell') return 'border-red-500/40 bg-red-950/45 text-red-200'
  if (t === 'hold') return 'border-amber-500/40 bg-amber-950/40 text-amber-100'
  return 'border-slate-600 bg-slate-900/80 text-slate-300'
}

export default function TradingAgents() {
  const [ticker, setTicker] = useState('NVDA')
  const [asOf, setAsOf] = useState(todayIsoDate)
  const [provider, setProvider] = useState<(typeof PROVIDERS)[number]>('openai')
  const [profile, setProfile] = useState<(typeof PROFILE_OPTIONS)[number]>('full')
  const [status, setStatus] = useState<StreamStatus>('idle')
  /** Single-line “what it’s doing now” from the SSE stream (latest event only). */
  const [thinkingLine, setThinkingLine] = useState('')
  const [decision, setDecision] = useState<unknown>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  /** Newest-first full list of completed runs (localStorage). */
  const [history, setHistory] = useState<TradingAgentsHistoryEntry[]>(() => loadHistoryFromStorage())
  /** Which saved row’s analysis is shown in the Decision panel (or latest run id after completion). */
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null)

  /** One row per ticker — most recent run; sorted A–Z for scanning. */
  const historyTableRows = useMemo(() => {
    const rows = latestRowPerTicker(history) as TradingAgentsHistoryEntry[]
    return [...rows].sort((a, b) => a.ticker.localeCompare(b.ticker))
  }, [history])

  const decisionJson = useMemo(() => {
    if (decision == null) return ''
    try {
      return JSON.stringify(decision, null, 2)
    } catch {
      return String(decision)
    }
  }, [decision])

  const decisionView = useMemo(() => parseTradingAgentsDecision(decision), [decision])

  const ratingToneClass = useMemo(() => {
    const t = ratingVisualToken(decisionView.rating)
    if (t === 'buy') return 'border-emerald-500/60 bg-emerald-950/40 text-emerald-200'
    if (t === 'sell') return 'border-red-500/50 bg-red-950/40 text-red-200'
    if (t === 'hold') return 'border-amber-500/50 bg-amber-950/35 text-amber-100'
    return 'border-slate-600 bg-slate-900/80 text-slate-200'
  }, [decisionView.rating])

  const run = useCallback(async () => {
    setStatus('running')
    setErrorMessage(null)
    setDecision(null)
    setThinkingLine('')
    setSelectedHistoryId(null)

    let res: Response
    try {
      res = await fetch(`${API_BASE}/api/tradingagents/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({ ticker, asOf, provider, profile }),
      })
    } catch (e) {
      setStatus('error')
      setErrorMessage(e instanceof Error ? e.message : String(e))
      return
    }

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { error?: string }
      setStatus('error')
      setErrorMessage(errBody.error || `HTTP ${res.status}`)
      return
    }

    if (!res.body) {
      setStatus('error')
      setErrorMessage('No response body')
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let lineBuf = ''
    let sawResult = false
    let sawError = false

    const runTicker = ticker
    const runAsOf = asOf
    const runProvider = provider
    const runProfile = profile

    const applyEvents = (rawEvents: unknown[]) => {
      for (const raw of rawEvents) {
        if (raw == null || typeof raw !== 'object' || !('type' in raw)) continue
        const ev = raw as SseEvent
        const line = streamEventToThinkingLine(ev as Record<string, unknown>)
        if (line) setThinkingLine(line)
        if (ev.type === 'result' && ev.decision !== undefined) {
          sawResult = true
          setDecision(ev.decision)
          setStatus('done')
          const entry = createHistoryEntry({
            ticker: runTicker,
            asOf: runAsOf,
            provider: runProvider,
            profile: runProfile,
            decision: ev.decision,
          })
          setHistory((prev) => {
            const next = appendHistoryEntry(prev, entry)
            saveHistoryToStorage(next)
            return next
          })
          setSelectedHistoryId(entry.id)
        }
        if (ev.type === 'error' && ev.message) {
          sawError = true
          setErrorMessage(ev.message)
          setStatus('error')
        }
      }
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        const chunk = decoder.decode(value ?? new Uint8Array(), { stream: !done })
        const { nextBuffer, events } = appendSseDataLines(lineBuf, chunk)
        lineBuf = nextBuffer
        applyEvents(events)
        if (done) break
      }
      applyEvents(flushSseDataLines(lineBuf))
      if (!sawError && !sawResult) {
        setStatus('error')
        setThinkingLine('Stream ended before a result was received.')
        setErrorMessage('Stream ended before a result or error was received.')
      }
    } catch (e) {
      setStatus('error')
      setErrorMessage(e instanceof Error ? e.message : String(e))
    }
  }, [asOf, profile, provider, ticker])

  const openHistoryEntry = useCallback((row: TradingAgentsHistoryEntry) => {
    setDecision(row.decision)
    setSelectedHistoryId(row.id)
    setTicker(row.ticker)
    if (row.asOf) setAsOf(row.asOf)
    setErrorMessage(null)
    setStatus('done')
    setThinkingLine(`Saved run from ${new Date(row.savedAt).toLocaleString()}.`)
  }, [])

  const copyDecision = useCallback(async () => {
    if (!decisionJson) return
    try {
      await navigator.clipboard.writeText(decisionJson)
    } catch {
      /* ignore */
    }
  }, [decisionJson])

  const busy = status === 'running'

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-100">TradingAgents</h1>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-5 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block space-y-1">
            <span className="text-[11px] uppercase tracking-wide text-slate-500">Ticker</span>
            <input
              className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              disabled={busy}
              autoComplete="off"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] uppercase tracking-wide text-slate-500">As of</span>
            <input
              type="date"
              className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] uppercase tracking-wide text-slate-500">Provider</span>
            <select
              className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
              value={provider}
              onChange={(e) => setProvider(e.target.value as (typeof PROVIDERS)[number])}
              disabled={busy}
            >
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] uppercase tracking-wide text-slate-500">Analyst profile</span>
            <select
              className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
              value={profile}
              onChange={(e) => setProfile(e.target.value as (typeof PROFILE_OPTIONS)[number])}
              disabled={busy}
              title="Full runs all four analyst pipelines (sequential or parallel per server env). Fast skips social + news."
            >
              <option value="full">Full — market, social, news, fundamentals</option>
              <option value="fast">Fast — market + fundamentals only</option>
            </select>
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy}
            className="text-sm px-4 py-2 rounded-lg border border-sky-600 bg-sky-900/30 text-sky-300 hover:bg-sky-800/40 hover:border-sky-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {busy ? 'Running…' : 'Run TradingAgents'}
          </button>
          <span className="text-xs text-slate-500">
            Status:{' '}
            <span
              className={
                status === 'error'
                  ? 'text-red-400'
                  : status === 'done'
                    ? 'text-emerald-400'
                    : status === 'running'
                      ? 'text-sky-400'
                      : 'text-slate-400'
              }
            >
              {status}
            </span>
          </span>
        </div>

        {errorMessage && (
          <div className="rounded-lg border border-red-800/80 bg-red-950/30 px-3 py-2 text-sm text-red-300 whitespace-pre-wrap">
            {errorMessage}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-5 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-300">Saved by ticker</h2>
          <p className="text-xs text-slate-500 max-w-xl">
            Each finished run is stored in this browser. Latest decision per symbol; click a row to load the full
            analysis in the Decision panel.
          </p>
        </div>
        {historyTableRows.length === 0 ? (
          <p className="text-sm text-slate-500">No saved runs yet — complete a run to populate this table.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-700/80">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-900/50 text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">Ticker</th>
                  <th className="px-3 py-2 font-medium">Latest decision</th>
                  <th className="px-3 py-2 font-medium hidden sm:table-cell">As of</th>
                  <th className="px-3 py-2 font-medium hidden md:table-cell">Saved</th>
                </tr>
              </thead>
              <tbody>
                {historyTableRows.map((row) => {
                  const parsed = parseTradingAgentsDecision(row.decision)
                  const r = parsed.rating ?? '—'
                  const selected = selectedHistoryId === row.id
                  return (
                    <tr
                      key={row.id}
                      tabIndex={0}
                      role="button"
                      onClick={() => openHistoryEntry(row)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          openHistoryEntry(row)
                        }
                      }}
                      className={`cursor-pointer border-b border-slate-700/60 last:border-b-0 transition-colors ${
                        selected ? 'bg-sky-950/35' : 'hover:bg-slate-900/70'
                      }`}
                    >
                      <td className="px-3 py-2 font-mono font-medium text-slate-100">{row.ticker}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${ratingPillClass(parsed.rating)}`}
                        >
                          {r}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-400 hidden sm:table-cell">
                        {row.asOf || '—'}
                      </td>
                      <td className="px-3 py-2 text-slate-500 text-xs hidden md:table-cell">
                        {row.savedAt ? new Date(row.savedAt).toLocaleString() : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4 min-h-[240px] flex flex-col">
          <h2 className="text-sm font-semibold text-slate-300 mb-2">Stream</h2>
          <div className="flex-1 flex items-center rounded-lg bg-slate-950/60 border border-slate-700/80 px-3 py-4 min-h-[120px]">
            <p
              className={`text-sm leading-snug ${
                status === 'error'
                  ? 'text-red-300'
                  : status === 'done'
                    ? 'text-emerald-300/90'
                    : 'text-slate-400'
              }`}
            >
              {thinkingLine || (busy ? 'Connecting…' : 'Run to see live status.')}
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4 min-h-[240px] flex flex-col">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h2 className="text-sm font-semibold text-slate-300">Decision</h2>
            <button
              type="button"
              onClick={() => void copyDecision()}
              disabled={!decisionJson}
              className="text-xs px-2 py-1 rounded border border-slate-600 text-slate-400 hover:text-slate-200 disabled:opacity-40"
            >
              Copy JSON
            </button>
          </div>
          <div className="flex-1 overflow-y-auto max-h-[420px] rounded-lg bg-slate-950/60 border border-slate-700/80 p-3 space-y-4">
            {!decisionJson && <p className="text-sm text-slate-600">Run completes here…</p>}
            {decisionJson && (
              <>
                <div
                  className={`flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 ${ratingToneClass}`}
                >
                  <span className="text-[11px] uppercase tracking-wide text-slate-400/90">Rating</span>
                  <span className="text-2xl font-semibold tracking-tight">
                    {decisionView.rating ?? '—'}
                  </span>
                </div>
                {(decisionView.company || decisionView.tradeDate) && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-400">
                    {decisionView.company ? (
                      <span>
                        <span className="text-slate-600">Symbol </span>
                        {decisionView.company}
                      </span>
                    ) : null}
                    {decisionView.tradeDate ? (
                      <span>
                        <span className="text-slate-600">As of </span>
                        {decisionView.tradeDate}
                      </span>
                    ) : null}
                  </div>
                )}
                {decisionView.sections.length === 0 && (
                  <p className="text-sm text-slate-500">No report sections returned (empty state).</p>
                )}
                {decisionView.sections.map((sec) => (
                  <section key={sec.key} className="border-t border-slate-700/80 pt-4 first:border-t-0 first:pt-0">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-sky-400/90 mb-2">
                      {sec.label}
                    </h3>
                    <div
                      className="ta-decision-md max-w-none text-sm leading-relaxed text-slate-300 [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_h1]:font-bold [&_h2]:font-bold [&_h3]:font-bold [&_strong]:font-semibold [&_strong]:text-slate-100 [&_code]:text-sky-300/90 [&_pre]:bg-slate-900 [&_pre]:p-2 [&_pre]:rounded-md [&_hr]:my-3 [&_hr]:border-slate-600"
                    >
                      <ReactMarkdown>{sec.text}</ReactMarkdown>
                    </div>
                  </section>
                ))}
                <details className="group border border-slate-700/60 rounded-lg bg-slate-900/50">
                  <summary className="cursor-pointer list-none px-3 py-2 text-[11px] text-slate-500 hover:text-slate-400 [&::-webkit-details-marker]:hidden flex items-center gap-2">
                    <span className="text-slate-600">▸</span>
                    <span className="group-open:hidden">Show raw JSON</span>
                    <span className="hidden group-open:inline">Hide raw JSON</span>
                  </summary>
                  <pre className="px-3 pb-3 text-[11px] text-slate-500 whitespace-pre-wrap font-mono overflow-x-auto border-t border-slate-700/50 pt-2">
                    {decisionJson}
                  </pre>
                </details>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
