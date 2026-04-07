import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import TickerSearch from './TickerSearch'
import DeployUpdateControl from './DeployUpdateControl'
import { API_BASE } from '../utils/api'

const LazyMinerviniChat = lazy(() => import('./MinerviniChat'))

interface LayoutProps {
  children: React.ReactNode
}

type YahooFetchBanner =
  | { state: 'loading' }
  | { state: 'ok'; at: string; formatted: string }
  | { state: 'error'; message: string }

export default function Layout({ children }: LayoutProps) {
  const location = useLocation()
  const [chatReady, setChatReady] = useState(false)
  const [yahooFetch, setYahooFetch] = useState<YahooFetchBanner>({ state: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/bars-cache/last-yahoo-at`, { cache: 'no-store' })
        const data = (await res.json()) as {
          ok?: boolean
          lastFetchedAt?: string | null
          error?: string
        }
        if (cancelled) return
        if (data?.ok && data.lastFetchedAt) {
          const d = new Date(data.lastFetchedAt)
          const formatted = Number.isNaN(d.getTime())
            ? data.lastFetchedAt
            : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
          setYahooFetch({ state: 'ok', at: data.lastFetchedAt, formatted })
        } else {
          setYahooFetch({
            state: 'error',
            message: data?.error || 'Could not load last Yahoo fetch time.',
          })
        }
      } catch {
        if (!cancelled) {
          setYahooFetch({ state: 'error', message: 'Network error loading last Yahoo fetch time.' })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number
      cancelIdleCallback?: (handle: number) => void
    }

    if (typeof idleWindow.requestIdleCallback === 'function') {
      const idleId = idleWindow.requestIdleCallback(() => setChatReady(true), { timeout: 1500 })
      return () => {
        if (typeof idleWindow.cancelIdleCallback === 'function') {
          idleWindow.cancelIdleCallback(idleId)
        }
      }
    }

    const timeoutId = window.setTimeout(() => setChatReady(true), 500)
    return () => window.clearTimeout(timeoutId)
  }, [])

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-900/80 backdrop-blur">
        <div className="w-[90%] max-w-full mx-auto px-4 py-4 flex items-center justify-between">
          <div className="min-w-0 shrink">
            <Link to="/" className="text-xl font-semibold text-sky-400 hover:text-sky-300">
              VCP Screener
            </Link>
            {/* 10pt ≈ text-xs — last time daily bars were written to DB from Yahoo (any ticker / cron / scan) */}
            <p
              className={`text-xs mt-1 leading-tight truncate max-w-[min(100vw-8rem,28rem)] ${
                yahooFetch.state === 'error' ? 'text-amber-500/95' : 'text-slate-500'
              }`}
              title={yahooFetch.state === 'ok' ? yahooFetch.at : yahooFetch.state === 'error' ? yahooFetch.message : ''}
            >
              {yahooFetch.state === 'loading' && 'Last fetch from Yahoo: …'}
              {yahooFetch.state === 'ok' && <>Last fetch from Yahoo: {yahooFetch.formatted}</>}
              {yahooFetch.state === 'error' && <>Last fetch from Yahoo: {yahooFetch.message}</>}
            </p>
          </div>
          <div className="flex items-center gap-6">
          <TickerSearch />
          <DeployUpdateControl />
          <nav className="flex items-center gap-6">
            <Link
              to="/industry"
              className={`text-sm ${location.pathname === '/industry' ? 'text-sky-400' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Industry
            </Link>
            <Link
              to="/tradingagents"
              className={`text-sm ${location.pathname === '/tradingagents' ? 'text-sky-400' : 'text-slate-400 hover:text-slate-200'}`}
            >
              TradingAgents
            </Link>
            <Link
              to="/ai-portfolio"
              className={`text-sm ${location.pathname === '/ai-portfolio' ? 'text-sky-400' : 'text-slate-400 hover:text-slate-200'}`}
            >
              AI Portfolio
            </Link>
            <Link
              to="/experts"
              className={`text-sm ${
                location.pathname === '/experts' || location.pathname.startsWith('/experts/')
                  ? 'text-sky-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Experts
            </Link>
          </nav>
          </div>
        </div>
      </header>
      <main className="w-[90%] max-w-full mx-auto px-4 py-8 overflow-x-scroll">{children}</main>
      {/* Chat widget lives outside the main content flow so it overlays everything */}
      {chatReady ? (
        <Suspense fallback={null}>
          <LazyMinerviniChat />
        </Suspense>
      ) : null}
    </div>
  )
}
