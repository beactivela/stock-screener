# Exit Learning Agent

## Overview

The Exit Learning Agent is an advanced analysis system that learns from **why trades fail vs succeed**. Unlike traditional backtesting that only shows overall win rates, this agent digs deep into the characteristics of losing trades to identify red flags and improve future signal quality.

## Key Questions It Answers

1. **What indicators predict early stop-outs (<5 days)?**
   - Identifies metrics that differ significantly between quick failures and successful trades
   - Example: "Early stops had 10 MA slope of 3.5% vs winners at 7.2%"

2. **What MA/volume patterns distinguish winners from losers?**
   - Analyzes post-entry behavior in the first 5 days
   - Tracks days above 10 MA, max gain, and volatility

3. **Which entry metrics correlate with hold time?**
   - Determines if high RS, tight contractions, or strong slope lead to longer holds
   - Helps optimize for trades that "have legs"

4. **Are there setup patterns that consistently fail?**
   - Segments by VCP quality, industry rank, institutional ownership
   - Finds combinations that look good on paper but fail in practice

## How It Works

### 1. **Exit Categorization**

Trades are automatically classified into 5 categories:

```
EARLY_STOP (< 5 days, negative)  → Bad entry or false signal
LATE_STOP (5+ days, negative)    → Good entry but trend failed
SMALL_WIN (0-5% profit)          → Marginal win, maybe exit too early?
GOOD_WIN (5-15% profit)          → Target reached
BIG_WIN (15%+ profit)            → Home run trade
```

### 2. **Metric Analysis**

For each category, the agent calculates:
- Average values for all entry metrics (contractions, RS, slope, industry rank, etc.)
- Median, min, max to understand distribution
- Comparison between categories to find predictive differences

### 3. **Red Flag Identification**

A "red flag" is a metric where:
- Early stops have significantly different values than good wins (>15% difference)
- Sample size is sufficient (5+ trades in each category)

Example red flag:
```json
{
  "metric": "relativeStrength",
  "earlyStopAvg": 72,
  "goodWinAvg": 88,
  "difference": 16,
  "differencePct": 22,
  "recommendation": "Avoid relativeStrength below 79"
}
```

### 4. **Post-Entry Behavior Analysis** (Optional, Slower)

For each trade, the agent:
- Fetches historical bars for 5 days after entry
- Calculates how many days price stayed above 10 MA
- Measures max gain in first 5 days
- Computes volatility (standard deviation of daily returns)

This reveals **behavioral patterns**:
- Winners typically stay above 10 MA for 4-5 days
- Winners show immediate momentum (2-3% gain in first 2 days)
- Losers often break 10 MA support within 2 days

### 5. **Conviction Analysis**

Compares user conviction ratings (1-5) with actual outcomes:
- Do high conviction (5) trades actually perform better?
- Are there conviction levels with poor win rates?
- What's the average hold time by conviction?

This helps calibrate your "gut feel" against reality.

## Usage

### Run Full Exit Learning

```bash
npm run exit-learning
```

This runs the basic analysis (fast):
- Categorizes all closed trades
- Analyzes metrics by exit type
- Identifies red flags
- Generates recommendations

**Output:**
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
```

### Run Full Analysis (Includes Behavior)

```bash
npm run exit-learning -- --full
```

This includes post-entry behavior analysis (slower due to API calls):
- All basic analysis
- Plus: analyzes first 5 days after entry for each trade
- Compares winner vs loser behavior patterns

**Output includes:**
```
⏱️  Post-Entry Behavior (First 5 Days):

   WINNERS:
      Days Above 10 MA: 4.2
      Max Gain: 3.8%
      Volatility: 1.2%
      Sample Size: 18

   LOSERS:
      Days Above 10 MA: 1.5
      Max Gain: 0.8%
      Volatility: 2.3%
      Sample Size: 12
```

### Analyze Specific Failed Trade (Case Study)

```bash
npm run exit-learning -- --case-study CMC 2026-02-17
```

This performs a deep dive into why a specific trade failed:
- Retrieves historical bars from 60 days before to 30 days after entry
- Analyzes entry conditions (price vs MA, slope, volume)
- Tracks what happened in the 10 days after entry
- Identifies specific failure reasons
- Generates lesson learned

**Example Output:**
```
📊 Entry Conditions:
   Price: $45.23
   10 MA: $44.87 (0.8% away)
   10 MA Slope (14d): 3.2%
   Volume: 85% of avg

❌ Failure Reasons:
   1. Weak 10 MA slope at entry: 3.2% (want 5%+)
   2. Low volume at entry: 85% of 20-day avg
   3. Broke below 10 MA on day 2 - failed to hold support

💡 Lesson Learned:
   Require 10 MA slope ≥ 5% over 14 days - weak slopes lead to 
   failed breakouts. Require volume confirmation (>100% of 20-day 
   avg) - low volume breakouts often fail.
