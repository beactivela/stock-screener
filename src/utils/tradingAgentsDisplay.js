/**
 * Human-readable labels and parsing for TradingAgents SSE + decision payloads.
 * Keeps UI logic testable without React.
 */

/** @typedef {'muted'|'info'|'heartbeat'|'success'|'error'} StreamTone */

/**
 * Short local time from an ISO-ish string (falls back to empty).
 * @param {string | undefined} at
 */
export function formatEventTime(at) {
  if (!at || typeof at !== 'string') return ''
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/**
 * One row in the Stream panel.
 * @param {Record<string, unknown>} ev
 * @returns {{ tone: StreamTone, headline: string, body: string, sub?: string, time: string }}
 */
export function streamEventToRow(ev) {
  if (!ev || typeof ev !== 'object') {
    return {
      tone: 'muted',
      headline: 'Event',
      body: 'Received something we could not parse.',
      time: '',
    }
  }

  const time = formatEventTime(typeof ev.at === 'string' ? ev.at : undefined)
  const type = ev.type

  if (type === 'start') {
    const ticker = ev.ticker != null ? String(ev.ticker) : '—'
    const asOf = ev.asOf != null ? String(ev.asOf) : '—'
    const prov = ev.provider != null ? String(ev.provider) : '—'
    const runId = ev.runId != null ? String(ev.runId) : ''
    const analystLine =
      Array.isArray(ev.analysts) && ev.analysts.length > 0
        ? `Analysts: ${ev.analysts.map((a) => String(a)).join(', ')}`
        : ''
    const body = [(`${ticker} · as of ${asOf} · ${prov}`), analystLine].filter(Boolean).join('\n')
    return {
      tone: 'info',
      headline: 'Run started',
      body,
      sub: runId ? `Run ID ${runId}` : undefined,
      time,
    }
  }

  if (type === 'progress') {
    const phase = ev.phase != null ? String(ev.phase) : 'update'
    const isHeartbeat = phase === 'heartbeat'
    const headline = isHeartbeat ? 'Heartbeat' : humanizePhase(phase)
    const message = ev.message != null ? String(ev.message) : ''
    return {
      tone: isHeartbeat ? 'heartbeat' : 'info',
      headline,
      body: message || '(no message)',
      time,
    }
  }

  if (type === 'result') {
    return {
      tone: 'success',
      headline: 'Finished',
      body: 'Decision is ready — see the Decision panel.',
      time,
    }
  }

  if (type === 'error') {
    const message = ev.message != null ? String(ev.message) : 'Unknown error'
    return {
      tone: 'error',
      headline: 'Error',
      body: message,
      time,
    }
  }

  return {
    tone: 'muted',
    headline: String(type ?? 'event'),
    body: '',
    time,
  }
}

/**
 * Prefer the first sentence so heartbeat / long progress copy reads as one line in the UI.
 * @param {string} text
 */
export function firstDisplaySentence(text) {
  if (!text || typeof text !== 'string') return ''
  const t = text.trim()
  if (!t) return ''
  const m = t.match(/^.{1,400}?[.!?](?=\s|$)/)
  if (m) return m[0].trim()
  return t.length > 200 ? `${t.slice(0, 197)}…` : t
}

/**
 * Single status line for the Stream panel (show latest only; one sentence).
 * @param {Record<string, unknown>} ev
 * @returns {string}
 */
export function streamEventToThinkingLine(ev) {
  if (!ev || typeof ev !== 'object') return ''
  const type = ev.type

  if (type === 'start') {
    const ticker = ev.ticker != null ? String(ev.ticker).trim() : ''
    return ticker ? `Starting analysis for ${ticker}.` : 'Starting analysis.'
  }

  if (type === 'result') {
    return 'Finished — decision is ready.'
  }

  if (type === 'error') {
    const message = ev.message != null ? String(ev.message) : 'Unknown error'
    return firstDisplaySentence(message.split('\n')[0] || message) || 'Something went wrong.'
  }

  if (type === 'progress') {
    const row = streamEventToRow(ev)
    const fromMessage = ev.message != null ? String(ev.message) : ''
    const base = fromMessage.trim() || row.headline || '(no message)'
    return firstDisplaySentence(base)
  }

  return firstDisplaySentence(streamEventToRow(ev).body)
}

/**
 * @param {string} phase
 */
function humanizePhase(phase) {
  const s = phase.replace(/_/g, ' ').trim()
  if (!s) return 'Progress'
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Decision state keys in display order (matches scripts/tradingagents/run.py _summarize_state). */
export const DECISION_SECTION_DEFS = [
  { key: 'market_report', label: 'Market' },
  { key: 'sentiment_report', label: 'Sentiment' },
  { key: 'news_report', label: 'News' },
  { key: 'fundamentals_report', label: 'Fundamentals' },
  { key: 'investment_plan', label: 'Investment plan' },
  { key: 'trader_investment_plan', label: 'Trader plan' },
  { key: 'final_trade_decision', label: 'Final trade decision' },
]

/**
 * @param {unknown} decision
 * @returns {{
 *   rating: string | null,
 *   company: string | null,
 *   tradeDate: string | null,
 *   sections: { key: string, label: string, text: string }[]
 * }}
 */
export function parseTradingAgentsDecision(decision) {
  if (!decision || typeof decision !== 'object') {
    return { rating: null, company: null, tradeDate: null, sections: [] }
  }

  const d = /** @type {Record<string, unknown>} */ (decision)
  const rating = d.rating != null && String(d.rating).trim() !== '' ? String(d.rating).trim() : null

  const state = d.state && typeof d.state === 'object' ? /** @type {Record<string, unknown>} */ (d.state) : {}

  const company = state.company_of_interest != null ? String(state.company_of_interest) : null
  const tradeDate = state.trade_date != null ? String(state.trade_date) : null

  /** @type {{ key: string, label: string, text: string }[]} */
  const sections = []
  for (const { key, label } of DECISION_SECTION_DEFS) {
    const raw = state[key]
    if (raw == null) continue
    const text = String(raw).trim()
    if (text === '') continue
    sections.push({ key, label, text })
  }

  return { rating, company, tradeDate, sections }
}

/**
 * Tailwind-friendly token for rating badge colors.
 * @param {string | null} rating
 * @returns {'buy'|'sell'|'hold'|'neutral'}
 */
export function ratingVisualToken(rating) {
  if (!rating) return 'neutral'
  const u = rating.toUpperCase()
  if (u.includes('BUY')) return 'buy'
  if (u.includes('SELL')) return 'sell'
  if (u.includes('HOLD') || u.includes('WAIT')) return 'hold'
  return 'neutral'
}
