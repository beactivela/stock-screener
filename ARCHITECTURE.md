# System Architecture & Data Flow

## Runtime model (single port)

- **Development:** One process. Run `npm run dev` → Express listens on **port 5173**, with Vite dev middleware for the React app (HMR). The same origin serves both the UI and `/api/*`; no separate backend URL or proxy.
- **Production:** `npm run build` then `npm run serve` → Express serves the built static app from `dist/` and the same API routes.
- **Optional:** `npm run server` runs the API only (default port 3001) for scripts or external clients; use `BASE_URL=http://localhost:3001` in scripts if needed.

**Single URL in dev:** `http://localhost:5173` (app) and `http://localhost:5173/api/...` (API).

---

## Complete System Diagram

*In development, the "Server/Backend" and "Frontend" layers below run in one Node process; the diagram shows logical separation.*

```
┌─────────────────────────────────────────────────────────────────┐
│                     DATA SOURCES                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Yahoo Finance (Free)              Massive API (Paid - Optional)│
│  ├─ Daily OHLC bars               ├─ ETF constituents          │
│  ├─ Company fundamentals          ├─ Alternative data          │
│  ├─ Industry performance          └─ Future: options, etc.     │
│  └─ SPY bars (for RS calc)                                      │
│                                                                  │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                   SERVER / BACKEND (Node.js)                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  📊 SCAN ENGINE (scan.js)                                       │
│  ├─ Load 500 tickers from data/tickers.txt                     │
│  ├─ Fetch SPY bars once (for RS calculations)                  │
│  ├─ For each ticker:                                            │
│  │  ├─ Get 90-day OHLC bars (with caching)                     │
│  │  ├─ Run VCP analysis (vcp.js)                               │
│  │  ├─ Calculate Relative Strength vs SPY                      │
│  │  ├─ Get fundamentals from cache                             │
│  │  ├─ Lookup industry rank                                    │
│  │  └─ Compute enhanced score (enhancedScan.js)                │
│  └─ Save results to data/scan-results.json                      │
│                                                                  │
│  🔍 VCP ANALYZER (vcp.js)                                       │
│  ├─ Calculate 10/20/50 SMAs                                    │
│  ├─ Find pullbacks & contractions                              │
│  ├─ Analyze volume dry-up                                      │
│  ├─ Check MA support (10/20/50)                                │
│  ├─ Calculate Relative Strength                                │
│  └─ Return: vcpBullish, contractions, volumeDryUp, RS          │
│                                                                  │
│  💯 SCORING ENGINE (enhancedScan.js)                            │
│  ├─ VCP Technical Score (0-50 pts)                             │
│  │  ├─ Progressive contractions: 15 pts                        │
│  │  ├─ Volume dry-up: 10 pts                                   │
│  │  ├─ MA support: 12 pts                                      │
│  │  ├─ Relative strength: 8 pts                                │
│  │  └─ Stage 2 uptrend: 5 pts                                  │
│  │                                                              │
│  ├─ CANSLIM Score (0-30 pts)                                   │
│  │  ├─ Quarterly EPS growth: 10 pts                            │
│  │  ├─ Annual EPS growth: 8 pts                                │
│  │  ├─ ROE & margins: 7 pts                                    │
│  │  └─ Institutional quality: 5 pts                            │
│  │                                                              │
│  ├─ Industry Context (0-20 pts)                                │
│  │  ├─ Industry rank: 10 pts                                   │
│  │  ├─ 1Y momentum: 5 pts                                      │
│  │  ├─ 6M acceleration: 3 pts                                  │
│  │  └─ Sector rotation: 2 pts                                  │
│  │                                                              │
│  └─ Apply Industry Multiplier (±20%)                           │
│     ├─ Top 20 industries: ×1.20 (+20%)                         │
│     ├─ Top 40 industries: ×1.15 (+15%)                         │
│     ├─ Top 60 industries: ×1.10 (+10%)                         │
│     ├─ Top 80 industries: ×1.05 (+5%)                          │
│     └─ Bottom 50%: ×0.90 (-10%)                                │
│                                                                  │
│  🏭 INDUSTRY ANALYZER (industrials.js)                          │
│  ├─ Fetch Yahoo Finance industry pages                         │
│  ├─ Parse 1Y/6M/3M/YTD returns                                 │
│  ├─ Group tickers by industry                                  │
│  ├─ Rank industries 1-136                                      │
│  └─ Save to data/industry-yahoo-returns.json                   │
│                                                                  │
│  📈 BACKTEST ENGINE (backtest.js) [NEW]                        │
│  ├─ Save scan snapshots (date, tickers, scores, prices)       │
│  ├─ After 30/60/90 days: fetch current prices                 │
│  ├─ Calculate forward returns, MFE, MAE                        │
│  ├─ Classify outcomes: WIN / LOSS / NEUTRAL                    │
│  ├─ Analyze win rates by score bucket                          │
│  └─ Generate optimization recommendations                       │
│                                                                  │
│  💾 DATA CACHE (data/ folder)                                   │
│  ├─ bars/ (OHLC cache by ticker)                              │
│  ├─ scan-results.json (latest scan)                           │
│  ├─ fundamentals.json (company data)                          │
│  ├─ industry-yahoo-returns.json (industry perf)               │
│  ├─ backtests/ (historical scan snapshots) [NEW]              │
│  └─ tickers.txt (500 S&P tickers)                             │
│                                                                  │
│  🌐 API ENDPOINTS                                               │
│  ├─ GET  /api/scan-results         → Latest scan               │
│  ├─ POST /api/scan                 → Run new scan (streaming)  │
│  ├─ GET  /api/vcp/:ticker          → Analyze single ticker     │
│  ├─ GET  /api/bars/:ticker         → OHLC data for charts      │
│  ├─ GET  /api/fundamentals         → All cached fundamentals   │
│  ├─ POST /api/fundamentals/fetch   → Fetch new fundamentals    │
│  ├─ GET  /api/industry-trend       → Industry performance      │
│  ├─ POST /api/industry-trend/fetch → Fetch Yahoo industries    │
│  └─ GET  /api/backtest/:date [NEW] → Backtest analysis         │
│                                                                  │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                  FRONTEND (React + Vite)                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  🏠 DASHBOARD PAGE (/)                                          │
│  ├─ Display scan results in sortable table                     │
│  ├─ Show composite scores with color coding                    │
│  ├─ Filter by: MA, Score range, Industry rank, RS             │
│  ├─ Columns:                                                    │
│  │  ├─ Ticker + Company Name                                   │
│  │  ├─ Score (68-96 range with color)                         │
│  │  ├─ Relative Strength vs SPY [NEW]                         │
│  │  ├─ Industry Rank #1-136 [NEW]                             │
│  │  ├─ Close Price                                             │
│  │  ├─ Contractions count                                      │
│  │  ├─ MA indicators (10/20/50)                               │
│  │  ├─ Fundamentals (inst %, EPS, margins)                    │
│  │  ├─ Industry performance (1Y/6M/3M/YTD)                    │
│  │  └─ Confidence / Win Rate [NEW - after backtesting]        │
│  ├─ Actions:                                                    │
│  │  ├─ Run Scan Now (with progress)                           │
│  │  ├─ Fetch Fundamentals                                      │
│  │  ├─ Fetch Industry 1Y Data                                 │
│  │  └─ Export Results                                          │
│  └─ Toggle: Table View ↔ Charts View                          │
│                                                                  │
│  🏭 INDUSTRY PAGE (/industry)                                   │
│  ├─ Show all 136 industries ranked by performance             │
│  ├─ Display sector groupings                                   │
│  ├─ Highlight top 20 / bottom 20 industries                   │
│  ├─ Show stock count per industry                             │
│  ├─ Click industry → filter to stocks in that industry        │
│  └─ Visual: Heatmap of industry performance                    │
│                                                                  │
│  📊 STOCK DETAIL PAGE (/stock/:ticker)                         │
│  ├─ 6-month price chart with 10/20/50/150/200 MAs            │
│  ├─ Score breakdown tooltip                                    │
│  ├─ VCP pattern visualization                                  │
│  ├─ Volume chart with avg volume line                         │
│  ├─ Company fundamentals summary                               │
│  ├─ Industry context & rank                                    │
│  └─ Historical score trend [NEW]                               │
│                                                                  │
│  🧪 BACKTEST PAGE (/backtest) [NEW]                            │
│  ├─ Performance by score bucket (90-100, 80-89, etc.)         │
│  ├─ Win rate charts & tables                                   │
│  ├─ Industry impact analysis                                   │
│  ├─ RS impact analysis                                         │
│  ├─ Component weight recommendations                           │
│  ├─ Historical optimization timeline                           │
│  └─ Export performance reports                                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Flow: Complete Scan Cycle

```
USER CLICKS "RUN SCAN NOW"
         │
         ▼
