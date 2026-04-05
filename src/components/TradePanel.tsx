/**
 * TradePanel - Side panel for logging trade entries
 * 
 * This component allows you to:
 * - Log a new long entry (record when you buy)
 * - Close an existing position (record when you sell)
 * - View your current position status
 * - Set conviction level (1-5)
 * 
 * All data is captured to feed back into Opus4.5 learning system.
 */

import { useState, useEffect } from 'react'
import { API_BASE } from '../utils/api'

// Types matching the server-side trade structure
interface EntryMetrics {
  sma10: number | null
  sma20: number | null
  sma50: number | null
  contractions: number
  volumeDryUp: boolean
  pattern: string | null
  patternConfidence: number | null
  relativeStrength: number | null
  industryName: string | null
  industryRank: number | null
  opus45Confidence: number | null
  opus45Grade: string | null
  vcpScore: number | null
  enhancedScore: number | null
}

interface Trade {
  id: string
  ticker: string
  companyName: string | null
  entryDate: string
  entryPrice: number
  entryMetrics: EntryMetrics
  conviction: number
  notes: string | null
  exitDate: string | null
  exitPrice: number | null
  exitType: string | null
  status: 'open' | 'closed' | 'stopped'
  returnPct: number | null
  holdingDays: number | null
  stopLossPrice: number
  targetPrice: number
}

interface TradePanelProps {
  ticker: string
  companyName: string | null
  currentPrice: number | null
  // Current technical data for auto-capture
  metrics?: Partial<EntryMetrics>
}

// Conviction level descriptions
const CONVICTION_LABELS = [
  { value: 1, label: 'Low', description: 'Speculative, small position' },
  { value: 2, label: 'Below Avg', description: 'Some doubts, reduced size' },
  { value: 3, label: 'Average', description: 'Standard setup, normal size' },
  { value: 4, label: 'Above Avg', description: 'Strong setup, larger size' },
  { value: 5, label: 'High', description: 'Perfect setup, max position' },
]

