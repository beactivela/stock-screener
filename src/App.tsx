import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import ErrorBoundary from './components/ErrorBoundary'
import Dashboard from './pages/Dashboard'
import StockDetail from './pages/StockDetail'
import Industry from './pages/Industry'
import Backtest from './pages/Backtest'
import { ScanProvider } from './contexts/ScanContext'

export default function App() {
  return (
    <ScanProvider>
      <BrowserRouter>
        <Layout>
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/industry" element={<Industry />} />
              <Route path="/backtest" element={<Backtest />} />
              <Route path="/stock/:ticker" element={<StockDetail />} />
            </Routes>
          </ErrorBoundary>
        </Layout>
      </BrowserRouter>
    </ScanProvider>
  )
}