┌────────────────────────────────────────────────┐
│ 1. SERVER: Initialize Scan                     │
│    ├─ Load 500 tickers from tickers.txt        │
│    ├─ Fetch SPY bars (90 days)                 │
│    └─ Load cached fundamentals                 │
└────────────────┬───────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────┐
│ 2. FOR EACH TICKER (500 iterations)            │
│                                                 │
│    Step A: Get Price Data                      │
│    ├─ Check bars cache (data/bars/TICKER.json) │
│    ├─ If stale or missing: fetch from Yahoo    │
│    └─ Save to cache                             │
│                                                 │
│    Step B: VCP Analysis                         │
│    ├─ Calculate 10/20/50 SMAs                   │
│    ├─ Find pullbacks & contractions             │
│    ├─ Analyze volume dry-up                     │
│    ├─ Check MA support                          │
│    ├─ Calculate RS vs SPY [NEW]                 │
│    └─ Output: vcpResult object                  │
│                                                 │
│    Step C: Get Fundamental Data                │
│    ├─ Lookup ticker in fundamentals cache      │
│    ├─ Extract: industry, EPS, margins, inst %  │
│    └─ If missing: mark for future fetch        │
│                                                 │
│    Step D: Get Industry Context                │
│    ├─ Lookup industry in rankings              │
│    ├─ Get rank (1-136)                         │
│    ├─ Get 1Y/6M/3M performance                 │
│    └─ Determine multiplier (0.90 - 1.20)       │
│                                                 │
│    Step E: Calculate Enhanced Score            │
│    ├─ VCP Technical: 0-50 pts                  │
│    ├─ CANSLIM: 0-30 pts                        │
│    ├─ Industry Context: 0-20 pts               │
│    ├─ Base Score = sum (0-100)                 │
│    ├─ Apply Industry Multiplier (±20%)         │
│    └─ Final Score = base × multiplier          │
│                                                 │
│    Step F: Stream Result to Frontend           │
│    └─ Send SSE event with ticker result        │
│                                                 │
└────────────────┬───────────────────────────────┘
                 │ (repeat 500 times)
                 ▼