export default function TradePanel({ ticker, companyName, currentPrice, metrics }: TradePanelProps) {
  // Panel state
  const [isExpanded, setIsExpanded] = useState(true)
  const [activeTab, setActiveTab] = useState<'entry' | 'exit' | 'history'>('entry')
  
  // Trade data
  const [openTrade, setOpenTrade] = useState<Trade | null>(null)
  const [tradeHistory, setTradeHistory] = useState<Trade[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  
  // Entry form state
  const [entryPrice, setEntryPrice] = useState<string>('')
  const [entryDate, setEntryDate] = useState<string>(new Date().toISOString().slice(0, 10))
  const [conviction, setConviction] = useState<number>(3)
  const [notes, setNotes] = useState<string>('')
  
  // Exit form state
  const [exitPrice, setExitPrice] = useState<string>('')
  const [exitDate, setExitDate] = useState<string>(new Date().toISOString().slice(0, 10))
  const [exitNotes, setExitNotes] = useState<string>('')

  // Load existing trade for this ticker
  useEffect(() => {
    if (!ticker) return
    
    async function loadTrades() {
      try {
        const res = await fetch(`${API_BASE}/api/trades?ticker=${encodeURIComponent(ticker)}&includeStats=false`)
        if (!res.ok) throw new Error('Failed to load trades')
        
        const data = await res.json()
        const trades = data.trades || []
        
        // Find open trade for this ticker
        const open = trades.find((t: Trade) => 
          t.ticker === ticker.toUpperCase() && t.status === 'open'
        )
        setOpenTrade(open || null)
        
        // Get history for this ticker
        const history = trades.filter((t: Trade) => 
          t.ticker === ticker.toUpperCase() && t.status !== 'open'
        )
        setTradeHistory(history)
        
        // If there's an open trade, switch to exit tab
        if (open) {
          setActiveTab('exit')
        }
      } catch (e) {
        console.error('Error loading trades:', e)
      }
    }
    
    loadTrades()
  }, [ticker])

  // Set default entry price from current price
  useEffect(() => {
    if (currentPrice && !entryPrice) {
      setEntryPrice(currentPrice.toFixed(2))
    }
  }, [currentPrice])

  // Handle creating a new entry
  async function handleCreateEntry(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)
    
    try {
      const res = await fetch(`${API_BASE}/api/trades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          companyName,
          entryPrice: parseFloat(entryPrice),
          entryDate,
          conviction,
          notes: notes || null,
          entryMetrics: metrics || {}
        })
      })
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create trade')
      }
      
      const trade = await res.json()
      setOpenTrade(trade)
      setSuccess('Trade logged successfully!')
      setActiveTab('exit')
      
      // Reset form
      setNotes('')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // Handle closing an existing trade
  async function handleCloseTrade(e: React.FormEvent) {
    e.preventDefault()
    if (!openTrade) return
    
    setLoading(true)
    setError(null)
    setSuccess(null)
    
    try {
      const res = await fetch(`${API_BASE}/api/trades/${openTrade.id}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exitPrice: parseFloat(exitPrice),
          exitDate,
          exitNotes: exitNotes || null
        })
      })
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to close trade')
      }
      
      const trade = await res.json()
      setTradeHistory([trade, ...tradeHistory])
      setOpenTrade(null)
      setSuccess(`Trade closed: ${trade.returnPct > 0 ? '+' : ''}${trade.returnPct}%`)
      setActiveTab('entry')
      
      // Reset forms
      setExitPrice('')
      setExitNotes('')
      setEntryPrice(currentPrice?.toFixed(2) || '')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // Handle deleting a trade
  async function handleDeleteTrade(tradeId: string, isOpen: boolean = false) {
    if (!confirm('Are you sure you want to delete this trade? This cannot be undone.')) {
      return
    }
    
    setLoading(true)
    setError(null)
    setSuccess(null)
    
    try {
      const res = await fetch(`${API_BASE}/api/trades/${tradeId}`, {
        method: 'DELETE'
      })
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete trade')
      }
      
      if (isOpen) {
        // Deleted the open trade
        setOpenTrade(null)
        setSuccess('Trade deleted')
        setActiveTab('entry')
      } else {
        // Deleted from history
        setTradeHistory(tradeHistory.filter(t => t.id !== tradeId))
        setSuccess('Trade deleted from history')
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // Calculate unrealized P&L for open trade
  const unrealizedPnL = openTrade && currentPrice
    ? ((currentPrice - openTrade.entryPrice) / openTrade.entryPrice) * 100
    : null

  const unrealizedPnLFormatted = unrealizedPnL !== null
    ? `${unrealizedPnL >= 0 ? '+' : ''}${unrealizedPnL.toFixed(1)}%`
    : null

  return (
    <div className="border border-slate-800 rounded-xl bg-slate-900/80 overflow-hidden">
      {/* Header - Always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-800/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-lg">📝</span>
          <div>
            <div className="font-medium text-slate-200">Trade Journal</div>
            <div className="text-xs text-slate-500">
              {openTrade 
                ? `Position open: ${openTrade.entryPrice.toFixed(2)} → ${unrealizedPnLFormatted}`
                : 'No open position'
              }
            </div>
          </div>
        </div>
        <svg
          className={`w-5 h-5 text-slate-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-slate-800">
          {/* Tabs */}
          <div className="flex border-b border-slate-800">
            <button
              onClick={() => setActiveTab('entry')}
              className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === 'entry'
                  ? 'text-emerald-400 border-b-2 border-emerald-400 bg-slate-800/50'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              New Entry
            </button>
            <button
              onClick={() => setActiveTab('exit')}
              className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === 'exit'
                  ? 'text-red-400 border-b-2 border-red-400 bg-slate-800/50'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              Exit {openTrade && '●'}
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === 'history'
                  ? 'text-sky-400 border-b-2 border-sky-400 bg-slate-800/50'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              History
            </button>
          </div>

          {/* Messages */}
          {error && (
            <div className="mx-4 mt-3 px-3 py-2 bg-red-500/20 border border-red-500/50 rounded text-red-400 text-sm">
              {error}
            </div>
          )}
          {success && (
            <div className="mx-4 mt-3 px-3 py-2 bg-emerald-500/20 border border-emerald-500/50 rounded text-emerald-400 text-sm">
              {success}
            </div>
          )}

          {/* Entry Tab */}
          {activeTab === 'entry' && (
            <form onSubmit={handleCreateEntry} className="p-4 space-y-4">
              {openTrade && (
                <div className="px-3 py-2 bg-amber-500/20 border border-amber-500/50 rounded text-amber-400 text-sm">
                  You already have an open position. Close it first or add to your position.
                </div>
              )}
              
              {/* Price & Date row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Entry Price</label>
                  <input
                    type="number"
                    step="0.01"
                    value={entryPrice}
                    onChange={(e) => setEntryPrice(e.target.value)}
                    placeholder={currentPrice?.toFixed(2) || '0.00'}
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1" htmlFor="entry-date">Entry Date</label>
                  <input
                    id="entry-date"
                    type="date"
                    value={entryDate}
                    onChange={(e) => setEntryDate(e.target.value)}
                    title="Entry date for this trade"
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                    required
                  />
                </div>
              </div>

              {/* Conviction Scale */}
              <div>
                <label className="block text-xs text-slate-500 mb-2">Conviction Level</label>
                <div className="flex gap-2">
                  {CONVICTION_LABELS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setConviction(c.value)}
                      title={c.description}
                      className={`flex-1 py-2 px-1 rounded-lg text-xs font-medium transition-all ${
                        conviction === c.value
                          ? c.value <= 2
                            ? 'bg-red-500/30 text-red-300 ring-2 ring-red-500'
                            : c.value === 3
                            ? 'bg-amber-500/30 text-amber-300 ring-2 ring-amber-500'
                            : 'bg-emerald-500/30 text-emerald-300 ring-2 ring-emerald-500'
                          : 'bg-slate-800 text-slate-500 hover:bg-slate-700'
                      }`}
                    >
                      {c.value}
                      <div className="text-xs opacity-70">{c.label}</div>
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  {CONVICTION_LABELS.find(c => c.value === conviction)?.description}
                </p>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs text-slate-500 mb-1">Why this trade? (optional)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g., Perfect VCP setup, tight base, earnings beat..."
                  rows={2}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 text-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none resize-none"
                />
              </div>

              {/* Auto-captured metrics preview */}
              {metrics && Object.keys(metrics).length > 0 && (
                <div className="bg-slate-800/50 rounded-lg p-3">
                  <div className="text-xs text-slate-500 mb-2">Auto-captured at entry:</div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    {metrics.vcpScore != null && (
                      <div><span className="text-slate-500">VCP:</span> <span className="text-slate-300">{metrics.vcpScore}</span></div>
                    )}
                    {metrics.enhancedScore != null && (
                      <div><span className="text-slate-500">Enhanced:</span> <span className="text-slate-300">{metrics.enhancedScore}</span></div>
                    )}
                    {metrics.relativeStrength != null && (
                      <div><span className="text-slate-500">RS:</span> <span className="text-slate-300">{metrics.relativeStrength}</span></div>
                    )}
                    {metrics.contractions != null && (
                      <div><span className="text-slate-500">Contr:</span> <span className="text-slate-300">{metrics.contractions}</span></div>
                    )}
                    {metrics.industryRank != null && (
                      <div><span className="text-slate-500">Ind Rank:</span> <span className="text-slate-300">#{metrics.industryRank}</span></div>
                    )}
                    {metrics.opus45Confidence != null && (
                      <div><span className="text-slate-500">Opus:</span> <span className="text-slate-300">{metrics.opus45Confidence}%</span></div>
                    )}
                  </div>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={loading || !entryPrice}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg transition-colors"
              >
                {loading ? 'Logging...' : 'Log Entry (Go Long)'}
              </button>
            </form>
          )}

          {/* Exit Tab */}
          {activeTab === 'exit' && (
            <div className="p-4">
              {openTrade ? (
                <form onSubmit={handleCloseTrade} className="space-y-4">
                  {/* Current Position Summary */}
                  <div className="bg-slate-800/50 rounded-lg p-3 space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 text-sm">Entry</span>
                      <span className="text-slate-200 font-mono">${openTrade.entryPrice.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 text-sm">Current</span>
                      <span className="text-slate-200 font-mono">${currentPrice?.toFixed(2) || '–'}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 text-sm">P&L</span>
                      <span className={`font-mono font-bold ${
                        unrealizedPnL && unrealizedPnL >= 0 ? 'text-emerald-400' : 'text-red-400'
                      }`}>
                        {unrealizedPnLFormatted || '–'}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 text-sm">Stop Loss</span>
                      <span className="text-red-400 font-mono">${openTrade.stopLossPrice.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 text-sm">Target</span>
                      <span className="text-emerald-400 font-mono">${openTrade.targetPrice.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-500 text-sm">Conviction</span>
                      <span className="text-slate-300">{openTrade.conviction}/5</span>
                    </div>
                  </div>

                  {/* Exit Form */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Exit Price</label>
                      <input
                        type="number"
                        step="0.01"
                        value={exitPrice}
                        onChange={(e) => setExitPrice(e.target.value)}
                        placeholder={currentPrice?.toFixed(2) || '0.00'}
                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 text-sm focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1" htmlFor="exit-date">Exit Date</label>
                      <input
                        id="exit-date"
                        type="date"
                        value={exitDate}
                        onChange={(e) => setExitDate(e.target.value)}
                        title="Exit date for this trade"
                        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 text-sm focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Exit Notes (optional)</label>
                    <textarea
                      value={exitNotes}
                      onChange={(e) => setExitNotes(e.target.value)}
                      placeholder="e.g., Hit target, stopped out, pattern failed..."
                      rows={2}
                      className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 text-sm focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-none resize-none"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading || !exitPrice}
                    className="w-full py-2.5 bg-red-600 hover:bg-red-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium rounded-lg transition-colors"
                  >
                    {loading ? 'Closing...' : 'Close Position'}
                  </button>

                  {/* Delete button - removes trade without recording exit */}
                  <button
                    type="button"
                    onClick={() => handleDeleteTrade(openTrade.id, true)}
                    disabled={loading}
                    className="w-full py-2 text-slate-500 hover:text-red-400 text-sm transition-colors"
                  >
                    🗑️ Delete entry (don't record exit)
                  </button>
                </form>
              ) : (
                <div className="text-center py-8 text-slate-500">
                  <div className="text-4xl mb-3">📭</div>
                  <div>No open position for {ticker}</div>
                  <button
                    onClick={() => setActiveTab('entry')}
                    className="mt-3 text-emerald-400 hover:text-emerald-300 text-sm"
                  >
                    Log a new entry →
                  </button>
                </div>
              )}
            </div>
          )}

          {/* History Tab */}
          {activeTab === 'history' && (
            <div className="p-4">
              {tradeHistory.length > 0 ? (
                <div className="space-y-2">
                  {tradeHistory.map((trade) => (
                    <div
                      key={trade.id}
                      className="bg-slate-800/50 rounded-lg p-3 flex items-center justify-between group"
                    >
                      <div>
                        <div className="text-slate-400 text-xs">
                          {trade.entryDate} → {trade.exitDate}
                        </div>
                        <div className="text-slate-200 text-sm">
                          ${trade.entryPrice.toFixed(2)} → ${trade.exitPrice?.toFixed(2)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-right">
                          <div className={`font-mono font-bold ${
                            trade.returnPct && trade.returnPct >= 0 ? 'text-emerald-400' : 'text-red-400'
                          }`}>
                            {trade.returnPct && trade.returnPct >= 0 ? '+' : ''}{trade.returnPct?.toFixed(1)}%
                          </div>
                          <div className="text-slate-500 text-xs">
                            {trade.holdingDays} days • Conv: {trade.conviction}/5
                          </div>
                        </div>
                        {/* Delete button - visible on hover */}
                        <button
                          onClick={() => handleDeleteTrade(trade.id, false)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-600 hover:text-red-400 transition-all"
                          title="Delete trade"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-slate-500">
                  <div className="text-4xl mb-3">📊</div>
                  <div>No trade history for {ticker}</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