```

## API Endpoints

### `POST /api/exit-learning/run`

Run the complete exit learning pipeline.

**Query Params:**
- `includeBehaviorAnalysis=true` - Include post-entry behavior analysis (optional, slower)

**Response:**
```json
{
  "summary": {
    "analysisDate": "2026-02-19T...",
    "totalTradesClosed": 50,
    "overallWinRate": 64,
    "earlyStopRate": 24,
    "avgHoldTime": 8.3
  },
  "categories": { ... },
  "redFlags": [ ... ],
  "convictionAnalysis": { ... },
  "behaviorAnalysis": { ... },
  "keyLearnings": [ ... ],
  "recommendations": [ ... ]
}
```

### `GET /api/exit-learning/history`

Get previous exit learning runs.

**Response:**
```json
{
  "history": [
    {
      "filename": "exit-analysis-2026-02-19.json",
      "date": "2026-02-19T...",
      "summary": { ... }
    }
  ],
  "count": 1
}
```

### `POST /api/exit-learning/case-study`

Analyze a specific failed trade.

**Body:**
```json
{
  "ticker": "CMC",
  "entryDate": "2026-02-17"
}
```

**Response:**
```json
{
  "ticker": "CMC",
  "entryDate": "2026-02-17",
  "entryAnalysis": { ... },
  "postEntryBehavior": [ ... ],
  "failureReasons": [ ... ],
  "verdict": "Setup had warning signs",
  "lessonLearned": "..."
}
```

## Integration with Opus4.5

The exit learning system is designed to work seamlessly with the existing Opus4.5 learning pipeline:

1. **Complementary Learning:**
   - `opus45Learning.js` - Analyzes **which factors** predict success (factor importance, weight optimization)
   - `exitLearning.js` - Analyzes **why trades fail** (red flags, behavioral patterns)

2. **Shared Data:**
   - Both systems read from the same trade journal (`trades.json` or Supabase `trades` table)
   - Exit learning provides more granular, exit-focused insights

3. **Different Use Cases:**
   - Use Opus learning for **weight tuning** (e.g., "increase slope weight from 15 to 20")
   - Use exit learning for **filter tightening** (e.g., "require RS >= 80 instead of 70")

## Example Workflow

### Step 1: Log Your Trades

As you take trades, log them in the trade journal:
```bash
# Via API or UI
POST /api/trades
{
  "ticker": "CMC",
  "entryDate": "2026-02-17",
  "entryPrice": 45.20,
  "conviction": 4,
  "notes": "Strong VCP, at 10 MA",
  "entryMetrics": { ... }
}
```

### Step 2: Let Trades Play Out

The system will auto-check for exits based on:
- 4% stop loss hit
- Price closes below 10 MA

Or manually close trades when you exit:
```bash
POST /api/trades/:id/close
{
  "exitPrice": 43.50,
  "exitDate": "2026-02-19",
  "exitNotes": "Stopped out"
}
```

### Step 3: Accumulate Data

Wait until you have **at least 20 closed trades** (ideally 50+) for meaningful analysis.

### Step 4: Run Exit Learning

```bash
# Quick analysis
npm run exit-learning

# Or full analysis with behavior
npm run exit-learning -- --full
```

### Step 5: Review & Apply Learnings

The system will generate:
- **Red Flags**: Metrics that predict failure
  - Example: "Avoid RS < 79"
  - Example: "Require 10 MA slope >= 5%"

- **Behavioral Patterns**: What winners do differently
  - Example: "Winners stay above 10 MA for 4+ days"
  - Example: "If no gain by day 3, exit"

- **Recommendations**: Actionable filters to apply
  - Example: "Add filter: Require 10 MA slope >= 5%"
  - Example: "Consider exit rule: if price closes below 10 MA in first 3 days, exit immediately"

### Step 6: Update Opus4.5 Filters

Manually update the mandatory thresholds in `server/opus45Signal.js`:

```javascript
export const MANDATORY_THRESHOLDS = {
  minRelativeStrength: 80,  // Updated from 70 based on exit learning
  min10MASlopePct14d: 5,    // Updated from 4 based on exit learning
  // ...
};
```

Or adjust weights based on combined insights from both learning systems.

### Step 7: Iterate

Repeat the process as you accumulate more trades. The system learns continuously.

## Case Study Example: CMC Trade

Let's say you took a trade on CMC on Feb 17, 2026 and it stopped out on Feb 19. Here's how to learn from it:

```bash
npm run exit-learning -- --case-study CMC 2026-02-17
```

**Analysis Output:**

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

📈 Post-Entry Behavior:
   Day 1: +0.3%, above 10 MA, volume 90%
   Day 2: -1.8%, broke below 10 MA, volume 120%
   Day 3: -2.9%, stopped out

💡 Lesson Learned:
   This trade had TWO warning signs at entry:
   1. 10 MA slope was only 3.2% (too weak for sustained breakout)
   2. Volume was below average (lack of institutional demand)
   
   The breakdown on day 2 confirmed the setup was flawed.
   
   Going forward:
   - Only take entries with 10 MA slope >= 5%
   - Require volume >= 100% of 20-day avg for confirmation
   - If trade breaks 10 MA in first 2 days, exit immediately (don't wait for 4% stop)
```

## Best Practices

