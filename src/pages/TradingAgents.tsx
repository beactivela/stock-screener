/**
 * TradingAgents — run the vendored TauricResearch TradingAgents graph from the browser (server-side).
 */

import { useCallback, useMemo, useState } from 'react'
import { API_BASE } from '../utils/api'

const PROVIDERS = ['openai', 'anthropic', 'google', 'xai', 'openrouter', 'ollama'] as const
const MAX_LOG = 500

type StreamStatus = 'idle' | 'running' | 'done' | 'error'

type SseEvent =
  | { type: 'start'; runId?: string; ticker?: string; asOf?: string; provider?: string; at?: string }
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

export default function TradingAgents() {
  const [ticker, setTicker] = useState('NVDA')
  const [asOf, setAsOf] = useState(todayIsoDate)
  const [provider, setProvider] = useState<(typeof PROVIDERS)[number]>('openai')
  const [status, setStatus] = useState<StreamStatus>('idle')
  const [logs, setLogs] = useState<SseEvent[]>([])
  const [decision, setDecision] = useState<unknown>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const decisionJson = useMemo(() => {
    if (decision == null) return ''
    try {
      return JSON.stringify(decision, null, 2)
    } catch {
      return String(decision)
    }
  }, [decision])

  const pushLog = useCallback((ev: SseEvent) => {
    setLogs((prev) => {
      const next = [...prev, ev]
      return next.length > MAX_LOG ? next.slice(-MAX_LOG) : next
    })
  }, [])

  const run = useCallback(async () => {
    setStatus('running')
    setErrorMessage(null)
    setDecision(null)
    setLogs([])

    let res: Response
    try {
      res = await fetch(`${API_BASE}/api/tradingagents/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({ ticker, asOf, provider }),
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
    let buf = ''
    let sawResult = false
    let sawError = false

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          let ev: SseEvent
          try {
            ev = JSON.parse(line.slice(5).trim()) as SseEvent
          } catch {
            continue
          }
          pushLog(ev)
          if (ev.type === 'result' && ev.decision !== undefined) {
            sawResult = true
            setDecision(ev.decision)
            setStatus('done')
          }
          if (ev.type === 'error' && ev.message) {
            sawError = true
            setErrorMessage(ev.message)
            setStatus('error')
          }
        }
      }
      if (!sawError && !sawResult) {
        setStatus('idle')
      }
    } catch (e) {
      setStatus('error')
      setErrorMessage(e instanceof Error ? e.message : String(e))
    }
  }, [asOf, provider, pushLog, ticker])

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
        <p className="text-sm text-slate-500 mt-1">
          Runs the vendored multi-agent graph on the server (keys stay server-side). Requires{' '}
          <code className="text-sky-400/90">npm run install:tradingagents</code> and provider API keys in{' '}
          <code className="text-sky-400/90">.env</code>.
        </p>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-5 space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
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

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4 min-h-[240px] flex flex-col">
          <h2 className="text-sm font-semibold text-slate-300 mb-2">Stream</h2>
          <div className="flex-1 overflow-y-auto max-h-[420px] rounded-lg bg-slate-950/60 border border-slate-700/80 p-3 font-mono text-[11px] text-slate-400 space-y-1">
            {logs.length === 0 && <p className="text-slate-600">Events appear here…</p>}
            {logs.map((ev, i) => (
              <div key={`${i}-${ev.type}`} className="break-words">
                <span className="text-slate-600">{ev.type}</span>{' '}
                {JSON.stringify(ev).slice(0, 400)}
                {JSON.stringify(ev).length > 400 ? '…' : ''}
              </div>
            ))}
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
          <pre className="flex-1 overflow-y-auto max-h-[420px] rounded-lg bg-slate-950/60 border border-slate-700/80 p-3 text-xs text-slate-300 whitespace-pre-wrap">
            {decisionJson || '—'}
          </pre>
        </div>
      </div>
    </div>
  )
}
