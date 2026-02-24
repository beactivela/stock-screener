/**
 * Minervini AI coach — embedded chat widget, Google Gemini style.
 *
 * Layout:
 *   • FAB (floating action button) fixed at bottom-right
 *   • Clicking FAB slides a chat panel in from the right edge
 *   • Panel header has an X to close; clicking the FAB again also closes
 *   • No nav integration — fully self-contained, always on screen
 */

import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import { API_BASE } from '../utils/api'
import { CONVERSATION_TABS, normalizeTab, getTabLabel } from '../utils/conversationTabs.js'
import { buildAgentThread } from '../utils/agentConversationThread.js'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const WELCOME =
  "I'm Mark Minervini — SEPA and CANSLIM, period. Ask me about any stock or setup and I'll run through the checklist. Tell me what passes, what fails, and whether to wait for a better entry."

export default function MinerviniChat() {
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'coach' | 'agents'>('coach')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const agentInputRef = useRef<HTMLButtonElement>(null)
  const [conversationStatus, setConversationStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [conversationError, setConversationError] = useState<string | null>(null)
  const [conversationResult, setConversationResult] = useState<any>(null)

  useEffect(() => {
    if (!open) return
    // Small delay so the panel finishes sliding before we focus
    setTimeout(() => {
      if (activeTab === 'agents') agentInputRef.current?.focus()
      else inputRef.current?.focus()
    }, 310)
  }, [open, activeTab])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const send = async () => {
    const text = input.trim()
    if (!text || loading) return

    const userMsg: ChatMessage = { role: 'user', content: text }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)
    setError(null)

    try {
      const history = [...messages, userMsg].map((m) => ({ role: m.role, content: m.content }))
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || res.statusText)
        setMessages((prev) => prev.slice(0, -1))
        return
      }

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.message?.content ?? 'No response.' },
      ])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.')
      setMessages((prev) => prev.slice(0, -1))
    } finally {
      setLoading(false)
    }
  }

  const runConversation = async () => {
    if (conversationStatus === 'running') return
    setConversationStatus('running')
    setConversationError(null)
    setConversationResult(null)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)

    try {
      const res = await fetch(`${API_BASE}/api/agents/conversation/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data?.error || res.statusText)
      }
      setConversationResult(data)
      setConversationStatus('done')
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setConversationError('Conversation timed out after 30s. Try again.')
      } else {
        setConversationError(e instanceof Error ? e.message : 'Conversation failed.')
      }
      setConversationStatus('error')
    } finally {
      clearTimeout(timeout)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const displayMessages =
    messages.length === 0
      ? [{ role: 'assistant' as const, content: WELCOME }]
      : messages

  return (
    <>
      {/* ── Backdrop ─────────────────────────────────────────────────── */}
      <div
        aria-hidden
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-40 bg-black/25 transition-opacity duration-300 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      {/* ── Side panel ───────────────────────────────────────────────── */}
      <div
        role="dialog"
        aria-label="Conversation panel"
        aria-modal="true"
        {...(!open && { 'aria-hidden': 'true' })}
        className={`fixed top-0 right-0 z-50 flex h-screen w-[400px] max-w-[100vw] flex-col
          bg-slate-900 border-l border-slate-700/80
          shadow-[-8px_0_32px_rgba(0,0,0,0.5)]
          transition-transform duration-300 ease-in-out
          ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Panel header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-700/80 bg-slate-800/60 px-4 py-3">
          <div className="flex items-center gap-2.5">
            {/* Minervini avatar spark */}
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-500/20 text-sky-400">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5z" />
              </svg>
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-100">{getTabLabel(activeTab)}</p>
              <p className="text-xs text-slate-500">SEPA · CANSLIM · VCP</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {CONVERSATION_TABS.map((tab) => {
              const t = normalizeTab(tab)
              const active = activeTab === t
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(t)}
                  className={`text-[11px] px-2 py-1 rounded-md border transition-colors ${
                    active
                      ? 'bg-slate-700 text-slate-100 border-slate-500'
                      : 'bg-slate-800/40 text-slate-400 border-slate-700 hover:text-slate-200'
                  }`}
                >
                  {t === 'agents' ? 'Agents' : 'Coach'}
                </button>
              )
            })}
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-700 hover:text-slate-100 transition-colors"
            aria-label="Close coach"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Messages / Conversation body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {activeTab === 'coach' && (
            <>
              {displayMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'assistant' && (
                    <span className="mr-2 mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-sky-400">
                      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2L9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5z" />
                      </svg>
                    </span>
                  )}
                  <div
                    className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'rounded-tr-sm bg-sky-600 text-white'
                        : 'rounded-tl-sm bg-slate-700/80 text-slate-200'
                    }`}
                  >
                    {msg.role === 'user' ? (
                      <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                    ) : (
                      <div className="minervini-markdown [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-0.5 [&_hr]:my-2 [&_hr]:border-slate-500 [&_strong]:font-semibold [&_strong]:text-slate-100 [&_em]:italic [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_h1]:font-bold [&_h2]:font-bold [&_h3]:font-bold">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <span className="mr-2 mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-sky-400">
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2L9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5z" />
                    </svg>
                  </span>
                  <div className="rounded-2xl rounded-tl-sm bg-slate-700/80 px-4 py-2.5">
                    <span className="flex gap-1">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:0ms]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:150ms]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:300ms]" />
                    </span>
                  </div>
                </div>
              )}

              {error && (
                <div className="rounded-xl border border-amber-600/40 bg-amber-900/20 px-3 py-2 text-xs text-amber-300">
                  {error}
                </div>
              )}

              <div ref={messagesEndRef} />
            </>
          )}

          {activeTab === 'agents' && (
            <>
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3 space-y-3">
                <div className="text-xs text-slate-400 leading-relaxed">
                  Signal agents ask each other questions to improve expectancy. Marcus moderates
                  and keeps the Northstar goal in focus.
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    ref={agentInputRef}
                    type="button"
                    onClick={runConversation}
                    disabled={conversationStatus === 'running'}
                    className="text-xs px-3 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white"
                  >
                    {conversationStatus === 'running' ? 'Running…' : 'Run agent conversation'}
                  </button>
                  <span className="text-xs text-slate-500">
                    {conversationStatus === 'done' ? 'Done' : conversationStatus === 'error' ? 'Error' : 'Idle'}
                  </span>
                </div>

                {conversationError && (
                  <div className="rounded-lg border border-red-800 bg-red-950/30 px-4 py-3 text-red-300 text-sm">
                    {conversationError}
                  </div>
                )}

                {conversationResult?.transcript && (
                  <div className="space-y-3">
                    {buildAgentThread(conversationResult.transcript).map((msg) => (
                      <div key={msg.id} className={`flex items-start gap-3 ${msg.depth ? 'ml-8' : ''}`}>
                        <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-slate-200 text-sm">
                          {msg.avatar}
                        </div>
                        <div className="flex-1 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
                          <div className="flex items-center justify-between">
                            <div className="text-xs text-slate-200 font-medium">
                              {msg.agentName}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              {msg.title}
                            </div>
                          </div>
                          <div className="mt-1 whitespace-pre-wrap text-xs text-slate-300">
                            {msg.body}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Input row — only for Coach */}
        {activeTab === 'coach' && (
          <div className="shrink-0 border-t border-slate-700/80 bg-slate-800/60 p-3">
            <div className="flex items-end gap-2 rounded-xl border border-slate-600/60 bg-slate-800 px-3 py-2 focus-within:border-sky-500/50 focus-within:ring-1 focus-within:ring-sky-500/20">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about a stock, SEPA, or CANSLIM…"
                rows={1}
                disabled={loading}
                className="min-h-[24px] max-h-[120px] min-w-0 flex-1 resize-none overflow-y-auto bg-transparent text-sm text-slate-100 placeholder-slate-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={send}
                disabled={loading || !input.trim()}
                aria-label="Send message"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-600 text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <svg className="h-4 w-4 rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              </button>
            </div>
            <p className="mt-1.5 text-center text-[10px] text-slate-600">
              Enter to send · Shift+Enter for newline
            </p>
          </div>
        )}
      </div>

      {/* ── FAB (floating action button) ─────────────────────────────── */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close Minervini coach' : 'Open Minervini coach'}
        className={`fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full
          bg-sky-600 text-white shadow-[0_4px_20px_rgba(14,165,233,0.5)]
          transition-all duration-300 hover:bg-sky-500 hover:shadow-[0_4px_24px_rgba(14,165,233,0.7)]
          focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400
          ${open ? 'pointer-events-none scale-0 opacity-0' : 'scale-100 opacity-100'}`}
      >
        <svg className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5z" />
        </svg>
      </button>
    </>
  )
}
