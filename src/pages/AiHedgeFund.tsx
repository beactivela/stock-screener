import { AI_HEDGE_FUND_URL } from '../config/aiHedgeFund'

/**
 * In-app shell for the bundled virattt/ai-hedge-fund UI (separate Vite app, default http://127.0.0.1:5175).
 * Local: `npm run dev:all` (everything), or `npm run dev` + `npm run ai-hedge-fund:dev`.
 * If 5174 + 8000 are already taken (screener + API up), only start the embed UI: `npm run ai-hedge-fund:vite`.
 * Override embed URL with VITE_AI_HEDGE_FUND_URL.
 */
export default function AiHedgeFund() {
  return (
    <div className="flex flex-col gap-3 min-h-[calc(100vh-6rem)]">
      <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-4 py-3 text-sm text-slate-400">
        <p>
          The hedge fund UI is embedded from{' '}
          <code className="text-sky-400/95">{AI_HEDGE_FUND_URL}</code>. If you see “refused to connect”, the Vite app
          on 5175 is not running — use one command:{' '}
          <code className="text-sky-400/95">npm run dev:all</code> (FastAPI 8000 + hedge UI 5175 + screener 5174). If{' '}
          <code className="text-sky-400/95">npm run dev</code> is already running, do not start another on 5174. Second
          terminal: <code className="text-sky-400/95">npm run ai-hedge-fund:dev</code> (API + UI), or if port 8000 is
          already in use, only the iframe UI: <code className="text-sky-400/95">npm run ai-hedge-fund:vite</code>.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          <a
            href={AI_HEDGE_FUND_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sky-500 hover:text-sky-400"
          >
            Open in new tab
          </a>{' '}
          if embedding is blocked.
        </p>
      </div>
      <iframe
        title="AI Hedge Fund"
        src={AI_HEDGE_FUND_URL}
        className="w-full flex-1 min-h-[60vh] rounded-lg border border-slate-800 bg-slate-950"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
      />
    </div>
  )
}
