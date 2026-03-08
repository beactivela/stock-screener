import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE } from '../utils/api'

/**
 * Compact ticker search for the header. On Evaluate, navigates to the stock detail page
 * which shows the full VCP evaluation.
 */
export default function TickerSearch() {
  const [tickerInput, setTickerInput] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const evaluateTicker = () => {
    const sym = tickerInput.trim().toUpperCase()
    if (!sym) return
    setLoading(true)
    fetch(`${API_BASE}/api/vcp/${encodeURIComponent(sym)}`)
      .then(async (r) => {
        const text = await r.text()
        let body: unknown = null
        if (text.trim()) {
          try {
            body = JSON.parse(text)
          } catch {
            /* non-JSON */
          }
        }
        if (!r.ok) {
          const msg =
            body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string'
              ? (body as { error: string }).error
              : text.trim() || r.statusText
          throw new Error(msg)
        }
        return body
      })
      .then(() => {
        navigate(`/stock/${sym}`)
      })
      .catch((err) => {
        alert(err instanceof Error ? err.message : 'Evaluation failed')
      })
      .finally(() => setLoading(false))
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
        disabled={loading || !tickerInput.trim()}
        className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium"
      >
        {loading ? '…' : 'Evaluate'}
      </button>
    </div>
  )
}
