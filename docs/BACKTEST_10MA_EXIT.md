# Backtest 10 MA Exit Strategy with Portfolio Filtering

## Overview
Modified the backtest system to use a **10 MA exit strategy** with **portfolio size filtering**. This provides more realistic trading simulation by using actual entry and exit signals, and lets you test how concentrated vs diversified portfolios perform.

## What Changed (Latest Update)

### Portfolio Filtering Feature
**Purpose:** Test how performance changes when taking only the highest-scoring stocks vs taking all signals

**Options:**
- **All Stocks** - Test every stock from the scan (full diversification)
- **Top 10** - Only test 10 highest-scoring stocks (highly concentrated)
- **Top 50** - Only test 50 highest-scoring stocks
- **Top 100** - Only test 100 highest-scoring stocks
- **Top 200** - Only test 200 highest-scoring stocks

**How It Works:**
1. Stocks are sorted by `enhancedScore` (highest first)
2. Only the top N stocks are backtested
3. Results show if selectivity improves performance

**Use Cases:**
- Compare Top 10 vs All Stocks to see if focusing on best setups helps
- Find optimal portfolio size (concentrated vs diversified)
- Test if scoring system properly ranks stocks (top scorers should outperform)

## What Changed

### 1. Entry Signal (Buy Signal)
**Before:** Entered at the scan date price  
**After:** Wait for first buy signal after scan date
- Buy signal = price at/near 10 MA (within 2%)
- This simulates waiting for a proper entry point (pullback to support)
- If no buy signal occurs, trade is marked as "NO_SIGNAL"

### 2. Exit Strategy
**Before:** Fixed exit at X days (30/60/90 days)  
**After:** Dynamic exit based on price action
- **Exit Rule 1:** Price closes below 10 MA (trend weakening)
- **Exit Rule 2:** -8% stop loss hit (risk management)
- **Exit Rule 3:** Max hold time reached (parameter: 30/60/90 days)

### 3. New Metrics Tracked
- `entryPrice`: Actual entry price at buy signal
- `exitPrice`: Actual exit price when signal triggered
- `entryDate`: Date of entry signal
- `exitDate`: Date of exit signal
- `exitReason`: Why trade closed (BELOW_10MA, STOP_LOSS, MAX_HOLD, NO_SIGNAL)
- `daysHeld`: Actual holding period
- `outcome`: WIN, LOSS, NEUTRAL, NO_SIGNAL, NO_DATA, ERROR

### 4. Analysis Updates
- Added average hold time calculation
- Added exit reason breakdown (how many closed due to each rule)
- Added no-signal count (stocks that never gave entry signal)
- Strategy indicator (10MA_EXIT vs old fixed-time strategy)

## File Changes

### `server/backtest.js`
1. **New helper functions:**
   - `calculateSMA()`: Calculate simple moving average
   - `isPriceNearMA()`: Check if price is within 2% of MA (buy signal)

2. **Modified `calculateForwardReturns()`:**
   - Step 1: Find entry point (first time price near 10 MA after scan)
   - Step 2: Find exit point (price below 10 MA or stop loss)
   - Step 3: Calculate actual metrics from entry to exit
   - Saves results with strategy marker: `10MA_EXIT`

3. **Modified `analyzeBacktestResults()`:**
   - Exclude NO_SIGNAL trades from analysis
   - Calculate average hold time
   - Calculate exit reason breakdown
   - Add new summary metrics

### `src/pages/Backtest.tsx`
1. **Updated summary cards:**
   - Added "Strategy" indicator (10 MA Exit vs Fixed Time)
   - Added "Avg Hold Time" display
   - Added "Trades Taken" with no-signal count
   - Reorganized to 5 cards instead of 4

2. **Added exit reasons breakdown:**
   - Shows how many trades closed via each rule
   - Color coded: amber (10 MA), red (stop loss), gray (max hold)

