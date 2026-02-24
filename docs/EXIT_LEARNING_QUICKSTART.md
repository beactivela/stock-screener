# Exit Learning Agent - Quick Start Guide

## What is it?

The **Exit Learning Agent** analyzes your closed trades to understand **why trades fail vs succeed**. Unlike backtesting (which shows "what happened"), this agent reveals **why it happened** and generates actionable recommendations.

## Key Features

### 1. **Automatic Exit Classification**
- **Early Stops** (<5 days, negative) - Bad entry or false signal
- **Late Stops** (5+ days, negative) - Good entry, trend failed  
- **Small Wins** (0-5%) - Marginal win
- **Good Wins** (5-15%) - Target reached
- **Big Wins** (15%+) - Home run

### 2. **Red Flag Detection**
Identifies metrics that predict failure:
- "Early stops had RS avg 72 vs winners at 88" → **Avoid RS < 79**
- "Early stops had 10 MA slope 3.5% vs winners at 7.2%" → **Require slope >= 5%**

### 3. **Behavioral Pattern Analysis**
Tracks what happens in the first 5 days after entry:
- Days above/below 10 MA
- Max gain achieved
- Volatility
- Winners vs losers behavior differences

### 4. **Case Study Deep Dives**
Analyze specific failed trades:
- Entry conditions (price vs MA, slope, volume)
- Post-entry behavior day-by-day
- Specific failure reasons
- Lesson learned

### 5. **Conviction Accuracy**
Did your high conviction (5) trades actually perform better? Calibrate your gut feel against reality.

## Quick Start

### Prerequisites

You need at least **5 closed trades** for basic analysis (20+ ideal). Trades must be logged in the trade journal with:
- Entry date, price, metrics
- Exit date, price, return %
- Holding days

### Run Analysis

```bash
# Basic analysis (fast)
npm run exit-learning

# Full analysis with post-entry behavior (slower, more detailed)
npm run exit-learning -- --full

# Analyze specific failed trade
npm run exit-learning -- --case-study CMC 2026-02-17
```

## Example Output

### Basic Analysis

```
📊 Exit Breakdown:
   Early Stops (<5d): 12
   Late Stops (5+d): 8
   Small Wins (0-5%): 5
   Good Wins (5-15%): 18
   Big Wins (15%+): 7

🚩 Red Flags Identified:

   1. RELATIVESTRENGTH
      Early Stop Avg: 72
      Good Win Avg: 88
      Difference: 16 (22% impact)
      ➜ Avoid relativeStrength below 79

   2. MA10_SLOPE
      Early Stop Avg: 3.5%
      Good Win Avg: 7.2%
      Difference: 3.7% (106% impact)
      ➜ Avoid slope below 5%

🔑 Key Learnings:
   1. High early stop-out rate (24%) - need tighter entry filters
   2. 10 MA slope is a key predictor: early stops avg 3.5% vs winners 7.2%
   3. Winners stay above 10 MA longer in first 5 days (4.2 vs 1.5 days)

💡 Recommendations:
   1. Add filter: Require 10 MA slope >= 5%
   2. Add filter: Avoid relativeStrength below 79
   3. Consider exit rule: if price closes below 10 MA in first 3 days, exit immediately
```

### Case Study Example

```bash
npm run exit-learning -- --case-study CMC 2026-02-17
```

Output:
```
📊 Entry Conditions:
   Price: $45.23
   10 MA: $44.87 (0.8% away)  ✅ Within 2% tolerance
   10 MA Slope (14d): 3.2%    ⚠️ Below 5% threshold
   Volume: 85% of avg         ⚠️ Below 100%

❌ Failure Reasons:
   1. Weak 10 MA slope at entry: 3.2% (want 5%+)
   2. Low volume at entry: 85% of 20-day avg
   3. Broke below 10 MA on day 2 - failed to hold support

💡 Lesson Learned:
   Require 10 MA slope ≥ 5% over 14 days - weak slopes lead to 
   failed breakouts. Require volume confirmation (>100% of 20-day 
   avg) - low volume breakouts often fail.
```

## How to Use the Learnings

### Step 1: Review Red Flags

Identify metrics where early stops differ significantly from winners:
- Relative Strength (RS)
- 10 MA slope
- Pattern confidence
- Industry rank
- Contractions

### Step 2: Update Filters

Manually update `server/opus45Signal.js`:

```javascript
export const MANDATORY_THRESHOLDS = {
  minRelativeStrength: 80,  // Updated from 70
  min10MASlopePct14d: 5,    // Updated from 4
  // ...
};
```

### Step 3: Test & Iterate

- Take new trades with updated filters
- After 20+ trades, run exit learning again
- Compare new vs old results
- Are early stops decreasing?
- Is win rate improving?

