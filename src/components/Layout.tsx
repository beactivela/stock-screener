import { Link, useLocation } from 'react-router-dom'
import MinerviniChat from './MinerviniChat'

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const location = useLocation()
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur">
        <div className="max-w-[2400px] mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="text-xl font-semibold text-sky-400 hover:text-sky-300">
            VCP Screener
          </Link>
          <nav className="flex items-center gap-6">
            <Link
              to="/"
              className={`text-sm ${location.pathname === '/' ? 'text-sky-400' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Dashboard
            </Link>
            <Link
              to="/industry"
              className={`text-sm ${location.pathname === '/industry' ? 'text-sky-400' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Industry
            </Link>
            <Link
              to="/backtest"
              className={`text-sm ${location.pathname === '/backtest' ? 'text-sky-400' : 'text-slate-400 hover:text-slate-200'}`}
            >
              Learning
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
      </header>
      <main className="flex-1 max-w-[2400px] w-full mx-auto px-4 py-8">{children}</main>
      {/* Chat widget lives outside the main content flow so it overlays everything */}
      <MinerviniChat />
    </div>
  )
}
