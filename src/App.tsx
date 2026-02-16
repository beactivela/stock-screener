import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import ErrorBoundary from './components/ErrorBoundary'
import { ScanProvider } from './contexts/ScanContext'

// Lazy-load heavy pages (StockDetail uses lightweight-charts ~100KB; Backtest/Industry have extra logic)
// Dashboard stays eager since it's the landing page
const Dashboard = lazy(() => import('./pages/Dashboard'))
const StockDetail = lazy(() => import('./pages/StockDetail'))
const Industry = lazy(() => import('./pages/Industry'))
const Backtest = lazy(() => import('./pages/Backtest'))

function PageFallback() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="text-slate-400">Loading…</div>
    </div>
  )
}

export default function App() {
  return (
    <ScanProvider>
      <BrowserRouter>
        <Layout>
          <ErrorBoundary>
            <Suspense fallback={<PageFallback />}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/industry" element={<Industry />} />
                <Route path="/backtest" element={<Backtest />} />
                <Route path="/stock/:ticker" element={<StockDetail />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </Layout>
      </BrowserRouter>
    </ScanProvider>
  )
}