┌────────────────────────────────────────────────┐
│ 3. FINALIZE SCAN                                │
│    ├─ Sort all results by enhancedScore (desc) │
│    ├─ Count vcpBullish tickers                 │
│    ├─ Save to data/scan-results.json           │
│    ├─ Save backtest snapshot [NEW]             │
│    └─ Send completion event to frontend        │
└────────────────┬───────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────┐
│ 4. FRONTEND: Display Results                   │
│    ├─ Refresh table with new data              │
│    ├─ Show scores with color coding            │
│    ├─ Enable sorting/filtering                 │
│    └─ Display scan completion time             │
└─────────────────────────────────────────────────┘
```

---

## Scoring Calculation Flow

```
RAW DATA INPUTS
├─ Price bars (90 days OHLC + volume)
├─ SPY bars (for RS calculation)
├─ Fundamentals (EPS, margins, inst %)
└─ Industry data (rank, 1Y return)

         │
         ▼

┌─────────────────────────────────────┐
│ VCP TECHNICAL ANALYSIS (50 pts)    │
├─────────────────────────────────────┤
│                                     │
│ Progressive Contractions (15 pts)  │
│ ├─ 3+ contractions: 8 pts          │
│ ├─ Each progressive: +2 pts        │
│ └─ Max: 15 pts                     │
│                                     │
│ Volume Dry-Up (10 pts)             │
│ ├─ Pullback vol < 70% avg: 6 pts  │
│ ├─ Pullback vol < 90% avg: 4 pts  │
│ ├─ Up-day vol expansion: +2 pts    │
│ └─ Max: 10 pts                     │
│                                     │
│ MA Support (12 pts)                │
│ ├─ At 50 MA: 4 pts                 │
│ ├─ At 20 MA: 3 pts                 │
│ ├─ At 10 MA: 2 pts                 │
│ ├─ Above 50/20: 4 pts              │
│ └─ Max: 12 pts                     │
│                                     │
│ Relative Strength [NEW] (8 pts)   │
│ ├─ RS > 80: 8 pts                  │
│ ├─ RS > 70: 6 pts                  │
│ ├─ RS > 60: 4 pts                  │
│ ├─ RS > 50: 2 pts                  │
│ └─ Max: 8 pts                      │
│                                     │
│ Stage 2 Uptrend (5 pts)            │
│ ├─ Above 200 MA: 4 pts             │
│ ├─ Above 150 MA: +1 pt             │
│ └─ Max: 5 pts                      │
│                                     │
└─────────────┬───────────────────────┘
              │ VCP Score: 0-50
              ▼

