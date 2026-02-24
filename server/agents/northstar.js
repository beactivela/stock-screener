/**
 * northstar.js — Shared Northstar Doctrine for all agents
 *
 * Source of truth: docs/northstar.md
 * Every agent imports NORTHSTAR_DOCTRINE and uses it to govern decisions.
 * Update this file when the doctrine in northstar.md changes.
 *
 * ─────────────────────────────────────────────────────────────
 *  NORTHSTAR — Swing Trading Signal System
 *
 *  Mission: Generate high-confidence long entries using CANSLIM + VCP
 *  methodology, with AI-powered signal validation, to grow a $100K account
 *  by 40%+ annually while limiting max drawdown to 8–10% per position.
 * ─────────────────────────────────────────────────────────────
 */

// ─── Account Parameters ───────────────────────────────────────────────────────

export const ACCOUNT = {
  size:              100_000,   // USD
  maxPositionPct:    0.10,      // 10% per stock
  riskPerTradePct:   0.015,     // 1–2% of account, use 1.5% midpoint
  maxDrawdownPct:    0.10,      // 8–10% per position, use 10% hard cap
  annualReturnTarget: 0.40,     // 40%+
};

/**
 * Position sizing formula from the Northstar doc:
 *   shares = (accountValue × riskPct) / (entryPrice − stopPrice)
 */
export function calcPositionSize(accountValue, entryPrice, stopPrice, riskPct = ACCOUNT.riskPerTradePct) {
  const dollarRisk = accountValue * riskPct;
  const stopDistance = entryPrice - stopPrice;
  if (stopDistance <= 0) return 0;
  const shares = Math.floor(dollarRisk / stopDistance);
  const maxShares = Math.floor((accountValue * ACCOUNT.maxPositionPct) / entryPrice);
  return Math.min(shares, maxShares);
}

// ─── Market Regime Gate (Master Switch) ──────────────────────────────────────
// IBD Market Direction is the PRIMARY gate. All buying suppressed in unfavorable regimes.

export const REGIME_GATE = {
  BULL:        { systemState: 'Full Go',    maxPositions: 50, buyAllowed: true  },
  UNCERTAIN:   { systemState: 'Reduce',     maxPositions: 10, buyAllowed: true  },
  CORRECTION:  { systemState: 'Watch Only', maxPositions: 5,  buyAllowed: false },
  BEAR:        { systemState: 'Cash',       maxPositions: 5,  buyAllowed: false },
};

export function isBuyingAllowed(regime) {
  return REGIME_GATE[regime]?.buyAllowed ?? false;
}

export function getMaxPositions(regime) {
  return REGIME_GATE[regime]?.maxPositions ?? 5;
}

// ─── CANSLIM Minimum Thresholds ───────────────────────────────────────────────

export const CANSLIM = {
  // Fundamental
  minCurrentEpsGrowthPct:  25,   // C — Current quarterly EPS +25% YoY
  minAnnualEpsGrowthPct:   25,   // A — Annual EPS growth over 3 years
  minRsRating:             85,   // L — RS Rating ≥ 85 (IBD Relative Strength)

  // Technical pre-filter
  minPrice:                10,   // $10 minimum
  minAvgDailyVolume:       500_000,
  maxDistFromHighPct:      15,   // Within 5–15% of 52-week high
  requireAbove50dMA:       true,
  requireAbove200dMA:      true,
  requireRsLineTrendingUp: true,
};

// ─── VCP Pattern Requirements ─────────────────────────────────────────────────

export const VCP = {
  minPriorUptrendPct:   30,     // Prior uptrend of at least 30% before base
  minContractions:       2,     // 2–4 contractions on weekly chart
  maxContractions:       4,
  volumeDryUpRequired:   true,  // Volume must contract during tight areas
  pivotEntryMaxPctAbove: 5,     // Entry within 5% of pivot (no chasing)
  breakoutVolumeMinX:    1.40,  // ≥40% above 50-day avg volume at breakout
  idealBreakoutMaxPct:   2,     // Ideal entry within 1–2% above pivot
};

// ─── Exit Rules ───────────────────────────────────────────────────────────────

export const EXIT_RULES = {
  hard: {
    maxLossPct:          8,     // Close 8–10% below entry → EXIT FULL
    bearRegimeExitAll:   true,  // IBD downgrade to downtrend → EXIT ALL
  },
  soft: {
    consecutiveUpDaysVolumeContraction: 3,  // Volume contraction = exhaustion
    daysBelow10MA: 2,                       // Close below 10-day MA x2 = exit
  },
  profitTaking: {
    firstTrimPct:       20,    // At +20%: sell 1/3
    secondTrimPct:      30,    // At +30%: sell another 1/3
    raiseStopAtFirst:   true,  // Raise stop to breakeven at first trim
    trailWithMA10:      true,  // Trail remaining 1/3 with 10-day MA
  },
};

// ─── Performance Kill Switches ────────────────────────────────────────────────

export const KILL_SWITCHES = {
  minAnnualReturn:     0.10,   // < 10% after 6 months → audit
  minWinRate:          0.30,   // < 30% over 30 trades → audit
  minWinLossRatio:     1.5,    // < 1.5:1 → audit (target ≥2.5:1)
  maxAccountDrawdown:  0.20,   // > 20% → pause system
  minExpectancy:       500,    // Negative over 20 trades → audit
};

// ─── Guiding Principles (for agent reasoning) ────────────────────────────────

export const PRINCIPLES = [
  'Market first. If IBD says no, the system says no. No exceptions.',
  'Risk is managed at entry. Every trade is sized before it is placed.',
  'Let winners run. The 40% annual goal requires 2–3 exceptional winners per year.',
  'Losses are data. Every stopped-out trade feeds the failure analysis loop.',
  'The system beats the gut. When in conflict, the Northstar Score wins.',
];

// ─── Convenience: full doctrine summary (for logging / briefings) ─────────────

export const NORTHSTAR_DOCTRINE = {
  mission: 'Generate high-confidence long entries using CANSLIM + VCP methodology to grow a $100K account by 40%+ annually, limiting max drawdown to 8–10% per position.',
  account: ACCOUNT,
  regimeGate: REGIME_GATE,
  canslim: CANSLIM,
  vcp: VCP,
  exitRules: EXIT_RULES,
  killSwitches: KILL_SWITCHES,
  principles: PRINCIPLES,
};
