# VCP Stock Screener – Plan

## Goal
Web app that finds stocks meeting **Mark Minervini’s VCP (Volatility Contraction Pattern)** criteria: strong prior move, consolidation with contracting pullbacks, and support at 10, 20, and/or 50-day moving averages. Uses **real data** only. Scans **S&P 500** and **IWM (Russell 2000)** every 24 hours and surfaces “VCP bullish” candidates.

---

## 1. VCP Criteria (Implementation Targets)

| Criterion | Implementation approach |
|-----------|-------------------------|
| **Progressive contractions** | Each pullback in the base has smaller % range than the previous (e.g. 15% → 10% → 5%). Detect 2–3+ contractions. |
| **Volume dry-up** | Volume on pullbacks below recent average; optional: volume expansion on up days. |
| **Stage 2 / MAs** | Price above 50 (and ideally 150/200) SMA; **consolidation finding support at 10, 20, or 50 SMA** (your focus). |
| **Pivot** | Clear high in base; breakout level for entry. |
| **Relative strength** | RS > 70 (we can approximate with performance vs SPY or skip if no RS API). |
| **Earnings** | Optional: use Massive/Benzinga earnings if available. |

**Scope for v1:**  
- OHLC + volume from Massive.  
- Compute 10, 20, 50 SMA (from daily bars).  
- Detect base: prior run-up, then consolidation.  
- Detect contractions: successive pullbacks with decreasing range %.  
- Flag “VCP bullish” when price is consolidating and touching/holding 10, 20, and/or 50 SMA.

---

## 2. Data Sources

- **Massive API** (primary)
  - **OHLC:** `GET /v2/aggs/ticker/{ticker}/range/1/day/{from}/{to}` — daily bars for price and volume.
  - **SMA:** `GET /v1/indicators/sma/{ticker}` — window 10, 20, 50 (or we compute SMA from daily bars).
  - **Dividends:** `GET /v3/reference/dividends` (query by ticker) — for context/splits; you provided this URL + apiKey.
  - **ETF constituents:** `GET /etf-global/v1/constituents?composite_ticker=SPY` and `...?composite_ticker=IWM` for S&P 500 and Russell 2000 names.
- **Charts:** Use real OHLC from Massive; render with a lightweight chart lib (e.g. Lightweight Charts) or embed TradingView widget with same ticker/interval so it’s real data.

**Note:** Dividends endpoint you gave is reference/dividends (all tickers). For “by ticker” we may need a ticker filter if Massive supports it; otherwise we use OHLC + SMA for screening and use dividends only where needed.

---

## 3. Architecture

- **Frontend:** React + Vite + Tailwind.  
- **Backend:** Node (Express). Single process in dev: `npm run dev` serves both the app and API at **http://localhost:5173** (Express + Vite middleware). API routes proxy to Massive (apiKey server-side), run VCP scan, serve cached results.
- **Storage:** JSON files in `data/` (scan-results, fundamentals, industry data, bars cache). No database.
- **Scheduler:** Optional 24h scan: `SCHEDULE_SCAN=1 npm run dev` (in-process interval).

---

## 4. User Flow

1. **Dashboard**
   - “Last scan: …” (date/time).
   - List of symbols that are **VCP bullish** (S&P 500 + IWM), sortable/filterable.
   - Optional: filter by “touching 10 MA”, “20 MA”, “50 MA”, or “all three”.
2. **Symbol detail**
   - Ticker, name, which MAs it’s consolidating into.
   - Chart: real daily bars + 10/20/50 SMA (from our data or TradingView).
   - Short summary: contraction count, last pullback %, distance to MAs.
3. **Manual refresh**
   - Button to “Run scan now” (throttled e.g. once per 15 min to respect API limits).

---

## 5. Task Breakdown

1. **Scaffold** – Vite + React + Tailwind; optional Next.js or Express for API.
2. **Massive API client** – env var for apiKey; functions: daily bars, SMA (or computed), dividends (if needed), ETF constituents (SPY, IWM).
3. **VCP engine** – Input: array of daily bars + optional SMA series. Output: boolean “VCP bullish” + metadata (contraction count, which MAs, last pullback %).
4. **Scan job** – Load SPY + IWM constituents; for each, fetch bars + SMA; run VCP; persist results + “last scan” timestamp.
5. **24h schedule** – Cron or scheduler to run scan daily.
6. **UI** – Screener table, detail page, chart (Lightweight Charts or TradingView), “Last scan” and “Scan now”.
7. **Tests** – Unit tests for VCP logic (synthetic bars); integration test for API client (mock or one ticker).

---

## 6. API Key / Security

- Store Massive apiKey in `.env` (e.g. `MASSIVE_API_KEY`). Never expose in frontend. All Massive calls from backend.

---

## 7. Constituents

- **S&P 500:** Use Massive ETF constituents for **SPY** (same universe for practical purposes).  
- **Russell 2000:** Use **IWM** constituents from same Massive endpoint.  
- Combine and dedupe for one “universe” to scan.

---

## 8. Out of Scope for v1

- Real-time streaming.  
- Full Minervini checklist (e.g. RS rating 90+ from external source; earnings acceleration) unless we add Benzinga/earnings later.  
- User accounts / persistence of user-specific watchlists (can add later).

---

Next: implement scaffold, then API client, then VCP logic, then scan + UI.
