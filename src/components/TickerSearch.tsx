import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

/**
 * Compact ticker search for the header. Navigates to the stock chart workspace.
 */
export default function TickerSearch() {
  const [tickerInput, setTickerInput] = useState('')
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const evaluateTicker = () => {
    const sym = tickerInput.trim().toUpperCase()
    if (!sym) return
    const qs = searchParams.toString()
    navigate(qs ? `/stock/${sym}?${qs}` : `/stock/${sym}`)
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        placeholder="e.g. AAPL"
        value={tickerInput}
        onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
        onKeyDown={(e) => e.key === 'Enter' && evaluateTicker()}
        className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 placeholder-slate-500 w-28 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
        aria-label="Ticker symbol"
      />
      <button
        type="button"
        onClick={evaluateTicker}
        disabled={!tickerInput.trim()}
        className="px-3 py-1.5 rounded-lg bg-sky-500 text-white text-sm font-medium hover:bg-sky-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 disabled:cursor-not-allowed disabled:bg-sky-500 disabled:hover:bg-sky-500"
      >
        Go
      </button>
    </div>
  )
}
