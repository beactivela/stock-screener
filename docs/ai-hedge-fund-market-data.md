# AI Hedge Fund market data (stock-screener + FMP proxy)

The bundled [`ai-hedge-fund`](../ai-hedge-fund/) app no longer requires **Financial Datasets** by default. Set **`HEDGE_FUND_MARKET_DATA`** in `ai-hedge-fund/.env`:

| Mode | Behavior |
|------|----------|
| `composite` (default) | Daily bars from **stock-screener** `GET /api/bars/:ticker` (Yahoo + `bars_cache`). Ratios and FMP-backed data via **Express** `GET /api/ai-hedge-fund/fmp/*` (proxies FMP using `FMP_API_KEY` on the Node server only). |
| `stock_screener` | Bars + `GET /api/fundamentals/:ticker` only; FMP-backed calls still hit the proxy but you can treat failures as empty. |
| `supabase` | Prices from **PostgREST** `bars_cache` when `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` are set in `ai-hedge-fund/.env`; fundamentals still use `/api/fundamentals` unless you extend the code. |
| `financial_datasets` | Legacy **Financial Datasets** API (requires `FINANCIAL_DATASETS_API_KEY` and not the placeholder string). |

## Required for composite local dev

1. **Stock screener** running (e.g. `npm run dev` on port **5174**).
2. **`STOCK_SCREENER_API_BASE`** in `ai-hedge-fund/.env`, e.g. `http://127.0.0.1:5174`.
3. **`FMP_API_KEY`** in the **project root** `.env` (Node), not in the hedge-fund Python `.env`, so `/api/ai-hedge-fund/fmp/...` can proxy FMP.

## Fallback order

- **Prices:** screener bars → (supabase mode only) `bars_cache` via REST.
- **Metrics:** FMP `key-metrics-ttm` via proxy → Yahoo merged fundamentals from `/api/fundamentals/:ticker`.
- **Line items:** FMP `income-statement` (quarterly) via proxy.
- **Insiders / news:** FMP via proxy; empty if your FMP plan returns a subscription error (see `fmpResponseIsPlanError` in [`server/fmp/fmpClient.js`](../server/fmp/fmpClient.js)).

## Related files

- Express proxy: [`server/http/registerAiHedgeFundFmpRoutes.js`](../server/http/registerAiHedgeFundFmpRoutes.js)
- Python routing: [`ai-hedge-fund/src/tools/api.py`](../ai-hedge-fund/src/tools/api.py)