### Step 4: Build Case Study Library

Every time a trade stops out, run:
```bash
npm run exit-learning -- --case-study <TICKER> <DATE>
```

This builds a knowledge base of "what went wrong" for future reference.

## API Endpoints

If you prefer to use the API directly:

### Run Full Analysis
```
POST /api/exit-learning/run?includeBehaviorAnalysis=true
```

### Get Analysis History  
```
GET /api/exit-learning/history
```

### Analyze Specific Trade
```
POST /api/exit-learning/case-study
Body: { ticker: "CMC", entryDate: "2026-02-17" }
```

## Integration with Opus4.5

The exit learning system complements the existing Opus4.5 learning pipeline:

- **Opus Learning** (`opus45Learning.js`) - Analyzes **which factors** predict success (weight optimization)
- **Exit Learning** (`exitLearning.js`) - Analyzes **why trades fail** (red flags, filters)

### Recommended Workflow

1. **Run Opus Learning** - Tune weights based on factor importance
   ```bash
   npm run exit-learning  # Not yet in scripts, but similar pattern
   ```

2. **Run Exit Learning** - Identify failure patterns
   ```bash
   npm run exit-learning
   ```

3. **Apply Both Insights**
   - Opus learning → Adjust score weights
   - Exit learning → Tighten mandatory filters
   - Combined → Better signal quality

## Files Generated

All analysis reports are saved to `data/exit-learning/`:

- `exit-analysis-YYYY-MM-DD.json` - Full analysis report
- `case-study-TICKER-YYYY-MM-DD.json` - Individual trade deep dives
- Previous reports retained for comparison over time

## Common Questions

### Q: How many trades do I need?
**A:** Minimum 5 closed trades for basic analysis. 20+ is ideal. 50+ provides highly reliable patterns.

### Q: What if I only have 2-3 closed trades?
**A:** Use case study mode to analyze individual trades:
```bash
npm run exit-learning -- --case-study <TICKER> <DATE>
```

### Q: Should I run --full every time?
**A:** No, it's slower due to API calls. Run basic analysis regularly, use --full for deep dives monthly or when you have new questions about behavior patterns.

### Q: Can I analyze a trade that's not in my journal?
**A:** Yes! Case study works with any ticker and date:
```bash
npm run exit-learning -- --case-study AAPL 2025-12-01
```

### Q: How often should I run this?
**A:** After every 10-20 new closed trades. This gives fresh data without over-optimizing.

### Q: What if red flags contradict each other?
**A:** Look at sample sizes and impact %. Focus on flags with:
- Large sample size (10+ trades in each category)
- High impact (20%+ difference)
- Makes logical sense (aligns with Minervini/CANSLIM principles)

## Real Example: Learning from the LMT Trade

Let's analyze a real trade from the current journal:

```bash
npm run exit-learning -- --case-study LMT 2026-01-02
```

**Result:**
- Entry: $497.07
- Exit: $581 (+19.1% winner)
- Entry was 2.8% from 10 MA (slightly extended)
- Volume was only 87% of average (weak)

**Post-Entry Behavior:**
- Stayed above 10 MA all 10 days ✅
- Showed immediate momentum (+2.92% day 1) ✅
- Volume surged after entry ✅

**Lesson:** Even "marginal" setups can work if momentum takes over. However, the ideal entry would have been:
- Closer to 10 MA (within 2%)
- On higher volume (100%+ of average)

This is a great example of understanding **setup quality** vs **outcome**. The trade worked despite warning signs, but tighter entries would improve the risk/reward ratio.

## Next Steps

1. **Log Your Next 10 Trades** - Get to the 5+ threshold
2. **Run Basic Analysis** - Identify initial patterns
3. **Apply 1-2 Filters** - Don't overfit, be selective
4. **Log 20 More Trades** - Test if filters improved results
5. **Run Full Analysis** - Deep dive into behavioral patterns
6. **Iterate** - Continuous improvement cycle

## Full Documentation

For complete technical details, see:
- [EXIT_LEARNING.md](./EXIT_LEARNING.md) - Comprehensive documentation
- [Server code](../server/exitLearning.js) - Implementation details
- [CLI script](../scripts/run-exit-learning.js) - Usage examples

## Support

If you encounter issues:
1. Check you have sufficient closed trades (5+ minimum)
2. Verify trade data has all required fields (entryDate, exitDate, returnPct, holdingDays)
3. For case studies, verify ticker and date are valid
4. Check API rate limits if behavior analysis is failing

---

**Remember:** The goal isn't perfection - it's continuous improvement. Every failed trade is a learning opportunity. The Exit Learning Agent helps you extract maximum value from those lessons.
