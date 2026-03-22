import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import TickerSearch from './TickerSearch'
import DeployUpdateControl from './DeployUpdateControl'

const LazyMinerviniChat = lazy(() => import('./MinerviniChat'))

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const location = useLocation()
  const [chatReady, setChatReady] = useState(false)

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
          <Link to="/" className="text-xl font-semibold text-sky-400 hover:text-sky-300">
            VCP Screener
          </Link>
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
              to="/regime"
              className={`text-sm ${location.pathname === '/regime' ? 'text-sky-400' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Regime
            </Link>
            <Link
              to="/agents"
              className={`text-sm ${location.pathname === '/agents' ? 'text-sky-400' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Agents
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
