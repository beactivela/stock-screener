/**
 * Base URL for the bundled [virattt/ai-hedge-fund](https://github.com/virattt/ai-hedge-fund) web UI (iframe on `/ai-hedge-fund`).
 * Dev default is port 5175 so it does not clash with stock-screener (`npm run dev` on 5174).
 * Override with VITE_AI_HEDGE_FUND_URL when deploying or using a tunnel.
 */
export const AI_HEDGE_FUND_URL =
  import.meta.env.VITE_AI_HEDGE_FUND_URL ?? 'http://127.0.0.1:5175'
