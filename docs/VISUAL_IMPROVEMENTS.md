# Visual Dashboard Improvements

## Current Dashboard State (as of 2/15/2026)

### What's Visible Now
- ✅ Score (0-100 range)
- ✅ Close price
- ✅ Contractions count
- ✅ MA indicators (10/20/50)
- ✅ % Held by Institutions
- ✅ Quarterly Earnings YoY
- ✅ Profit/Operating Margins
- ✅ Industry 1Y/6M/3M/YTD performance (TradingView)

### Current Top Performers
Based on the screenshot, current top stocks include:
- **BA** (Boeing): 100/100 score, 4 contractions, at 10+20 MA, +50.6% industry 1Y
- **GE**: 100/100 score, 6 contractions, at 10 MA
- **III**: 100/100 score, 5 contractions, at 20 MA
- **LHX**: 100/100 score, 6 contractions, at 10+20 MA
- **NOC**: 100/100 score, 5 contractions, at 10 MA
- **OTIS**: 100/100 score, 5 contractions, at 10+20+50 MA (BEST setup)

### Issues with Current Scoring

1. **All top stocks show 100/100** - No differentiation
   - OTIS has all 3 MAs (stronger) but same score as others
   - Industry performance not factored into score
   - No relative strength component

2. **Industry performance disconnected from score**
   - BA is in Aerospace (+50.6% 1Y) but scores same as NOC
   - No way to see which industry is strongest
   - Industry data is just informational, not actionable

3. **Missing key data points**
   - No Relative Strength vs SPY column
   - No industry rank (1-136)
   - No confidence level based on backtesting

---

## Proposed Dashboard After Improvements

### New Column Layout

```
| Ticker | Score | RS | Ind. Rank | Close | Contr. | 10MA | 20MA | 50MA | % Inst | Qtr EPS | Ind. 1Y | Confidence |
```

### What Each New Column Means

**RS (Relative Strength vs SPY)**
- Value: 50-200 (100 = matching SPY)
- Color coding:
  - Green (>110): Outperforming market significantly
  - Yellow (100-110): Slightly outperforming
  - Red (<100): Underperforming market

