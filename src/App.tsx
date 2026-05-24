import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useParams, useSearchParams } from 'react-router-dom'
import Layout from './components/Layout'
import ErrorBoundary from './components/ErrorBoundary'
import { ScanProvider } from './contexts/ScanContext'

// Lazy-load heavy pages (StockDetail uses lightweight-charts ~100KB; Industry has extra logic)
// Dashboard stays eager since it's the landing page
const Dashboard = lazy(() => import('./pages/Dashboard'))
const StockDetail = lazy(() => import('./pages/StockDetail'))
const Industry = lazy(() => import('./pages/Industry'))
const IndustryTickers = lazy(() => import('./pages/IndustryTickers'))
const Agents = lazy(() => import('./pages/Agents'))
const Style = lazy(() => import('./pages/Style'))
const MarketIndexDetail = lazy(() => import('./pages/MarketIndexDetail'))
const StockcircleExperts = lazy(() => import('./pages/StockcircleExperts'))
const StockcircleExpertDetail = lazy(() => import('./pages/StockcircleExpertDetail'))
const WhalewisdomFilerDetail = lazy(() => import('./pages/WhalewisdomFilerDetail'))

function PageFallback() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="text-slate-400">Loading…</div>
    </div>
  )
}

/** Preserve query string when redirecting legacy /stock2 links to /stock. */
function Stock2Redirect() {
  const { ticker } = useParams<{ ticker: string }>()
  const [searchParams] = useSearchParams()
  const qs = searchParams.toString()
  return <Navigate to={`/stock/${ticker}${qs ? `?${qs}` : ''}`} replace />
}

export default function App() {
  return (
    <ScanProvider>
      <BrowserRouter>
        <ErrorBoundary>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route element={<Layout />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/industry" element={<Industry />} />
                <Route path="/industry-tickers/:industryName" element={<IndustryTickers />} />
                <Route path="/agents" element={<Agents />} />
                <Route path="/stock/:ticker" element={<StockDetail />} />
                <Route path="/market-index/:ticker" element={<MarketIndexDetail />} />
                <Route path="/style" element={<Style />} />
                <Route path="/experts" element={<StockcircleExperts />} />
                <Route path="/experts/:slug" element={<StockcircleExpertDetail />} />
                <Route path="/whalewisdom-filers/:slug" element={<WhalewisdomFilerDetail />} />
              </Route>
              <Route path="/stock2/:ticker" element={<Stock2Redirect />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </BrowserRouter>
    </ScanProvider>
  )
}
