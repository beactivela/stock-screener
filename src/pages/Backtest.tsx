import { useEffect, useState } from 'react'
import { API_BASE } from '../utils/api'

/**
 * Backtest Page
 * 
 * This page allows users to validate their scoring system by running backtests
 * on historical scan results. It checks if high-scoring stocks actually 
 * outperformed over time.
 * 
 * How it works:
 * 1. User selects a past scan date (snapshot)
 * 2. User sets forward-looking period (30/60/90/180 days)
 * 3. System fetches historical price data and calculates returns
 * 4. Results show win rates, average returns, and expectancy by score bucket
 */

export default function Backtest() {
  // State for available scan snapshots
  const [backtestSnapshots, setBacktestSnapshots] = useState<Array<{
    date: string
    filename: string
    tickerCount: number
  }>>([])
  
  // Configuration state
  const [selectedSnapshotDate, setSelectedSnapshotDate] = useState<string | null>(null)
  const [backtestDays, setBacktestDays] = useState<number>(30)
  
  // Execution state
  const [backtestRunning, setBacktestRunning] = useState(false)
  const [backtestResult, setBacktestResult] = useState<any>(null)
  const [showBacktestModal, setShowBacktestModal] = useState(false)

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
      alert('Please select a scan date to backtest')
      return
    }
    
    setBacktestRunning(true)
    setBacktestResult(null)
    
    try {
      const res = await fetch(`${API_BASE}/api/backtest/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scanDate: selectedSnapshotDate,
          daysForward: backtestDays
        })
      })
      
      const result = await res.json()
      
      // Handle "not enough time elapsed" error
      if (result.error === 'not_enough_time') {
        alert(
          `Not enough time has elapsed.\n\n` +
          `Need: ${result.daysNeeded} days\n` +
          `Elapsed: ${result.daysElapsed} days\n\n` +
          `Please select an older scan or reduce the forward days.`
        )
        return
      }
      
      if (!res.ok) {
        alert(`Backtest failed: ${result.error || res.statusText}`)
        return
      }
      
      setBacktestResult(result)
      setShowBacktestModal(true)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Backtest failed')
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

      {/* Configuration Card */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
        <h2 className="text-lg font-medium text-slate-200 mb-4">Configuration</h2>
        
        {backtestSnapshots.length === 0 ? (
          <div className="text-slate-400 text-sm">
            No scan snapshots available. Run a scan first to generate backtest data.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
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
                            : 'Not enough time has elapsed since scan date'
                          }
                        </div>
                      </div>
                    </div>
                  );
                })()}
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

      {/* Info Card - How it works */}
      <div className="rounded-xl border border-sky-800/50 bg-sky-900/10 p-6">
        <h3 className="text-lg font-medium text-sky-400 mb-3">How Backtesting Works</h3>
        <div className="space-y-2 text-sm text-slate-300">
          <p>
            <strong>1. Select a snapshot:</strong> Choose a historical scan date where you ran the VCP screener
          </p>
          <p>
            <strong>2. Set forward period:</strong> Decide how many days ahead to measure returns (e.g., 30, 60, 90 days)
          </p>
          <p>
            <strong>3. Run analysis:</strong> The system fetches historical prices and calculates actual returns for each stock
          </p>
          <p>
            <strong>4. Review results:</strong> See performance grouped by score buckets (90-100, 80-89, etc.) to validate if your scoring system correctly predicts winners
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
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-slate-800/50 rounded-lg p-4">
                  <div className="text-slate-400 text-sm">Forward Days</div>
                  <div className="text-2xl font-bold text-slate-100">
                    {backtestResult.analysis.daysForward}
                  </div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-4">
                  <div className="text-slate-400 text-sm">Total Trades</div>
                  <div className="text-2xl font-bold text-slate-100">
                    {backtestResult.analysis.summary.totalTrades}
                  </div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-4">
                  <div className="text-slate-400 text-sm">Wins</div>
                  <div className="text-2xl font-bold text-emerald-400">
                    {backtestResult.analysis.summary.totalWins}
                  </div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-4">
                  <div className="text-slate-400 text-sm">Overall Win Rate</div>
                  <div className="text-2xl font-bold text-sky-400">
                    {backtestResult.analysis.summary.overallWinRate}%
                  </div>
                </div>
              </div>
              
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
    </div>
  )
}