**Ind. Rank (Industry Rank out of 136)**
- Value: #1 - #136
- Color coding:
  - Bright Green (#1-20): Top 15% industries, +20% score boost
  - Green (#21-40): Top 30% industries, +15% boost
  - Yellow (#41-80): Top 60% industries, +5-10% boost
  - Gray (#81-100): Neutral
  - Red (#101-136): Bottom industries, -10% penalty

**Confidence (Backtested Win Rate)**
- Value: 0-100% (based on historical performance of this score range)
- Shows: "65% win" for 90+ scores (if historically 65% became winners)
- Only appears after 30 days of backtesting data

---

## Example: How Scores Will Change

### Current State (All 100/100)
```
Ticker  Score  Close   Contr.  10MA  20MA  50MA  Ind. 1Y
────────────────────────────────────────────────────────
OTIS    100    89.83   5       ✅    ✅    ✅    +49.8%
BA      100    242.96  4       ✅    ✅    –     +50.6%
GE      100    315.41  6       ✅    –     –     +50.6%
APH     100    146.72  8       –     ✅    –     +30.9%
```

### After Improvements (With Industry Multiplier + RS)
```
Ticker  Score  RS    Ind.Rank  Close   Contr.  10MA  20MA  50MA  Ind. 1Y  Confidence
──────────────────────────────────────────────────────────────────────────────────────
OTIS    96     125   #3        89.83   5       ✅    ✅    ✅    +49.8%   72% win
BA      92     118   #3        242.96  4       ✅    ✅    –     +50.6%   68% win  
GE      88     112   #3        315.41  6       ✅    –     –     +50.6%   65% win
APH     84     95    #8        146.72  8       –     ✅    –     +30.9%   58% win
CVX     67     82    #87       183.74  7       ✅    –     –     -30.9%   38% win
```

### Why Scores Changed

**OTIS: 100 → 96**
- Base score: 80/100 (strong VCP, all MAs)
- RS boost: +5 (RS 125 = strong outperformance)
- Industry multiplier: x1.20 (rank #3 = top industry)
- Final: 85 x 1.20 = 102 → capped at 96 (reserve 100 for perfect setups)

**BA: 100 → 92**
- Base score: 77/100 (good VCP, 2 MAs)
- RS boost: +3 (RS 118)
- Industry multiplier: x1.20 (rank #3)
- Final: 80 x 1.20 = 96 → rounded to 92

**GE: 100 → 88**
- Base score: 74/100 (decent VCP, 1 MA)
- RS boost: +2 (RS 112)
- Industry multiplier: x1.20 (rank #3)
- Final: 76 x 1.20 = 91 → rounded to 88

**APH: 100 → 84**
- Base score: 75/100 (good VCP, 1 MA)
- RS penalty: -5 (RS 95 = underperforming)
- Industry multiplier: x1.15 (rank #8 = still top tier)
- Final: 70 x 1.15 = 81 → rounded to 84

**CVX: Was not in top results → Now appears lower**
- Base score: 75/100 (decent VCP)
- RS penalty: -8 (RS 82 = significantly underperforming)
- Industry multiplier: x0.90 (rank #87 = weak industry, penalty applied)
- Final: 67 x 0.90 = 60 → poor ranking despite technical setup

---

## Score Breakdown Tooltip (On Hover)

### Current State
When hovering over score, shows:
```
✓ VCP Bullish (contractions + at MA)      +50pts
✓ 5 contractions                          +25pts
✓ Price at 20 MA (within 2%)              +5pts
✓ Price above 50 SMA                      +10pts
✓ Volume drying up on pullbacks           +10pts
────────────────────────────────────────────────
Total: 100/100
```

### After Improvements
When hovering over score, shows:
```
VCP TECHNICAL (40 pts max):
  ✓ Progressive contractions (5 total)    +15pts
  ✓ Volume dry-up (<85% avg)              +10pts
  ✓ MA support (20+50 MA)                 +8pts
  ✓ Relative Strength (125 vs SPY)       +7pts
                                          ─────
  VCP Subtotal:                           40pts

CANSLIM FUNDAMENTALS (30 pts max):
  ✓ Qtr EPS growth (11% YoY)              +4pts
  ✗ Annual EPS growth (no data)           +0pts
  ✓ ROE & margins (strong)                +6pts
  ✓ Institutional quality (93%)           +5pts
                                          ─────
  CANSLIM Subtotal:                       15pts

INDUSTRY CONTEXT (20 pts max):
  ✓ Industry rank #3 of 136               +10pts
  ✓ 1Y momentum (+49.8%)                  +5pts
  ✓ 6M acceleration (+19.7%)              +3pts
  ✓ Sector rotation (strong)              +2pts
                                          ─────
  Industry Subtotal:                      20pts

BASE SCORE: 75/100

INDUSTRY MULTIPLIER:
  Top 5 industry (rank #3) → +20% boost
  
FINAL SCORE: 75 × 1.20 = 90 → 96/100

────────────────────────────────────────────────
BACKTESTED CONFIDENCE:
  Stocks scoring 90-100 have 72% win rate over 30 days
  Average return: +18.4% | Max drawdown: -3.1%
```

---

## Filter Panel Improvements

### Current State
```
[All] [10 MA] [20 MA] [50 MA] [10+20+50]
```

### After Improvements
```
Score Range:
  [90-100] [80-89] [70-79] [60-69] [All Scores]

Moving Averages:
  [All] [10 MA] [20 MA] [50 MA] [10+20+50]

Industry Rank:
  [Top 20] [Top 40] [Top 80] [All Industries]

Relative Strength:
  [Leaders (>110)] [Market Pace (90-110)] [Laggards (<90)] [All RS]

Quick Filters:
  [🏆 Best Setups] (90+ score, top 20 industry, RS >110)
  [⚠️ Watch List] (70-89 score, any industry)
  [❌ Avoid] (<60 score or weak industry)
```

---

## Charts View Enhancement

### Current State
Small chart cards showing 6-month price + MAs

### After Improvements
Each chart card shows:

```
┌─────────────────────────────────────┐
│ OTIS           Score: 96/100  ↑125  │ ← Ticker, Score, RS
│ Otis Worldwide      Industry: #3   │ ← Company, Industry rank
├─────────────────────────────────────┤
│                                     │
│        📈 Chart with MAs           │ ← Price chart
│                                     │
├─────────────────────────────────────┤
│ ✅ 5 Contractions  ✅ Vol Dry-up   │ ← Key signals
│ ⚠️ 3MA Support     ✅ Top Industry │
├─────────────────────────────────────┤
│ 30-day: +12.3% (backtest avg)      │ ← Expected return
│ Win Rate: 72% | Confidence: HIGH   │ ← Confidence
└─────────────────────────────────────┘
```

---

## Industry Dashboard Enhancement

### Current State (Industry Page)
Lists all industries with 1Y/6M/3M/YTD returns

### After Improvements (Industry Page)

```
┌────────────────────────────────────────────────────────┐
│ INDUSTRY PERFORMANCE DASHBOARD                         │
├────────────────────────────────────────────────────────┤
│                                                         │
│ 🔥 TOP INDUSTRIES (Momentum Leaders)                   │
│                                                         │
│  Rank  Industry                    1Y      6M     3M   │
│  ────────────────────────────────────────────────────  │
│  #1    Semiconductor Eq. & Mat.   +112.3%  +42.3%  +16.5%  [12 stocks] │
│  #2    Solar                      +61.2%   +35.2%  +10.6%  [8 stocks]  │
│  #3    Aerospace & Defense        +50.6%   +19.7%  +15.5%  [45 stocks] │
│  #4    Electronic Components      +49.8%   +42.2%  +14.1%  [22 stocks] │
│  #5    Scientific Instruments     +26.7%   +22.2%  +16.5%  [18 stocks] │
│                                                         │
│ 📊 INDUSTRY ROTATION ANALYSIS                          │
│  • 🟢 STRONG UPTRENDS (15 industries, +30% 1Y avg)     │
│  • 🟡 MODERATE UPTRENDS (42 industries, +10-30% 1Y)   │
│  • 🔴 WEAK/DECLINING (79 industries, <+10% 1Y)         │
│                                                         │
│ 🎯 BEST SECTOR ROTATION OPPORTUNITIES                  │
│  Technology → +45.2% avg (semiconductors leading)      │
│  Industrials → +28.7% avg (aerospace leading)          │
│  Energy → -12.4% avg (avoid until rotation)            │
│                                                         │
│ ⚡ STOCKS IN TOP 20 INDUSTRIES                         │
│  [View 127 stocks in leading industries →]            │
│                                                         │
└────────────────────────────────────────────────────────┘
```

---

## Backtesting Dashboard (New Page)

### `/backtest` route

```
┌────────────────────────────────────────────────────────┐
│ BACKTESTING PERFORMANCE                                 │
├────────────────────────────────────────────────────────┤
│                                                         │
│ 📊 SCORING SYSTEM VALIDATION                           │
│                                                         │
│ Last 90 Days Performance (30-day forward returns):     │
│                                                         │
│  Score Range  Trades  Win Rate  Avg Return  Best  Worst│
│  ──────────────────────────────────────────────────────│
│  90-100       12      75.0%     +18.4%      +42%  -8%  │
│  80-89        28      64.3%     +12.7%      +39%  -9%  │
│  70-79        45      51.1%     +6.8%       +29%  -12% │
│  60-69        31      38.7%     -2.3%       +24%  -15% │
│  <60          11      27.3%     -5.7%       +15%  -19% │
│                                                         │
│ ✅ SCORING SYSTEM VALIDATED                            │
│  • Higher scores = Higher win rates (correlation: 0.89)│
│  • Top 20% of scores average +15.6% returns            │
│  • Scores 80+ are 2.4x more likely to win              │
│                                                         │
│ 📈 INDUSTRY IMPACT ANALYSIS                            │
│  • Top 20 industries: 68% win rate                     │
│  • Bottom 20 industries: 32% win rate                  │
│  • Industry rank adds +12% average to win rate         │
│                                                         │
│ 🎯 RELATIVE STRENGTH IMPACT                            │
│  • RS >110: 71% win rate                               │
│  • RS 90-110: 52% win rate                             │
│  • RS <90: 38% win rate                                │
│  • RS is highly predictive (+18% win rate difference)  │
│                                                         │
│ 💡 RECOMMENDATIONS                                      │
│  ✓ Focus on scores 80+ (64%+ win rate)                │
│  ✓ Prioritize top 40 industries (15-20% boost)        │
│  ✓ Require RS >100 for high-confidence trades          │
│  ⚠️ Avoid scores <60 in bottom-half industries         │
│                                                         │
│ 🔄 LAST OPTIMIZATION: 2026-02-01                       │
│  • VCP weight: 50% → 52% (+2% improvement)            │
│  • Industry weight: 20% → 23% (+15% win rate)         │
│  • Overall performance: +8.4% average return increase  │
│                                                         │
│ [View Detailed Backtest History →]                     │
│ [Export Performance Report →]                          │
│                                                         │
└────────────────────────────────────────────────────────┘
```

---

## Mobile Responsive View

### Current State
Dashboard works but requires horizontal scrolling on mobile

### After Improvements
Card-based layout for mobile:

```
┌─────────────────────┐
│ OTIS    Score: 96   │
│ ───────────────     │
│ RS: 125  Rank: #3   │
│ $89.83  ↑+2.4%      │
│                     │
│ ✅ 5 Contractions   │
│ ✅ All MAs          │
│ ✅ Top Industry     │
│                     │
│ Confidence: 72%     │
│ [View Details →]    │
└─────────────────────┘

┌─────────────────────┐
│ BA      Score: 92   │
│ ───────────────     │
│ RS: 118  Rank: #3   │
│ $242.96  ↑+1.8%     │
│                     │
│ ✅ 4 Contractions   │
│ ✅ 2 MAs            │
│ ✅ Top Industry     │
│                     │
│ Confidence: 68%     │
│ [View Details →]    │
└─────────────────────┘
```

---

## Summary of Visual Changes

### What Gets Added
1. **RS column** - Shows 50-200 value with green/yellow/red
2. **Industry Rank column** - Shows #1-136 with color coding
3. **Confidence column** - Shows "72% win" based on backtesting
4. **Industry multiplier indicator** - Small badge showing +20% boost
5. **Enhanced tooltips** - Full score breakdown on hover
6. **New filter options** - Score range, industry rank, RS filters
7. **Backtesting dashboard** - New page showing performance validation
8. **Mobile cards** - Responsive layout for small screens

### What Gets Better
1. **Score differentiation** - No more "100/100" for everything
2. **Actionable insights** - Clear which stocks to prioritize
3. **Confidence indicators** - Know which setups actually work
4. **Industry context** - See why a stock is ranked high/low
5. **Performance tracking** - Prove the system works over time

---

## Implementation Timeline

**Week 1**: Add RS and Industry Rank columns (backend + frontend)
**Week 2**: Implement industry multiplier, update scoring
**Week 3**: Add backtesting foundation, start collecting data
**Week 4**: Build backtest dashboard, show initial results
**Week 5+**: Continuous optimization based on backtesting data

After 30-60 days, you'll have proof your system works and confidence scores to guide your decisions!