### 1. **Data Quality Matters**

The system is only as good as your trade journal:
- Log trades **immediately** after entry (capture all entry metrics)
- Be honest about exits (don't cherry-pick data)
- Add notes about your decision-making process

### 2. **Wait for Sufficient Sample Size**

- Minimum: 20 closed trades
- Ideal: 50+ closed trades
- More data = more reliable patterns

### 3. **Focus on Conviction 4-5 Trades**

If you're logging many speculative trades (conviction 1-2), the learnings may be diluted. Focus analysis on trades where you followed your best setups.

### 4. **Run Case Studies on Every Stopped Trade**

Don't just run the aggregate analysis. When a trade stops out, immediately run:
```bash
npm run exit-learning -- --case-study <TICKER> <DATE>
```

This builds a library of "lessons learned" from each failure.

### 5. **Compare with Opus Learning**

Run both systems and look for **convergent insights**:
- If exit learning says "avoid RS < 80" and Opus learning says "increase RS weight" → strong signal
- If they disagree, investigate why (may reveal nuances)

### 6. **Update Filters Incrementally**

Don't overfit to recent data. If exit learning suggests 5 new filters, implement 1-2 at a time and observe results.

### 7. **Track Changes Over Time**

The system saves all analyses to `data/exit-learning/`. Compare reports over time:
- Are your early stop rates improving?
- Are the same red flags appearing repeatedly?
- Are your conviction ratings getting more accurate?

## Files Generated

All exit learning data is saved to `data/exit-learning/`:

- `exit-analysis-YYYY-MM-DD.json` - Full analysis report
- `case-study-TICKER-YYYY-MM-DD.json` - Individual trade analysis
- Previous analyses are retained for comparison

## Technical Details

### Exit Classification Logic

```javascript
if (returnPct <= 0) {
  // Loser
  if (holdingDays < 5) {
    category = 'EARLY_STOP'  // Bad entry
  } else {
    category = 'LATE_STOP'   // Trend failed
  }
} else {
  // Winner
  if (returnPct < 5) {
    category = 'SMALL_WIN'
  } else if (returnPct < 15) {
    category = 'GOOD_WIN'
  } else {
    category = 'BIG_WIN'
  }
}
```

### Red Flag Detection

A metric is flagged if:
1. Both early stops and good wins have 5+ samples
2. Difference between averages is >15%
3. The difference is meaningful for trading (e.g., RS 72 vs 88 is actionable)

### Behavior Analysis Rate Limiting

To avoid Yahoo Finance API rate limits:
- Max 20 winners analyzed
- Max 20 losers analyzed
- 200ms delay between API calls

If you need to analyze more, run multiple times over several days.

## Troubleshooting

### "Insufficient data" Error

You need at least 5 closed trades for basic analysis, 20+ for reliable patterns.

**Solution:** Keep logging trades until you hit the minimum.

### "No bar data" for Case Study

The ticker may not have enough historical data, or the date is invalid.

**Solution:** 
- Verify the ticker and date are correct
- Check if the stock was actively trading on that date
- Try a different date close to the entry

### Behavior Analysis Too Slow

If `--full` mode takes too long (50+ trades), it's making many API calls.

**Solution:**
- Run basic analysis first (`npm run exit-learning`)
- Run full analysis on weekends or off-hours
- Or analyze specific trades with case studies instead

### Red Flags Don't Make Sense

If a red flag seems counterintuitive (e.g., "higher RS predicts failure"), check:
- Sample size - may be too small
- Outliers - one big winner/loser skewing the average
- Market conditions - were all early stops during a correction?

**Solution:** Review the raw `metricAnalysis` data in the JSON report.

## Future Enhancements

Potential additions to the exit learning system:

1. **Market Regime Correlation**
   - Segment exits by market regime (bull/bear/volatile)
   - Identify setups that only work in certain conditions

2. **Industry-Specific Patterns**
   - Do tech stocks behave differently than industrials?
   - Which industries have higher early stop rates?

3. **Seasonal Analysis**
   - Do certain times of year produce more failures?
   - January effect, September weakness, etc.

4. **Exit Optimization**
   - Analyze if current 4% stop is optimal
   - Test trailing stops vs fixed stops
   - Identify when to take profits early vs hold

5. **Machine Learning Integration**
   - Train a classifier to predict "will this trade stop out?"
   - Use entry metrics to score trade quality before entry
   - Real-time risk assessment

## Conclusion

The Exit Learning Agent is a powerful tool for understanding **why your trades fail**. By systematically analyzing losing trades, you can:

1. Identify flawed entry criteria
2. Tighten filters to avoid future failures
3. Recognize behavioral patterns (breaking 10 MA early = red flag)
4. Calibrate your conviction ratings
5. Build a library of "lessons learned" from each mistake

Combined with the Opus4.5 scoring system and the existing learning pipeline, you have a complete feedback loop:

**Opus Signals** → **Take Trade** → **Log Entry** → **Track Exit** → **Learn from Outcome** → **Improve Filters** → **Better Signals**

This continuous improvement cycle is the key to developing a profitable, repeatable trading edge.
