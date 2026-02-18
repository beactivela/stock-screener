import { useEffect, useState } from 'react'
import { API_BASE } from '../utils/api'

/**
 * Backtest Page
 * 
 * This page allows users to validate their scoring system by running backtests
 * on historical scan results. It checks if high-scoring stocks actually 
 * outperformed over time.
 * 
 * Two modes:
 * 1. PROSPECTIVE: Select a past scan date, measure forward returns
 * 2. RETROSPECTIVE: Look back in time to find historical signals and measure returns
 */

export default function Backtest() {
  // Mode selection: 'prospective' or 'retrospective'
  const [mode, setMode] = useState<'prospective' | 'retrospective'>('retrospective')
  
  // State for available scan snapshots (prospective mode)
  const [backtestSnapshots, setBacktestSnapshots] = useState<Array<{
    date: string
    filename: string
    tickerCount: number
  }>>([])
  
  // Configuration state (prospective mode)
  const [selectedSnapshotDate, setSelectedSnapshotDate] = useState<string | null>(null)
  const [backtestDays, setBacktestDays] = useState<number>(30)
  const [portfolioSize, setPortfolioSize] = useState<number | null>(null) // null = all stocks
  
  // Configuration state (retrospective mode)
  const [retroLookbackMonths, setRetroLookbackMonths] = useState<number>(12)
  const [retroHoldingPeriod, setRetroHoldingPeriod] = useState<number>(60)
  const [retroTopN, setRetroTopN] = useState<number>(100)
  
  // Execution state
  const [backtestRunning, setBacktestRunning] = useState(false)
  const [backtestResult, setBacktestResult] = useState<any>(null)
  const [showBacktestModal, setShowBacktestModal] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  
  // Retrospective results (different structure)
  const [retroResult, setRetroResult] = useState<any>(null)
  const [showRetroModal, setShowRetroModal] = useState(false)

  // Fetch available backtest snapshots on mount
  // These are saved scan results from previous runs
  useEffect(() => {
    fetch(`${API_BASE}/api/backtest/snapshots`)
      .then((r) => r.json())
      .then((d) => {
        setBacktestSnapshots(d.snapshots || [])
        // Auto-select most recent snapshot for convenience
        if (d.snapshots && d.snapshots.length > 0) {
          setSelectedSnapshotDate(d.snapshots[0].date)
        }
      })
      .catch(() => {})
  }, [])

  /**
   * Run backtest analysis
   * 
   * Sends selected snapshot and forward days to API
   * API will:
   * 1. Load the historical scan results
   * 2. Fetch price data from scan date + forward days
   * 3. Calculate returns for each ticker
   * 4. Group by score buckets and compute statistics
   */
  const runBacktestAnalysis = async () => {
    if (!selectedSnapshotDate) {
      setErrorMessage('Please select a scan date to backtest')
      return
    }
    
    setBacktestRunning(true)
    setBacktestResult(null)
    setErrorMessage(null)
    
    try {
      const res = await fetch(`${API_BASE}/api/backtest/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scanDate: selectedSnapshotDate,
          daysForward: backtestDays,
          topN: portfolioSize // null = all stocks, or specific number to filter
        })
      })
      
      const result = await res.json()
      
      // Handle "not enough time elapsed" error
      if (result.error === 'not_enough_time') {
        setErrorMessage(
          `Not enough time has elapsed since the scan.\n\n` +
          `Days elapsed: ${result.daysElapsed} days\n` +
          `Days needed: ${result.daysNeeded} days\n\n` +
          `Please select an older scan date or reduce the forward days.`
        )
        return
      }
      
      if (!res.ok) {
        setErrorMessage(`Backtest failed: ${result.error || res.statusText}`)
        return
      }
      
      setBacktestResult(result)
      setShowBacktestModal(true)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Backtest failed')
    } finally {
      setBacktestRunning(false)
    }
  }

  /**
   * Run RETROSPECTIVE backtest
   * Looks back in time to find when signals would have triggered
   */
  const runRetroBacktest = async () => {
    setBacktestRunning(true)
    setRetroResult(null)
    setErrorMessage(null)
    
    try {
      const res = await fetch(`${API_BASE}/api/backtest/retro`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lookbackMonths: retroLookbackMonths,
          holdingPeriod: retroHoldingPeriod,
          topN: retroTopN
        })
      })
      
      const result = await res.json()
      
      if (!res.ok) {
        setErrorMessage(`Retrospective backtest failed: ${result.error || res.statusText}`)
        return
      }
      
      setRetroResult(result)
      setShowRetroModal(true)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Retrospective backtest failed')
    } finally {
      setBacktestRunning(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-100">🧪 Backtest Configuration</h1>
        <p className="text-slate-400 mt-1">
          Validate your scoring system by checking if high-scoring stocks actually outperformed over time.
        </p>
      </div>

      {/* Mode Tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setMode('retrospective')}
          className={`px-6 py-2 rounded-lg font-medium transition-colors ${
            mode === 'retrospective'
              ? 'bg-purple-600 text-white'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
          }`}
        >
          🔄 Retrospective
        </button>
        <button
          onClick={() => setMode('prospective')}
          className={`px-6 py-2 rounded-lg font-medium transition-colors ${
            mode === 'prospective'
              ? 'bg-purple-600 text-white'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
          }`}
        >
          📅 Prospective
        </button>
      </div>

      {/* RETROSPECTIVE MODE */}
      {mode === 'retrospective' && (
        <div className="rounded-xl border border-purple-800/50 bg-purple-900/10 p-6">
          <div className="flex items-start gap-3 mb-4">
            <div className="text-2xl">🔄</div>
            <div>
              <h2 className="text-lg font-medium text-purple-300">Retrospective Backtesting</h2>
              <p className="text-sm text-slate-400">
                Look back in time to find when buy signals WOULD have triggered, then measure actual returns.
                No waiting required - test any historical period immediately.
              </p>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            {/* Lookback Period */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Lookback Period
              </label>
              <select
                value={retroLookbackMonths}
                onChange={(e) => setRetroLookbackMonths(Number(e.target.value))}
                className="w-full px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
                aria-label="Select lookback period"
              >
                <option value="6">6 months</option>
                <option value="12">12 months</option>
                <option value="18">18 months</option>
                <option value="24">24 months</option>
              </select>
              <p className="text-xs text-slate-500 mt-1">
                How far back to scan for signals
              </p>
            </div>

            {/* Holding Period */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Max Holding Period
              </label>
              <select
                value={retroHoldingPeriod}
                onChange={(e) => setRetroHoldingPeriod(Number(e.target.value))}
                className="w-full px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
                aria-label="Select max holding period"
              >
                <option value="30">30 days</option>
                <option value="60">60 days</option>
                <option value="90">90 days</option>
                <option value="120">120 days</option>
              </select>
              <p className="text-xs text-slate-500 mt-1">
                Max days to hold each trade
              </p>
            </div>

            {/* Number of Tickers */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Tickers to Analyze
              </label>
              <select
                value={retroTopN}
                onChange={(e) => setRetroTopN(Number(e.target.value))}
                className="w-full px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
                aria-label="Select number of tickers to analyze"
              >
                <option value="25">Top 25</option>
                <option value="50">Top 50</option>
                <option value="100">Top 100</option>
                <option value="200">Top 200</option>
              </select>
              <p className="text-xs text-slate-500 mt-1">
                Number of tickers to backtest
              </p>
            </div>
          </div>

          {/* Error Message */}
          {errorMessage && mode === 'retrospective' && (
            <div className="mb-6 p-4 rounded-lg bg-red-900/20 border border-red-800/50">
              <div className="flex items-start gap-3">
                <div className="text-2xl text-red-400">⚠️</div>
                <div>
                  <div className="font-medium text-red-400 mb-1">Error</div>
                  <div className="text-sm text-slate-300 whitespace-pre-line">{errorMessage}</div>
                </div>
              </div>
            </div>
          )}

          {/* Run Button */}
          <button
            onClick={runRetroBacktest}
            disabled={backtestRunning}
            className="w-full px-6 py-3 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-colors"
          >
            {backtestRunning ? 'Running retrospective backtest...' : 'Run Retrospective Backtest'}
          </button>
          
          <p className="text-xs text-slate-500 mt-3 text-center">
            ⏱️ This may take 1-3 minutes depending on the number of tickers and lookback period
          </p>
        </div>
      )}

      {/* PROSPECTIVE MODE - Configuration Card */}
      {mode === 'prospective' && (
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
        <h2 className="text-lg font-medium text-slate-200 mb-4">Prospective Configuration</h2>
        
        {backtestSnapshots.length === 0 ? (
          <div className="text-slate-400 text-sm">
            No scan snapshots available. Run a scan first to generate backtest data.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              {/* Scan Date Selection */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Select Scan Date
                </label>
                <select
                  value={selectedSnapshotDate || ''}
                  onChange={(e) => setSelectedSnapshotDate(e.target.value)}
                  className="w-full px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  aria-label="Select scan date for backtest"
                >
                  {backtestSnapshots.map((snapshot) => (
                    <option key={snapshot.date} value={snapshot.date}>
                      {snapshot.date} ({snapshot.tickerCount} tickers)
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500 mt-1">
                  Historical scan result to analyze
                </p>
              </div>

              {/* Forward Days Selection */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Forward Days
                </label>
                <select
                  value={backtestDays}
                  onChange={(e) => setBacktestDays(Number(e.target.value))}
                  className="w-full px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  aria-label="Select forward days for backtest"
                >
                  <option value="30">30 days</option>
                  <option value="60">60 days</option>
                  <option value="90">90 days</option>
                  <option value="180">180 days</option>
                </select>
                <p className="text-xs text-slate-500 mt-1">
                  How far forward to measure returns
                </p>
              </div>

              {/* Portfolio Size Filter */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Portfolio Size
                </label>
                <select
                  value={portfolioSize === null ? 'all' : portfolioSize}
                  onChange={(e) => setPortfolioSize(e.target.value === 'all' ? null : Number(e.target.value))}
                  className="w-full px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  aria-label="Select portfolio size for backtest"
                >
                  <option value="all">All Stocks</option>
                  <option value="10">Top 10</option>
                  <option value="50">Top 50</option>
                  <option value="100">Top 100</option>
                  <option value="200">Top 200</option>
                </select>
                <p className="text-xs text-slate-500 mt-1">
                  Test top N stocks by score
                </p>
              </div>
            </div>

            {/* Time Elapsed Check */}
            {selectedSnapshotDate && (
              <div className="mb-6 p-4 rounded-lg bg-slate-800/50">
                {(() => {
                  const scanDate = new Date(selectedSnapshotDate);
                  const today = new Date();
                  const daysElapsed = Math.floor((today.getTime() - scanDate.getTime()) / (1000 * 60 * 60 * 24));
                  const canRun = daysElapsed >= backtestDays;
                  
                  return (
                    <div className="flex items-start gap-3">
                      <div className={`text-2xl ${canRun ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {canRun ? '✅' : '⏳'}
                      </div>
                      <div>
                        <div className={`font-medium ${canRun ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {canRun 
                            ? `Ready to backtest (${daysElapsed} days elapsed)`
                            : `Need ${backtestDays - daysElapsed} more days before backtest can run`
                          }
                        </div>
                        <div className="text-sm text-slate-400 mt-1">
                          {canRun 
                            ? 'Sufficient time has passed to measure forward returns'
                            : 'Not enough time has elapsed since scan date. Try selecting an older scan or reduce the forward days.'
                          }
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Error Message */}
            {errorMessage && (
              <div className="mb-6 p-4 rounded-lg bg-red-900/20 border border-red-800/50">
                <div className="flex items-start gap-3">
                  <div className="text-2xl text-red-400">⚠️</div>
                  <div>
                    <div className="font-medium text-red-400 mb-1">Backtest Error</div>
                    <div className="text-sm text-slate-300 whitespace-pre-line">{errorMessage}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Run Button */}
            <button
              onClick={runBacktestAnalysis}
              disabled={backtestRunning || !selectedSnapshotDate}
              className="w-full px-6 py-3 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-colors"
            >
              {backtestRunning ? 'Running backtest...' : 'Run Backtest'}
            </button>
          </>
        )}
      </div>
      )}

      {/* Info Card - How it works */}
      <div className="rounded-xl border border-sky-800/50 bg-sky-900/10 p-6">
        <h3 className="text-lg font-medium text-sky-400 mb-3">How the 10 MA Exit Strategy Works</h3>
        <div className="space-y-2 text-sm text-slate-300">
          <p>
            <strong>1. Entry Signal:</strong> After the scan date, wait for the first buy signal (price at/near 10 MA)
          </p>
          <p>
            <strong>2. Exit Rules:</strong> Close position when:
          </p>
          <ul className="ml-6 space-y-1">
            <li>• Price closes below 10 MA (trend weakening)</li>
            <li>• -8% stop loss hit (risk management)</li>
            <li>• Max hold time reached (e.g., 30, 60, 90 days)</li>
          </ul>
          <p>
            <strong>3. Portfolio Filtering:</strong> Test how top-scoring stocks perform vs all stocks
          </p>
          <ul className="ml-6 space-y-1">
            <li>• "All Stocks" = Test every stock from the scan</li>
            <li>• "Top N" = Only test N highest-scoring stocks (more selective)</li>
          </ul>
          <p>
            <strong>4. Performance Tracking:</strong> Measures actual returns using entry/exit signals, not fixed time periods
          </p>
          <p>
            <strong>5. Results Analysis:</strong> See win rates, average hold times, and exit reasons grouped by score buckets
          </p>
        </div>
      </div>

      {/* Backtest Results Modal */}
      {showBacktestModal && backtestResult && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" 
          onClick={() => setShowBacktestModal(false)}
        >
          <div 
            className="bg-slate-900 rounded-xl border border-slate-700 max-w-4xl w-full max-h-[90vh] overflow-auto" 
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="sticky top-0 bg-slate-900 border-b border-slate-700 px-6 py-4 flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-100">
                🧪 Backtest Results: {backtestResult.analysis.scanDate}
              </h2>
              <button 
                onClick={() => setShowBacktestModal(false)} 
                className="text-slate-400 hover:text-slate-200 text-2xl leading-none"
              >
                ✕
              </button>
            </div>
            
            {/* Modal Body */}
            <div className="p-6 space-y-6">
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                <div className="bg-slate-800/50 rounded-lg p-4">
                  <div className="text-slate-400 text-sm">Strategy</div>
                  <div className="text-lg font-bold text-purple-400">
                    {backtestResult.analysis.strategy === '10MA_EXIT' ? '10 MA Exit' : 'Fixed Time'}
                  </div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-4">
                  <div className="text-slate-400 text-sm">Portfolio Size</div>
                  <div className="text-lg font-bold text-sky-400">
                    {backtestResult.analysis.portfolioSize === 'ALL' 
                      ? 'All' 
                      : `Top ${backtestResult.analysis.portfolioSize}`}
                  </div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-4">
                  <div className="text-slate-400 text-sm">Max Hold Days</div>
                  <div className="text-2xl font-bold text-slate-100">
                    {backtestResult.analysis.daysForward}
                  </div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-4">
                  <div className="text-slate-400 text-sm">Trades Taken</div>
                  <div className="text-2xl font-bold text-slate-100">
                    {backtestResult.analysis.summary.totalTrades}
                  </div>
                  {backtestResult.analysis.summary.noSignalCount > 0 && (
                    <div className="text-xs text-slate-500 mt-1">
                      {backtestResult.analysis.summary.noSignalCount} no signal
                    </div>
                  )}
                </div>
                <div className="bg-slate-800/50 rounded-lg p-4">
                  <div className="text-slate-400 text-sm">Avg Hold Time</div>
                  <div className="text-2xl font-bold text-sky-400">
                    {backtestResult.analysis.summary.avgHoldTime}d
                  </div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-4">
                  <div className="text-slate-400 text-sm">Win Rate</div>
                  <div className="text-2xl font-bold text-emerald-400">
                    {backtestResult.analysis.summary.overallWinRate}%
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {backtestResult.analysis.summary.totalWins}W / {backtestResult.analysis.summary.totalLosses}L
                  </div>
                </div>
              </div>
              
              {/* Exit Reasons Breakdown */}
              {backtestResult.analysis.summary.exitReasons && (
                <div className="bg-slate-800/50 rounded-lg p-4">
                  <h3 className="text-sm font-medium text-slate-300 mb-2">Exit Reasons</h3>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-slate-400">Below 10 MA:</span>
                      <span className="ml-2 font-medium text-amber-400">
                        {backtestResult.analysis.summary.exitReasons.BELOW_10MA || 0}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400">Stop Loss:</span>
                      <span className="ml-2 font-medium text-red-400">
                        {backtestResult.analysis.summary.exitReasons.STOP_LOSS || 0}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400">Max Hold:</span>
                      <span className="ml-2 font-medium text-slate-400">
                        {backtestResult.analysis.summary.exitReasons.MAX_HOLD || 0}
                      </span>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Performance by Score Bucket */}
              <div>
                <h3 className="text-lg font-semibold text-slate-200 mb-3">
                  Performance by Score Range
                </h3>
                <div className="space-y-3">
                  {Object.entries(backtestResult.analysis.byScoreBucket)
                    .filter(([_, data]: [string, any]) => data.count > 0)
                    .map(([bucket, data]: [string, any]) => (
                      <div key={bucket} className="bg-slate-800/50 rounded-lg p-4">
                        {/* Bucket Header */}
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <div className="font-semibold text-slate-100">{bucket} Score</div>
                            <div className="text-sm text-slate-400">{data.count} trades</div>
                          </div>
                          <div className="text-right">
                            <div className={`text-xl font-bold ${
                              data.winRate >= 60 ? 'text-emerald-400' : 
                              data.winRate >= 40 ? 'text-amber-400' : 
                              'text-red-400'
                            }`}>
                              {data.winRate}% win rate
                            </div>
                            <div className="text-sm text-slate-400">
                              {data.winCount}W / {data.lossCount}L / {data.neutralCount}N
                            </div>
                          </div>
                        </div>
                        
                        {/* Performance Metrics */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm mt-3">
                          <div>
                            <span className="text-slate-400">Avg Return:</span>
                            <span className={`ml-2 font-medium ${
                              data.avgReturn >= 0 ? 'text-emerald-400' : 'text-red-400'
                            }`}>
                              {data.avgReturn >= 0 ? '+' : ''}{data.avgReturn}%
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400">Avg Win:</span>
                            <span className="ml-2 font-medium text-emerald-400">
                              +{data.avgWin}%
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400">Avg Loss:</span>
                            <span className="ml-2 font-medium text-red-400">
                              {data.avgLoss}%
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400">Expectancy:</span>
                            <span className={`ml-2 font-medium ${
                              data.expectancy >= 0 ? 'text-emerald-400' : 'text-red-400'
                            }`}>
                              {data.expectancy >= 0 ? '+' : ''}{data.expectancy}%
                            </span>
                          </div>
                        </div>
                        
                        {/* Max Favorable/Adverse Excursion */}
                        <div className="grid grid-cols-2 gap-2 text-sm mt-2">
                          <div>
                            <span className="text-slate-400">Max Gain (MFE):</span>
                            <span className="ml-2 text-emerald-400">+{data.avgMFE}%</span>
                          </div>
                          <div>
                            <span className="text-slate-400">Max Drawdown (MAE):</span>
                            <span className="ml-2 text-red-400">{data.avgMAE}%</span>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
              
              {/* Insights Section */}
              <div className="bg-sky-500/10 border border-sky-500/30 rounded-lg p-4">
                <h3 className="font-semibold text-sky-400 mb-2">💡 Key Insights</h3>
                <ul className="space-y-1 text-sm text-slate-300">
                  {(() => {
                    const buckets = backtestResult.analysis.byScoreBucket
                    const high = buckets['90-100'] || buckets['80-89']
                    const low = buckets['below-50'] || buckets['50-59']
                    
                    const insights = []
                    
                    // Insight: High score performance
                    if (high && high.count > 0) {
                      insights.push(
                        `• Stocks scoring 80+ have ${high.winRate}% win rate (${high.winCount} wins / ${high.count} trades)`
                      )
                      if (high.avgReturn > 10) {
                        insights.push(
                          `• High scores average +${high.avgReturn}% return - system is working!`
                        )
                      }
                    }
                    
                    // Insight: Score differentiation
                    if (low && low.count > 0 && high && high.winRate > low.winRate * 1.5) {
                      insights.push(
                        `• High scores outperform low scores by ${Math.round((high.winRate / low.winRate - 1) * 100)}% - score differentiation is effective`
                      )
                    }
                    
                    // Insight: Overall validation
                    if (backtestResult.analysis.summary.overallWinRate >= 50) {
                      insights.push(
                        `• Overall ${backtestResult.analysis.summary.overallWinRate}% win rate validates the scoring system`
                      )
                    } else if (backtestResult.analysis.summary.overallWinRate < 40) {
                      insights.push(
                        `• ⚠️ Overall win rate is ${backtestResult.analysis.summary.overallWinRate}% - consider adjusting scoring weights`
                      )
                    }
                    
                    if (insights.length === 0) {
                      insights.push('• Run more backtests as data accumulates to identify patterns')
                    }
                    
                    return insights.map((insight, i) => <li key={i}>{insight}</li>)
                  })()}
                </ul>
              </div>
              
              {/* Modal Footer */}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowBacktestModal(false)}
                  className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Retrospective Results Modal */}
      {showRetroModal && retroResult && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" 
          onClick={() => setShowRetroModal(false)}
        >
          <div 
            className="bg-slate-900 rounded-xl border border-purple-700 max-w-4xl w-full max-h-[90vh] overflow-auto" 
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="sticky top-0 bg-slate-900 border-b border-slate-700 px-6 py-4 flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-100">
                🔄 Retrospective Backtest Results
              </h2>
              <button 
                onClick={() => setShowRetroModal(false)} 
                className="text-slate-400 hover:text-slate-200 text-2xl leading-none"
              >
                ✕
              </button>
            </div>
            
            {/* Modal Body */}
            <div className="p-6 space-y-6">
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                <div className="bg-slate-800/50 rounded-lg p-4">
                  <div className="text-slate-400 text-sm">Lookback</div>
                  <div className="text-lg font-bold text-purple-400">
                    {retroResult.config.lookbackMonths} months
                  </div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-4">
                  <div className="text-slate-400 text-sm">Hold Period</div>
                  <div className="text-lg font-bold text-sky-400">
                    {retroResult.config.holdingPeriod}d max
                  </div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-4">
                  <div className="text-slate-400 text-sm">Signals Found</div>
                  <div className="text-2xl font-bold text-slate-100">
                    {retroResult.summary.totalSignals}
                  </div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-4">
                  <div className="text-slate-400 text-sm">Win Rate</div>
                  <div className={`text-2xl font-bold ${retroResult.summary.winRate >= 40 ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {retroResult.summary.winRate}%
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    {retroResult.summary.wins}W / {retroResult.summary.losses}L
                  </div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-4">
                  <div className="text-slate-400 text-sm">Avg Return</div>
                  <div className={`text-2xl font-bold ${retroResult.summary.avgReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {retroResult.summary.avgReturn >= 0 ? '+' : ''}{retroResult.summary.avgReturn}%
                  </div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-4">
                  <div className="text-slate-400 text-sm">Expectancy</div>
                  <div className={`text-2xl font-bold ${retroResult.summary.expectancy >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {retroResult.summary.expectancy >= 0 ? '+' : ''}{retroResult.summary.expectancy}%
                  </div>
                </div>
              </div>
              
              {/* Additional Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-slate-800/50 rounded-lg p-4">
                  <div className="text-slate-400 text-sm">Avg Hold Time</div>
                  <div className="text-lg font-bold text-slate-100">
                    {retroResult.summary.avgHoldTime} days
                  </div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-4">
                  <div className="text-slate-400 text-sm">Avg Win</div>
                  <div className="text-lg font-bold text-emerald-400">
                    +{retroResult.summary.avgWin}%
                  </div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-4">
                  <div className="text-slate-400 text-sm">Avg Loss</div>
                  <div className="text-lg font-bold text-red-400">
                    {retroResult.summary.avgLoss}%
                  </div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-4">
                  <div className="text-slate-400 text-sm">Profit Factor</div>
                  <div className={`text-lg font-bold ${retroResult.summary.profitFactor >= 1 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {retroResult.summary.profitFactor}
                  </div>
                </div>
              </div>
              
              {/* By Exit Reason */}
              {retroResult.byExitReason && Object.keys(retroResult.byExitReason).length > 0 && (
                <div className="bg-slate-800/50 rounded-lg p-4">
                  <h3 className="text-sm font-medium text-slate-300 mb-3">Performance by Exit Reason</h3>
                  <div className="grid grid-cols-3 gap-4">
                    {Object.entries(retroResult.byExitReason).map(([reason, data]: [string, any]) => (
                      <div key={reason} className="text-center">
                        <div className="text-xs text-slate-400 mb-1">
                          {reason === 'BELOW_10MA' ? 'Below 10 MA' : reason === 'STOP_LOSS' ? 'Stop Loss' : 'Max Hold'}
                        </div>
                        <div className="text-lg font-bold text-slate-100">{data.count} trades</div>
                        <div className={`text-sm ${data.avgReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {data.avgReturn >= 0 ? '+' : ''}{data.avgReturn}% avg
                        </div>
                        <div className="text-xs text-slate-500">{data.winRate}% win rate</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {/* By Entry MA */}
              {retroResult.byEntryMA && Object.keys(retroResult.byEntryMA).length > 0 && (
                <div className="bg-slate-800/50 rounded-lg p-4">
                  <h3 className="text-sm font-medium text-slate-300 mb-3">Performance by Entry Point</h3>
                  <div className="grid grid-cols-2 gap-4">
                    {Object.entries(retroResult.byEntryMA).map(([ma, data]: [string, any]) => (
                      <div key={ma} className="flex justify-between items-center">
                        <div>
                          <div className="font-medium text-slate-200">{ma}</div>
                          <div className="text-sm text-slate-400">{data.count} signals</div>
                        </div>
                        <div className="text-right">
                          <div className={`font-bold ${data.avgReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {data.avgReturn >= 0 ? '+' : ''}{data.avgReturn}%
                          </div>
                          <div className="text-sm text-slate-400">{data.winRate}% win</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Monthly Performance */}
              {retroResult.byMonth && Object.keys(retroResult.byMonth).length > 0 && (
                <div className="bg-slate-800/50 rounded-lg p-4">
                  <h3 className="text-sm font-medium text-slate-300 mb-3">Performance by Month</h3>
                  <div className="grid grid-cols-4 md:grid-cols-6 gap-2">
                    {Object.entries(retroResult.byMonth)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([month, data]: [string, any]) => (
                      <div key={month} className="text-center p-2 rounded bg-slate-900/50">
                        <div className="text-xs text-slate-400">{month}</div>
                        <div className={`text-sm font-bold ${data.avgReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {data.avgReturn >= 0 ? '+' : ''}{data.avgReturn}%
                        </div>
                        <div className="text-xs text-slate-500">{data.count} sig</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Insights */}
              <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
                <h3 className="font-semibold text-purple-400 mb-2">💡 Key Insights</h3>
                <ul className="space-y-1 text-sm text-slate-300">
                  {retroResult.summary.winRate >= 40 ? (
                    <li>• {retroResult.summary.winRate}% win rate with {retroResult.summary.totalSignals} historical signals - system shows promise</li>
                  ) : (
                    <li>• ⚠️ {retroResult.summary.winRate}% win rate is below 40% - consider refining entry criteria</li>
                  )}
                  {retroResult.summary.expectancy > 0 && (
                    <li>• Positive expectancy of +{retroResult.summary.expectancy}% per trade</li>
                  )}
                  {retroResult.summary.profitFactor >= 1.5 && (
                    <li>• Profit factor of {retroResult.summary.profitFactor} indicates gains exceed losses</li>
                  )}
                  <li>• Analyzed {retroResult.config.tickersAnalyzed} tickers over {retroResult.config.lookbackMonths} months</li>
                </ul>
              </div>
              
              {/* Modal Footer */}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowRetroModal(false)}
                  className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