┌─────────────────────────────────────┐
│ CANSLIM FUNDAMENTALS (30 pts)      │
├─────────────────────────────────────┤
│                                     │
│ Current Quarterly EPS (10 pts)     │
│ ├─ > 50% YoY: 8 pts                │
│ ├─ > 30% YoY: 6 pts                │
│ ├─ > 25% YoY: 4 pts                │
│ ├─ > 15% YoY: 2 pts                │
│ ├─ + Acceleration: +3 pts          │
│ └─ Max: 10 pts                     │
│                                     │
│ Annual EPS Growth (8 pts)          │
│ ├─ >25% + ROE >17%: 6 pts          │
│ ├─ >20% or ROE >15%: 4 pts         │
│ ├─ >15% or ROE >12%: 2 pts         │
│ └─ Max: 8 pts                      │
│                                     │
│ Operating Margins (7 pts)          │
│ ├─ Best-in-class: 7 pts            │
│ ├─ Above average: 4 pts            │
│ └─ Max: 7 pts                      │
│                                     │
│ Institutional Quality (5 pts)      │
│ ├─ >70% inst ownership: 5 pts      │
│ ├─ >50% inst ownership: 3 pts      │
│ ├─ Increasing insts: +2 pts        │
│ └─ Max: 5 pts                      │
│                                     │
└─────────────┬───────────────────────┘
              │ CANSLIM Score: 0-30
              ▼

┌─────────────────────────────────────┐
│ INDUSTRY CONTEXT (20 pts)          │
├─────────────────────────────────────┤
│                                     │
│ Industry Rank (10 pts)             │
│ ├─ Rank 1-5: 10 pts                │
│ ├─ Rank 6-10: 8 pts                │
│ ├─ Rank 11-20: 6 pts               │
│ ├─ Rank 21-40: 4 pts               │
│ ├─ Rank 41-60: 2 pts               │
│ └─ Max: 10 pts                     │
│                                     │
│ 1Y Momentum (5 pts)                │
│ ├─ >20%: 5 pts                     │
│ ├─ >10%: 3 pts                     │
│ ├─ >0%: 1 pt                       │
│ └─ Max: 5 pts                      │
│                                     │
│ 6M Acceleration (3 pts)            │
│ └─ Positive trend: 3 pts           │
│                                     │
│ Sector Rotation (2 pts)            │
│ └─ In favored sector: 2 pts        │
│                                     │
└─────────────┬───────────────────────┘
              │ Industry Score: 0-20
              ▼

┌─────────────────────────────────────┐
│ COMPOSITE CALCULATION               │
├─────────────────────────────────────┤
│                                     │
│ Base Score = VCP + CANSLIM + Ind   │
│            = (0-50) + (0-30) + (0-20)│
│            = 0-100 points           │
│                                     │
│ Industry Multiplier [NEW]:         │
│ ├─ Rank 1-20:  × 1.20 (+20%)       │
│ ├─ Rank 21-40: × 1.15 (+15%)       │
│ ├─ Rank 41-60: × 1.10 (+10%)       │
│ ├─ Rank 61-80: × 1.05 (+5%)        │
│ ├─ Rank 81+:   × 0.90 (-10%)       │
│ └─ (only if industry data available)│
│                                     │
│ Final Score = Base × Multiplier    │
│             = min(100, base × mult) │
│                                     │
│ Grade = getScoreGrade(finalScore)  │
│ ├─ 90-100: A+                      │
│ ├─ 80-89:  A                       │
│ ├─ 70-79:  B+                      │
│ ├─ 60-69:  B                       │
│ ├─ 50-59:  C+                      │
│ ├─ 40-49:  C                       │
│ ├─ 30-39:  D                       │
│ └─ 0-29:   F                       │
│                                     │
└─────────────┬───────────────────────┘
              │
              ▼

         FINAL OUTPUT
    ┌──────────────────┐
    │ enhancedScore: 96│
    │ baseScore: 80    │
    │ vcpScore: 40     │
    │ canslimScore: 24 │
    │ industryScore: 16│
    │ multiplier: 1.20 │
    │ grade: "A+"      │
    │ recommendation   │
    └──────────────────┘
