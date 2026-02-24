# 🌟 NORTHSTAR — Swing Trading Signal System
> **Mission:** Generate high-confidence long entries using CANSLIM + VCP methodology, with AI-powered signal validation, to grow a $100K account by 40%+ annually while limiting max drawdown to 8-10% per position.

---

## 1. System Overview

Northstar is a hybrid human-AI swing trading system built on three pillars:

1. **Scan** — Identify stocks passing CANSLIM + VCP criteria across the full US market universe
2. **Score** — Signal agents (e.g. Momentum Scout, Base Hunter, Breakout Tracker) evaluate and rank setups by conviction level
3. **Signal** — Dashboard surfaces actionable buy/exit alerts with defined risk parameters

The system respects IBD Market Direction rules as the master on/off switch. No longs in a confirmed downtrend — period.

---

## 2. Account Parameters

| Parameter | Value |
|---|---|
| Account Size | $100,000 (margin account) |
| Max Position Size | 10% per stock ($10,000) |
| Risk Per Trade | 1–2% of account ($1,000–$2,000) |
| Max Concurrent Positions | Dynamic (market-regime driven) |
| Holding Period | Multi-day to multi-week (no cap) |
| Max Drawdown per Position | 8–10% (Minervini standard) |
| Annual Return Target | 40%+ or higher |

**Position Sizing Formula:**
```
Position Size = (Account Value × Risk%) / (Entry Price − Stop Price)
```
*Example: $100K × 1.5% risk / $2.00 stop = 750 shares max*

---

## 3. Market Regime Filter (Master Switch)

The system uses IBD's Market Direction framework as the **primary gate**. All buying signals are suppressed in unfavorable regimes.

| IBD Signal | System State | Max Positions |
|---|---|---|
| Confirmed Uptrend | ✅ Full Go | 50  |
| Uptrend Under Pressure | ⚠️ Reduce | 10 |
| Rally Attempt | 🔶 Watch Only | 5+ |
| Confirmed Downtrend | 🚫 Cash | 5 |

**Regime Inputs:**
- IBD Market Pulse (via IBD API or manual input)
- S&P 500 & Nasdaq price/volume action
- % of stocks above 50-day MA (breadth filter)
- Distribution day count on major indices

---

## 4. Stock Screening — CANSLIM Criteria

Stocks must pass a minimum threshold score across CANSLIM dimensions before entering the VCP analysis pipeline.

### 4A. Fundamental Filters (via Finviz / IBD API)

| Criteria | Minimum Threshold |
|---|---|
| **C** — Current Quarterly EPS | +25% YoY, accelerating preferred |
| **A** — Annual EPS Growth | +25% over 3 years |
| **N** — New High / New Product | Near 52-week high or breakout zone |
| **S** — Supply/Demand | Accumulation days > distribution days (50-day window) |
| **L** — Leader | RS Rating ≥ 85 (IBD Relative Strength) |
| **I** — Institutional Sponsorship | ≥ 1 major institution increasing stake |
| **M** — Market Direction | Confirmed Uptrend (see Section 3) |

### 4B. Technical Pre-Filter

- Price ≥ $10
- Average daily volume ≥ 500K shares
- Within 5–15% of 52-week high
- Above 50-day and 200-day MA
- RS Line trending up, ideally making new highs

---

## 5. VCP Pattern Detection

Stocks passing CANSLIM filters enter the VCP (Volatility Contraction Pattern) engine.

### 5A. VCP Criteria Checklist

- [ ] Prior uptrend of at least 30% before base formation
- [ ] 2–4 contractions visible on weekly chart
- [ ] Each contraction is smaller in price range than the prior (tightening volatility)
- [ ] Volume contracts during each tight area
- [ ] Depth of contractions: ideally 10–15–5–3% pattern (progressively tighter)
- [ ] Pivot point is the tightest contraction high
- [ ] Stock is within 5% of pivot point at entry

### 5B. Pivot Entry Rules

- **Entry trigger:** Price closes above pivot on volume ≥ 40% above 50-day avg volume
- **Ideal entry:** Within 1–2% above pivot (no chasing)
- **Stop placement:** Below the last contraction low or below the 10-day MA (whichever is tighter)

---



## 8. Exit Rules

### Hard Exit (Non-Negotiable)
- Price closes 8–10% below entry → EXIT FULL POSITION
- IBD downgrades to Confirmed Downtrend → EXIT ALL POSITIONS

### Soft Exit Signals 
- Volume contraction on 3+ consecutive up days (exhaustion)
- RS Line breaks below recent uptrend
- Stock closes below 10-day MA for 2 consecutive days after extended run
- Earnings approaching with no confirmed catalyst (reduce or exit before)

### Profit Taking Rules
- At +20%: Sell 1/3 of position, raise stop to breakeven
- At +30%: Sell another 1/3, trail stop with 10-day MA
- Remaining 1/3: Let run with trailing stop — the big winners fund the 40% goal




## 12. Performance Targets & Kill Switch

| Metric | Target | Kill Switch Threshold |
|---|---|---|
| Annual Return | 40%+ | < 10% after 6 months |
| Win Rate | ≥ 25% | < 30% over 30 trades |
| Avg Win / Avg Loss | ≥ 2.5:1 | < 1.5:1 |
| Max Account Drawdown | < 15% | > 20% → pause system |
| Expectancy per Trade | > $500 | Negative over 20 trades |

> **If the system hits any kill switch threshold, trading halts and a full system audit is conducted before resuming.**

---

## 13. Guiding Principles

1. **Market first.** If IBD says no, the system says no. No exceptions.
2. **Risk is managed at entry.** Every trade is sized before it's placed.
3. **Let winners run.** The 40% annual goal requires 2-3 exceptional winners per year.
4. **Losses are data.** Every stopped-out trade feeds the failure analysis loop.
5. **The system beats the gut.** When in conflict, the Northstar Score wins.

---

*Last Updated: February 2026 | Version 1.0*