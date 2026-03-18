/**
 * Breitstein Signal — Signal Agent
 *
 * Implements the Lance Breitstein pre-trade quality framework.
 * Evaluates stocks across four real-time pillars to assign A+/A/B/C/D grades:
 *
 *   Pillar 1 — TIME BEHAVIOR: Is the stock moving NOW? (5-day slope velocity)
 *   Pillar 2 — RATE OF CHANGE: Momentum expansion with conviction? (14d slope + volume)
 *   Pillar 3 — RELATIVE STRENGTH: Outperforming or lagging the market? (RS rating)
 *   Pillar 4 — TRADE LOCATION: High-quality entry vs chasing? (near key levels/MAs)
 *
 * A+ Setup = Fast + High ROC + Strong RS + A Location
 *   → All four pillars firing simultaneously
 *
 * Thrives in: BULL / UNCERTAIN regimes (real-time leaders surface in all conditions)
 * Budget allocation: 35% in BULL, 25% in UNCERTAIN, 10% in CORRECTION
 *
 * Northstar alignment:
 *   - RS ≥ 75 (early leaders before they hit CANSLIM's 85 threshold)
 *   - Within 20% of 52-week high (A/B location captures near-pivot AND key-MA setups)
 *   - Stock must be moving NOW: 5-day slope ≥ 2% (time behavior gate)
 *   - Hard stop: 8% loss (EXIT_RULES.hard.maxLossPct)
 *
 * Output format (per signal annotation):
 *   Time Behavior:    FAST / MODERATE / SLOW
 *   Rate of Change:   HIGH / MEDIUM / LOW
 *   Relative Strength: STRONG / NEUTRAL / WEAK
 *   Location:         A / B / C
 *   Score:            A+ / A / B / C / D
 *   Action:           Aggressive / Starter / Avoid
 */

import { createStrategyAgent } from './strategyAgentBase.js';
import { CANSLIM, VCP, EXIT_RULES } from './northstar.js';

const breitsteinAgent = createStrategyAgent({
  name: 'Breitstein Signal',
  agentType: 'breitstein',
  signalFamily: 'opus45',
  objective: 'expectancy',
  minImprovement: 0.25,
  riskGates: {
    minTrades: 200,
    minProfitFactor: 1.5,
    maxDrawdownPct: 20,
    minSharpe: 1,
    minSortino: 1,
  },

  // Pillar 3 + 4 mandatory gates:
  //   RS ≥ 75 ensures the stock shows relative leadership vs the market (Pillar 3).
  //   maxDistanceFromHigh ≤ 20% keeps the signal pool to A/B locations only —
  //   stocks extended >20% from their high are C-location (chasing), which Breitstein
  //   explicitly avoids regardless of other factors (Pillar 4).
  mandatoryOverrides: {
    minRelativeStrength: 75,      // Early RS leaders (below CANSLIM.minRsRating to catch emerging stocks)
    maxDistanceFromHigh: 20,      // A/B location gate — no extended, C-location chases
  },

  // Weight overrides aligned to the four Breitstein pillars.
  //
  // PILLAR 4 — TRADE LOCATION (most critical per the framework):
  //   Stocks at key support levels (10MA/20MA) or tight to their 52w pivot are
  //   A-location entries with best risk/reward. Weight these heavily.
  //
  // PILLAR 3 — RELATIVE STRENGTH:
  //   Elite RS (>90) signals clear market leadership. Reward this more than the default.
  //
  // PILLAR 2 — RATE OF CHANGE:
  //   Volume surge at entry confirms expansion, not grinding. Boost entryVolumeConfirm.
  //   Keep slope weights moderate — this agent isn't a pure momentum chaser.
  //
  // PILLAR 1 — TIME BEHAVIOR:
  //   Enforced via trainingFilter (ma10Slope5d ≥ 2) — only trains on stocks that
  //   were moving at the time of entry. No direct weight for 5d slope in the scoring
  //   system, so this is controlled at the data selection layer.
  defaultWeightOverrides: {
    // PILLAR 4: Location weights (primary Breitstein differentiator)
    pctFromHighIdeal: 14,       // +8 from default 6  — near pivot = A location
    pctFromHighGood: 7,         // +4 from default 3  — 5–10% from high = B location
    entryAt10MA: 18,            // +6 from default 12 — at 10MA support = prime A location
    entryAt20MA: 8,             // +5 from default 3  — at 20MA = deeper support, still B

    // PILLAR 3: Relative Strength
    entryRSAbove90: 14,         // +4 from default 10 — elite RS = STRONG classification
    relativeStrengthBonus: 6,   // +3 from default 3  — general RS outperformance bonus

    // PILLAR 2: Rate of Change (volume confirms expansion)
    entryVolumeConfirm: 10,     // +5 from default 5  — volume surge = HIGH ROC signal
    slope10MAElite: 22,         // -3 from default 25 — present but not the primary gate
    slope10MAStrong: 18,        // -2 from default 20

    // Reduce VCP/base weights — Breitstein grades real-time urgency, not base depth
    vcpContractions3Plus: 4,    // -4 from default 8
    vcpContractions4Plus: 2,    // -2 from default 4
    vcpVolumeDryUp: 2,          // -2 from default 4
    vcpPatternConfidence: 2,    // -2 from default 4
  },

  // Train only on signals where the stock was demonstrably moving at entry:
  //   - ma10Slope5d ≥ 2%: Pillar 1 (Time Behavior) — stock has short-term urgency
  //   - relativeStrength ≥ 75: Pillar 3 (RS) — stock is a market leader, not a lagger
  //
  // This ensures the agent learns from true "A+ in real-time" entries, not slow grinders
  // that happened to have a good base structure but no urgency at entry.
  trainingFilter: (signal) => {
    const ctx = signal.context || {};
    return (ctx.ma10Slope5d || 0) >= 2 && (ctx.relativeStrength || 0) >= 75;
  },

  minSignals: 8,   // Moderate pool — broader RS/location filter allows decent sample sizes
});

export default breitsteinAgent;