```

---

## Backtesting System Flow (NEW)

```
SCAN COMPLETED
    │
    ▼
┌────────────────────────────────────┐
│ Auto-Save Backtest Snapshot        │
│                                     │
│ data/backtests/scan-2026-02-15.json│
│ {                                   │
│   scanDate: "2026-02-15",          │
│   tickers: [                       │
│     {                              │
│       ticker: "OTIS",              │
│       score: 96,                   │
│       price: 89.83,                │
│       vcpScore: 40,                │
│       industryRank: 3,             │
│       relativeStrength: 125        │
│     },                             │
│     { ... },                       │
│     { ... }                        │
│   ]                                │
│ }                                  │
└────────────────┬───────────────────┘
                 │
                 │ WAIT 30 DAYS...
                 │
                 ▼
┌────────────────────────────────────┐
│ Run Backtest Analysis              │
│                                     │
│ node scripts/run-backtest.js \     │
│   2026-02-15 30                    │
│                                     │
│ For each ticker in snapshot:       │
│ ├─ Fetch current price (30d later) │
│ ├─ Calculate return %              │
│ ├─ Calculate MFE (max gain)        │
│ ├─ Calculate MAE (max drawdown)    │
│ └─ Classify: WIN / LOSS / NEUTRAL  │
└────────────────┬───────────────────┘
                 │
                 ▼
┌────────────────────────────────────┐
│ Generate Analysis Report           │
│                                     │
│ Group by score buckets:            │
│ ├─ 90-100: 12 trades, 75% win rate│
│ ├─ 80-89:  28 trades, 64% win rate│
│ ├─ 70-79:  45 trades, 51% win rate│
│ ├─ 60-69:  31 trades, 39% win rate│
│ └─ <60:    11 trades, 27% win rate│
│                                     │
│ Industry impact:                   │
│ ├─ Top 20 ind: 68% win rate       │
│ └─ Bottom 20: 32% win rate        │
│                                     │
│ RS impact:                         │
│ ├─ RS >110: 71% win rate          │
│ └─ RS <90:  38% win rate          │
│                                     │
│ Save to:                           │
│ data/backtests/                    │
│   analysis-2026-02-15-30d.json    │
└────────────────┬───────────────────┘
                 │
                 ▼
┌────────────────────────────────────┐
│ Optimization Engine                │
│                                     │
│ IF: Backtest data shows >10% improvement │
│ THEN: Suggest weight adjustments   │
│                                     │
│ Example:                           │
│ - Industry rank highly predictive  │
│ - Increase industry weight 20→23%  │
│ - Decrease CANSLIM weight 30→27%   │
│                                     │
│ Generate recommendation report     │
│ Manual review & approval required  │
└────────────────┬───────────────────┘
                 │
                 ▼
