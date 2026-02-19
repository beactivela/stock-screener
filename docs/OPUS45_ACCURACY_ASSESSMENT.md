# Opus4.5 Scoring Algorithm — Accuracy Assessment

## Summary

**Integration:** Opus4.5 is fully integrated. The scan-results API now merges Opus scores into each result (`?includeOpus=true` by default), so the Dashboard uses a single fetch.

**Accuracy verdict:** The methodology is sound and aligned with Minervini/SEPA and O'Neil/CANSLIM. The main gaps are: (1) weights are heuristic, not empirically tuned; (2) no out-of-sample validation; (3) RS and fundamentals can be missing. Run the learning pipeline and backtest to validate.

---

## 1. Methodology Alignment

| Criterion | Minervini/SEPA | Opus4.5 | ✓/✗ |
|-----------|----------------|---------|-----|
| Stage 2 (50 > 150 > 200 MA) | Required | Mandatory | ✓ |
| 200 MA rising | Required | Mandatory | ✓ |
| Within 25% of 52w high | Required | Mandatory (max 25%) | ✓ |
| 25%+ above 52w low | Required | Mandatory | ✓ |
| RS ≥ 70 | Required | Mandatory | ✓ |
| 2+ contractions | Required | Mandatory | ✓ |
| At MA support (10/20) | Required | Mandatory | ✓ |
| 10 MA slope rising | Implicit | Mandatory (14d + 5d) | ✓ |
| Volume dry-up | Preferred | Confidence boost | ✓ |
| Industry leadership | O'Neil L | Confidence (top 20/40) | ✓ |
| Institutional ownership | O'Neil I | Confidence (50%+) | ✓ |

**Conclusion:** The mandatory checklist and confidence factors match SEPA/CANSLIM. The 10 MA slope filter is a sensible addition to avoid flat/choppy setups.

---

## 2. Weight Calibration

Current weights are heuristic, not backtest-optimized:

| Component | Max pts | Notes |
|-----------|---------|-------|
| VCP (contractions, volume, pattern) | 40 | Reasonable; 3+ contractions weighted heavily |
| 10 MA slope | 15 | Strong slope = 15, good = 10, min = 5 |
| Entry quality (at MA, volume, RS) | 30 | At 10 MA > 20 MA is correct |
| Fundamentals & context | 30 | Industry rank, inst. ownership, EPS |

**Issues:**
- No empirical evidence that 12 pts for 3+ contractions is optimal vs. 10 or 15.
- Industry rank (top 20 vs top 40) may be over-weighted relative to technicals.
- Learning pipeline (`opus45Learning.js`) can tune weights from backtest; run it and apply recommended changes.

---

## 3. Data Quality Risks

| Input | Risk | Impact |
|-------|------|--------|
| Relative Strength | Computed from SPY vs ticker; can be null if bars missing | Fails mandatory if RS null |
| Fundamentals | `pctHeldByInst`, `qtrEarningsYoY` from Yahoo; often null | Loses 8+5 pts; no signal fail |
| Industry rank | From TradingView; can be stale or missing | Loses up to 12 pts |
| Pattern confidence | From VCP logic; subjective thresholds | Affects pass/fail and score |

**Recommendation:** Log how often RS, fundamentals, and industry are null. If >20% of scan results lack RS, fix the data pipeline first.

---

## 4. Potential Overfitting

- **Mandatory thresholds** (RS 70, 25% from high, 2.5% MA tolerance) are standard; low overfitting risk.
- **Confidence weights** are tunable; the learning system can overfit if trained on too few trades or a short period.
- **10 MA slope** (3% over 14d, 0.5% over 5d) is arbitrary; consider validating with backtest.

---

## 5. Recommendations

1. **Run the learning pipeline**  
   `POST /api/opus45/learning/run` — uses backtest to suggest weight changes. Apply only if win-rate lift is meaningful (e.g. +5%+).

2. **Backtest with Opus as filter**  
   Use `retroBacktest.js` or the Backtest page; filter entries by `opus45Confidence >= 70` and compare win rate vs. unfiltered.

3. **Persist `allScores` in cache**  
   Right now only `signals` are cached. Add `all_scores` JSONB to `opus45_signals_cache` so the full per-ticker Opus score is available when loading from cache (avoids 0/F for non-signal tickers).

4. **Validate RS pipeline**  
   Ensure RS is computed for all tickers with 60+ bars. If many are null, the mandatory RS check will reject them.

5. **A/B test grade cutoffs**  
   Compare performance of A/A+ (80+) vs B+ (70+) vs C (50+) in backtest. You may find B+ has better risk-adjusted returns than A+.

---

## 6. Integration Changes Made

- **`GET /api/scan-results`** — Merges Opus4.5 scores into each result when `includeOpus=true` (default). Also returns `opus45Signals` and `opus45Stats`.
- **Dashboard** — Uses single scan-results fetch; derives `opus45AllScores` from merged results. Skips separate Opus fetch on load.
- **Post-scan refresh** — Refetches scan-results (which includes updated Opus from cache).
