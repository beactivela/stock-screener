# Adaptive Momentum Strategy

## Overview

A self-learning stock trading strategy that combines:
- **Mark Minervini's VCP** (Volatility Contraction Pattern)
- **William O'Neil's CANSLIM** criteria
- **Momentum indicators** (RSI, MACD, Relative Strength)

The system includes a feedback loop that evaluates past signals and automatically optimizes parameters.

---

## 360-Day Backtest Results

| Metric | Value |
|--------|-------|
| **Starting Capital** | $100,000 |
| **Ending Capital** | $400,166 |
| **Total Return** | +300.2% |
| **Total Trades** | 557 |
| **Win Rate** | 49.9% |
| **Profit Factor** | 1.87 |
| **Max Drawdown** | 17.4% |
| **Avg Win** | +6.7% |
| **Avg Loss** | -3.2% |
| **Expectancy (R)** | 0.43 |
| **Avg Hold Time** | 9 days |

---

## Buy Signal Rules

### Mandatory Criteria (ALL must pass)

1. **Price Above 50 MA**: Stock must be trading above its 50-day simple moving average (Stage 2 uptrend)

2. **Relative Strength ≥ 50**: Stock must be outperforming at least 50% of the market over the past 3-6 months

3. **Within 35% of 52-Week High**: Stock cannot be more than 35% below its annual high

4. **At MA Support**: Price must be within 4% of one of these moving averages:
   - 10-day MA (best)
   - 21-day EMA
   - 20-day MA
   - 50-day MA

### Scoring Factors (Higher = Better)

| Factor | Points | Description |
|--------|--------|-------------|
| 3+ VCP contractions | 15 | Pattern shows 3+ volatility contractions |
| Volume dry-up | 10 | Volume decreased during consolidation |
| At 10 MA | 12 | Price at tight 10-day MA support |
| At 21 EMA | 10 | Price at 21-day exponential MA |
| At 20 MA | 8 | Price at 20-day MA support |
| RS > 90 | 15 | Top 10% relative strength |
| RS > 80 | 10 | Strong relative strength |
| Full MA alignment | 15 | 50 > 150 > 200 MA (Stage 2 confirmed) |
| Near 52w high (<10%) | 10 | Price within 10% of annual high |
| Near 52w high (<15%) | 7 | Price within 15% of annual high |
| Above 52w low (>50%) | 5 | Strong recovery from lows |
| Volume confirmation | 10 | Recent volume above average |
| MACD positive & rising | 5 | Momentum confirmation |
| RSI in sweet spot | 5 | RSI between 50-70 |

**Minimum Score: 35 points** to generate a buy signal

### Signal Quality Grades

- **A+ (90-100)**: Strongest setups - full position
- **A (80-89)**: Very strong - consider larger position
- **B+ (70-79)**: Good setup - standard position
- **B (60-69)**: Acceptable - smaller position
- **C (50-59)**: Marginal - minimum position
- **Below 50**: No signal generated

---

## Sell Signal Rules

### Exit Triggers (ANY triggers a sell)

1. **Hard Stop Loss**: Sell if position drops **4%** from entry price
   - Non-negotiable risk management
   - Triggered first to protect capital

2. **Trailing Stop**: Sell if price drops **2.25 ATR** from the highest point since entry
   - Only activates when position is profitable (>5%)
   - Locks in gains while allowing winners to run

3. **Close Below 10 MA**: Sell if stock closes below its 10-day moving average
   - Only after holding for at least 5 days
   - Primary trend-following exit

4. **Time Stop**: Exit after **90 days** maximum hold
   - Prevents capital from being tied up too long

### Exit Statistics (from backtest)

| Exit Type | % of Trades | Avg Return | Win Rate |
|-----------|-------------|------------|----------|
| Below 10 MA | 84.4% | +2.0% | 7% |
| Hard Stop | 10.6% | -8.2% | 0% |
| Trailing Stop | 5.0% | +18.5% | 39% |

**Key Insight**: The trailing stop captures the biggest winners (+18.5% avg), while the 10 MA exit produces many small wins.

---

## Position Sizing

### Risk-Based Sizing

- **Risk per trade**: 2% of account equity
- **Stop distance**: 4% (hard stop)
- **Position size** = (Account × 2%) / (Entry Price × 4%)

### Example ($100,000 account, $50 stock)

```
Risk amount = $100,000 × 2% = $2,000
Stop distance = $50 × 4% = $2
Shares = $2,000 / $2 = 1,000 shares
Position value = 1,000 × $50 = $50,000 (50% of account)
```

### Position Limits

- **Maximum position**: 15% of account
- **Maximum concurrent positions**: 10
- **Minimum position size**: $2,000

---

## Learning Loop

The system automatically analyzes completed trades and adjusts parameters:

### What It Learns

1. **Which factors predict winners**: If RS > 90 stocks win more, increase RS weight
2. **Optimal stop distances**: If stops trigger prematurely, widen them
3. **Trailing stop effectiveness**: Tighten or loosen based on MFE capture
4. **Exit timing**: Adjust MA exit rules based on results

### How To Run Learning

```bash
# Run backtest with learning enabled
node server/runBacktest360.js --learn

# Run with specific ticker count
node server/runBacktest360.js --top=500 --learn
```

### Learning Output

After running, check the adjustments:
- `/data/adaptive-strategy/learned-params.json` - Current optimized parameters
- `/data/adaptive-strategy/backtest-360d-full.json` - Full backtest results

---

## Daily Workflow

### Morning Routine

1. Run the screener to find stocks meeting entry criteria
2. Review signals sorted by confidence score
3. Filter for stocks with A or B+ grades
4. Check chart for pattern confirmation
5. Calculate position size based on account equity

### During Market Hours

1. Enter positions at market open or on pullbacks to MA
2. Set hard stop orders immediately after entry
3. Monitor for exit signals

### End of Day

1. Check which positions closed below 10 MA
2. Update stops based on new highs (trailing stop)
3. Review any positions hitting time limit

---

## Key Principles

### From Mark Minervini

- **Trade what you see, not what you think**: Follow the signals
- **Cut losses quickly, let winners run**: The 4% stop is strict
- **Tight risk, large reward**: Target 3:1+ reward-to-risk
- **Buy rising stocks**: We only buy stocks above 50 MA

### From William O'Neil

- **Buy leaders, not laggards**: RS filter ensures we buy outperformers
- **Proper base formation**: VCP/contraction detection validates setup
- **Volume dry-up on pullbacks**: Volume filter confirms accumulation

### Strategy-Specific

- **Learning improves over time**: Run learning loop monthly
- **Position sizing protects capital**: Never risk more than 2%
- **Let the math work**: A 50% win rate with 2:1 R:R is profitable

---

## Files Reference

| File | Purpose |
|------|---------|
| `server/adaptiveStrategy.js` | Core strategy engine |
| `server/runBacktest360.js` | Backtest runner script |
| `data/adaptive-strategy/learned-params.json` | Optimized parameters |
| `data/adaptive-strategy/backtest-360d-full.json` | Full backtest results |

---

## Running the Strategy

### Quick Test (100 tickers)
```bash
node server/runBacktest360.js --top=100
```

### Full Backtest (all tickers)
```bash
node server/runBacktest360.js
```

### With Learning
```bash
node server/runBacktest360.js --learn
```

### Custom Lookback Period
```bash
node server/runBacktest360.js --days=180 --top=500
```