3. **Updated "How it Works" section:**
   - Renamed to "How the 10 MA Exit Strategy Works"
   - Explains entry signal (price at 10 MA)
   - Lists exit rules clearly
   - Emphasizes dynamic vs fixed time approach

## How to Use

### Running a Backtest
1. Go to http://localhost:5173/backtest
2. Select a historical scan date
3. Set max hold time (30/60/90/180 days)
4. **NEW:** Choose portfolio size (All, Top 10, 50, 100, or 200)
5. Click "Run Backtest"

### Comparing Portfolio Sizes
**Strategy:** Run multiple backtests with different portfolio sizes to find optimal concentration

**Example Test Plan:**
```
Test 1: Top 10 stocks
Test 2: Top 50 stocks  
Test 3: Top 100 stocks
Test 4: All stocks
```

**What to Look For:**
- Does Top 10 have higher win rate than All Stocks?
- Is average return better with selectivity?
- How does risk (MAE) change with concentration?
- Are exit reasons different (more stop losses with concentration)?

### Understanding Results
- **Strategy: 10 MA Exit** - Uses new entry/exit logic
- **Portfolio Size** - Shows if filtered (e.g., "Top 10") or "All"
- **Trades Taken** - Only counts trades that got entry signal
- **Avg Hold Time** - Actual days held from entry to exit
- **Win Rate** - % of trades that hit profit target
- **Exit Reasons:**
  - **Below 10 MA** - Price fell below moving average (trend change)
  - **Stop Loss** - -8% loss hit (risk management)
  - **Max Hold** - Held for full period without other exit trigger

## Benefits of 10 MA Exit Strategy

### 1. More Realistic
- Waits for proper entry signal (pullback to MA)
- Exits when trend weakens (price below MA)
- Better reflects actual trading behavior

### 2. Better Risk Management
- -8% stop loss enforced on every trade
- Early exit when price action deteriorates
- Avoids holding losing positions for full period

### 3. Performance Insights
- Shows how long winners typically run
- Identifies if exits are premature or too late
- Helps optimize exit rules

### 4. Entry Timing Validation
- "No signal" count shows if scan timing is too early/late
- Can adjust scan criteria if many stocks never signal

## Example Interpretation

### Example 1: Testing All Stocks
```
Strategy: 10 MA Exit
Portfolio Size: All
Max Hold Days: 30
Trades Taken: 245 (55 no signal)
Avg Hold Time: 18.5d
Win Rate: 42%

Exit Reasons:
- Below 10 MA: 180 (73%)
- Stop Loss: 35 (14%)  
- Max Hold: 30 (12%)
```

**What This Tells You:**
- Most trades (73%) exit when price breaks below 10 MA
- Only 14% hit stop loss (good - MA is catching weakness first)
- Only 12% held for full 30 days (most exit earlier)
- Average winner runs 18.5 days (not full 30 days)
- 55 stocks never gave entry signal (might need looser entry criteria)

### Example 2: Comparing Portfolio Sizes
```
Top 10:      Win Rate 55%, Avg Return +8.2%, Avg Hold 21d
Top 50:      Win Rate 48%, Avg Return +5.1%, Avg Hold 19d  
Top 100:     Win Rate 44%, Avg Return +4.0%, Avg Hold 18d
All (300):   Win Rate 42%, Avg Return +3.2%, Avg Hold 18d
```

**What This Tells You:**
- Scoring system works! Top 10 significantly outperforms
- Concentration improves both win rate AND returns
- Sweet spot might be Top 10-50 (higher quality)
- Diversifying to all stocks dilutes performance
- Suggests you should be more selective in real trading

## Future Enhancements
- Add trailing stop option
- Test different MA periods (10 vs 20 vs 50)
- Add profit target exit (e.g., +20%)
- Track partial exits (scale out strategy)
- Compare 10 MA exit vs fixed time in same backtest
- Add position sizing based on score/volatility
- Multi-timeframe analysis (daily vs weekly entries)
