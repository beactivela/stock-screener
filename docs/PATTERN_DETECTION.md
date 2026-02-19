# Pattern Detection Implementation

## Summary

Added comprehensive pattern detection to identify which Minervini setup has formed for each stock, displayed next to the score in the UI.

## What Was Added

### 1. Pattern Detection Module (`server/patternDetection.js`)

Detects three Minervini base patterns with confidence scoring (0-100%):

#### **VCP (Volatility Contraction Pattern)**
- **Criteria:**
  - 3-4+ tightening pullbacks (each smaller than previous)
  - 10-15 week minimum duration
  - Volume dries up on pullbacks
  - Price above 200-day MA (Stage 2)
- **Scoring:**
  - Contractions: 35 points max
  - Volume dry-up: 25 points max
  - Above 200-day MA: 20 points max
  - Base duration: 20 points max
- **Detection threshold:** 60+ points

#### **Flat Base**
- **Criteria:**
  - Tight 5-20% range for 5+ weeks
  - Forms after 30%+ move
  - Within 15% of 52-week high
  - Low volatility (no wild swings)
- **Scoring:**
  - Tight range: 40 points max
  - Duration: 20 points max
  - Near 52-week high: 30 points max
  - Low volatility: 10 points max
- **Detection threshold:** 60+ points and <20% range

#### **Cup-with-Handle**
- **Criteria:**
  - U-shaped base (7-65 weeks)
  - Depth 12-33% (deeper OK in bear markets)
  - Handle forms (1-4 weeks) after right side
  - Handle depth 8-12% max
  - Rounded bottom (not V-shaped)
- **Scoring:**
  - Cup depth: 30 points max
  - U-shape (not V): 25 points max
  - Handle: 30 points max
  - Duration: 15 points max
- **Detection threshold:** 60+ points

### 2. Integration with VCP Scanner

**Updated `server/vcp.js`:**
- Added pattern detection to `checkVCP()` function
- Returns pattern name, confidence score, and detailed analysis
- Pattern detection runs automatically on every scan

**New fields in scan results:**
```javascript
{
  pattern: "VCP" | "Flat Base" | "Cup-with-Handle" | "None",
  patternConfidence: 0-100,
  patternDetails: "Detailed analysis string"
}
```

### 3. UI Integration

**Updated `src/pages/Dashboard.tsx`:**
- Added "Setup" column next to Score column
- Pattern badges with color coding:
  - **VCP:** Sky blue badge
  - **Flat Base:** Purple badge  
  - **Cup-with-Handle (C&H):** Emerald green badge
- Shows confidence percentage
- Hover shows full pattern details
- Sortable by pattern name or confidence

## Pattern Distribution (from latest scan)

```
Flat Base:           200 stocks (40%)
None:                193 stocks (39%)
VCP:                  57 stocks (11%)
Cup-with-Handle:      50 stocks (10%)
```

## Example Stocks with Patterns

1. **BA:** Cup-with-Handle (75% confidence) - Score: 78
2. **CMI:** Flat Base (75% confidence) - Score: 72
3. **AKAM:** VCP (70% confidence) - Score: 72
4. **LMT:** VCP (70% confidence) - Score: 72
5. **HII:** VCP (70% confidence) - Score: 71
6. **GE:** Flat Base (75% confidence) - Score: 70

## How It Works

### Pattern Detection Algorithm

1. **Analyze price bars** - Extract highs, lows, closes, volume
2. **Find pivot points** - Identify local highs and lows
3. **Test all 3 patterns** - Score each pattern independently
4. **Select best match** - Choose pattern with highest confidence (min 40%)
5. **Return result** - Pattern name, confidence, and analysis details

### Confidence Scoring

Each pattern has specific criteria worth points:
- **60+ points** = Pattern detected (valid setup)
- **40-59 points** = Potential pattern (not confirmed)
- **<40 points** = Pattern not detected

### Pattern Priority

When multiple patterns score similarly:
1. VCP is preferred (more reliable)
2. Flat Base second
3. Cup-with-Handle third

## Educational Context

### Why Pattern Detection Matters

According to Mark Minervini's SEPA methodology:
- **ALL 8 SEPA criteria must be met** for a valid entry
- Pattern identification helps confirm **proper base formation**
- Different patterns have different **risk/reward profiles**
- Knowing the pattern helps with **stop loss placement**

### Pattern Characteristics

**VCP:**
- Most reliable for momentum trading
- Tightest stops (7-8% max)
- Best for trending markets

**Flat Base:**
- Forms after big runs (30%+ moves)
- Lower risk entry near highs
- Good for continuation plays

**Cup-with-Handle:**
- Classic growth stock pattern
- Longer base = stronger move
- William O'Neil's favorite pattern

## Testing

Ran full scan on 500 tickers:
- ✅ Pattern detection completed in ~77 seconds
- ✅ All 500 stocks analyzed
- ✅ 307 patterns detected (61% of stocks)
- ✅ UI displays patterns correctly
- ✅ Sortable and filterable

## Files Modified

1. **server/patternDetection.js** (NEW) - Pattern detection logic
2. **server/vcp.js** - Added pattern detection integration
3. **src/pages/Dashboard.tsx** - Added Setup column with pattern display
4. **Scan results (DB)** - Updated with pattern data (stored in scan_results)

## Next Steps (Future Enhancements)

1. **Pattern Visualization:** Add mini-charts showing pattern shape
2. **Pattern Filters:** Add filter buttons for "VCP only", "Flat only", "C&H only"
3. **Pattern Strength:** Add "weak/strong" classification within each pattern type
4. **Historical Analysis:** Track which patterns actually worked (backtest by pattern)
5. **Multi-Pattern Detection:** Show when multiple patterns are forming simultaneously

## Usage

### Via CLI
```bash
# Run scan with pattern detection (automatic)
node server/scan.js
```

### Via UI
1. Click "Run scan now" button
2. Wait for scan to complete
3. View "Setup" column showing detected patterns
4. Sort by pattern or confidence to find best setups
5. Hover over pattern badge to see detailed analysis

## Pattern Analysis Details

Each pattern result includes:
- **Pattern name:** VCP, Flat Base, Cup-with-Handle, or None
- **Confidence:** 0-100% score indicating pattern strength
- **Details:** Specific metrics like:
  - VCP: "4 contractions; Volume drying up; Above 200-day MA; 12 weeks duration"
  - Flat: "Tight range (8.2%); Duration 10+ weeks; Within 5% of 52-week high"
  - C&H: "Cup depth (22.4%); Rounded U-shape; Ideal handle (9.2% depth, 14d)"

## References

- **Mark Minervini's SEPA:** Specific Entry Point Analysis (8 criteria)
- **William O'Neil's CANSLIM:** Cup-with-Handle pattern
- **Volatility Contraction Pattern:** 3-4 tightening pullbacks
- **Flat Base:** Tight consolidation near highs
- **Cup-with-Handle:** U-shaped base with shallow handle