┌────────────────────────────────────┐
│ Display in Frontend                │
│                                     │
│ /backtest page shows:              │
│ ├─ Win rates by score              │
│ ├─ Component effectiveness         │
│ ├─ Optimization recommendations    │
│ └─ Historical performance trend    │
│                                     │
│ Dashboard shows:                   │
│ ├─ Confidence scores               │
│ │  "72% win rate" badge            │
│ └─ Based on backtested data        │
└─────────────────────────────────────┘
```

---

## Technology Stack

### Runtime
- **Dev:** Single process — Express (port 5173) + Vite middleware (HMR). One command: `npm run dev`.
- **Prod:** Express serves `dist/` + API. Commands: `npm run build` then `npm run serve`.
- **Scripts / API-only:** `npm run server` (Express only, default port 3001).

### Backend
- **Runtime:** Node.js (ES modules)
- **Server:** Express.js
- **Data APIs:** Yahoo Finance (yahoo-finance2), Massive (optional)
- **Storage:** File-based JSON cache (no database required)
- **Caching:** In-memory + file cache (24hr TTL)

### Frontend
- **Framework:** React 18
- **Build Tool:** Vite
- **Routing:** React Router v6
- **Styling:** Tailwind CSS
- **Charts:** Lightweight Charts (TradingView)
- **State:** React hooks (no Redux/Context needed)

### Data Storage
- **Format:** JSON files
- **Location:** `/data` folder
- **Structure:**
  ```
  data/
  ├─ bars/              # OHLC cache per ticker
  ├─ backtests/         # Historical scan snapshots [NEW]
  ├─ scan-results.json  # Latest scan
  ├─ fundamentals.json  # Company fundamentals
  ├─ industry-yahoo-returns.json  # Industry performance
  └─ tickers.txt        # S&P 500 list
  ```

### Deployment
- **Development:** `npm run dev` — single process on **http://localhost:5173** (Express API + Vite HMR; app and `/api` on same origin).
- **Production:** Build `npm run build`, then serve with `npm run serve` (static + API from same server).
- **Vercel:** Both frontend and API deploy together. The `api/[[...path]].js` serverless handler forwards `/api/*` to the same Express app (with `VERCEL=1`, so no listen). **Limits:** (1) `data/` is not in the repo (gitignored), so deploy has no scan/fundamentals unless you commit a snapshot or use an external API. (2) Writes (POST scan, POST fundamentals/fetch) do not persist (read-only filesystem). For full scans and persistence, point **VITE_API_URL** to an external API (e.g. Railway) that runs `npm run server`.

---

## Performance Characteristics

### Scan Performance
- **500 tickers:** ~2-3 minutes with cache
- **First scan:** ~10-15 minutes (cold cache)
- **Subsequent scans:** ~2-3 minutes (hot cache)
- **Rate limiting:** 150ms delay between tickers (avoid Yahoo throttle)
- **Concurrency:** Sequential (to respect rate limits)

### Cache Strategy
- **OHLC bars:** 24-hour TTL, file-based
- **Fundamentals:** Manual refresh (Yahoo data changes rarely)
- **Industry data:** Manual refresh (weekly/monthly)
- **SPY bars:** Fetched once per scan, cached

### API Response Times
- **GET /api/scan-results:** <50ms (file read)
- **GET /api/vcp/:ticker:** 200-500ms (Yahoo API call)
- **POST /api/scan:** 2-3 minutes streaming (full scan)
- **GET /api/bars/:ticker:** <100ms (cache) or 200-500ms (Yahoo)

### Data Volume
- **Per ticker cache:** ~5-10 KB (90 days OHLC)
- **Total bars cache:** ~2.5-5 MB (500 tickers)
- **Scan results:** ~500 KB
- **Fundamentals:** ~200 KB
- **Backtest snapshots:** ~100 KB per scan
- **Total footprint:** <10 MB

---

## Security Considerations

### API Keys
- **Yahoo Finance:** No API key required (free tier)
- **Massive API:** Stored in `.env`, never exposed to frontend
- **Best practice:** Keep `.env` in `.gitignore`

### Data Validation
- **Ticker sanitization:** Remove special chars from file paths
- **Input validation:** Ticker format, date ranges
- **Error handling:** Try-catch on all API calls

### Rate Limiting
- **Yahoo Finance:** 150ms delay between requests
- **Massive API:** Follow plan limits
- **Frontend:** Throttle scan button (prevent double-clicks)

---

## Future Enhancements (Post-Initial Implementation)

### Phase 4: Advanced Features
1. **Real-time alerts:** Notify when new VCP setups appear
2. **Portfolio tracking:** Monitor positions, track performance
3. **Custom watchlists:** Save favorite tickers
4. **Export to CSV:** Download scan results
5. **Dark/light theme:** UI customization

### Phase 5: ML/AI Integration
1. **Pattern recognition:** Train model on historical VCP patterns
2. **Predictive scoring:** Use ML to optimize weights
3. **Anomaly detection:** Identify unusual setups
4. **Sentiment analysis:** Integrate news/social data

### Phase 6: Professional Features
1. **Multi-timeframe analysis:** Daily + weekly VCP
2. **Options integration:** Find high IV stocks for covered calls
3. **Earnings calendar:** Track upcoming earnings
4. **Insider trading:** Track insider buys/sells
5. **Short interest:** Identify potential squeezes

---

## Conclusion

This architecture provides:
✅ Scalable foundation (500+ stocks)
✅ Fast caching system (2-3 minute scans)
✅ Extensible scoring (easy to add new factors)
✅ Real-time UI updates (streaming scan results)
✅ Validation system (backtesting framework)
✅ No database required (simple deployment)

The three proposed improvements integrate cleanly into this architecture without requiring major refactoring.
