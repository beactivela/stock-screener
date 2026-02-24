/**
 * Sam Scoring Agent — Confidence Score Engine
 *
 * Sam's only job: score every setup against the Minervini/CANSLIM parameters
 * and output a single "confidence score" (the Opus Signal) per setup type.
 *
 * Scoring dimensions:
 *   1. Volume — above-average volume on breakout, volume dry-up in base
 *   2. Tightness — tight price consolidation in the base (low ATR%)
 *   3. RS Rank — Relative Strength vs. S&P 500 (IBD-style percentile)
 *   4. Pivot Breakout Quality — clean breakout above pivot on heavy volume
 *   5. VCP Pattern — Volatility Contraction Pattern depth + # contractions
 *   6. Regime Trend — broad market (BULL / UNCERTAIN / CORRECTION / BEAR)
 *   7. Industry Trend — sector/industry relative strength rank
 *   8. Market Phase — stage analysis (Stage 1–4 Weinstein model)
 *
 * Output per setup:
 *   { confidenceScore, winRate, rMultiple, topFactors, setupType }
 *
 * Model: GPT-5.2 Codex High
 */

import { CANSLIM, VCP, REGIME_GATE } from './northstar.js';

// ─── Scoring dimension weights ───────────────────────────────────────────────
// Each dimension contributes up to its MAX_WEIGHT points.
// The raw sum is normalized to 0–100.

export const SCORING_DIMENSIONS = {
  volume: {
    label: 'Volume',
    description: 'Above-average volume on breakout; volume dry-up in base',
    maxWeight: 20,
  },
  tightness: {
    label: 'Tightness',
    description: 'Tight price consolidation in the base (low ATR%)',
    maxWeight: 15,
  },
  rsRank: {
    label: 'RS Rank',
    description: 'Relative Strength percentile vs. S&P 500',
    maxWeight: 20,
  },
  pivotBreakout: {
    label: 'Pivot Breakout Quality',
    description: 'Clean break above pivot on heavy volume',
    maxWeight: 15,
  },
  vcpPattern: {
    label: 'VCP Pattern',
    description: 'Volatility Contraction Pattern depth + contraction count',
    maxWeight: 15,
  },
  regimeTrend: {
    label: 'Regime Trend',
    description: 'Broad market phase: BULL / UNCERTAIN / CORRECTION / BEAR',
    maxWeight: 5,
  },
  industryTrend: {
    label: 'Industry Trend',
    description: 'Sector/industry relative strength rank',
    maxWeight: 5,
  },
  marketPhase: {
    label: 'Market Phase',
    description: 'Weinstein Stage analysis (Stage 2 = highest score)',
    maxWeight: 5,
  },
};

const TOTAL_MAX = Object.values(SCORING_DIMENSIONS).reduce((s, d) => s + d.maxWeight, 0);

// ─── Individual dimension scorers ────────────────────────────────────────────

function scoreVolume(ctx = {}) {
  const breakoutVol = ctx.breakoutVolumeRatio || 1;   // ratio vs 50-day avg
  const dryUp = ctx.volumeDryUp === true ? 1 : 0;
  let pts = 0;
  // Northstar: breakout volume ≥40% above 50d avg (VCP.breakoutVolumeMinX = 1.40)
  // Scale: at threshold = 8pts, at 2× = 12pts
  const threshold = VCP.breakoutVolumeMinX;
  pts += Math.min(12, Math.max(0, (breakoutVol - 1) * (8 / (threshold - 1))));
  // Volume dry-up in base required by VCP doctrine
  pts += dryUp * 8;
  return Math.min(SCORING_DIMENSIONS.volume.maxWeight, pts);
}

function scoreTightness(ctx = {}) {
  // ctx.baseAtrPct: average true range as % of price during base formation
  // Lower is tighter. Ideal < 1.5%, max useful < 4%
  const atr = ctx.baseAtrPct || 4;
  if (atr <= 1.0) return SCORING_DIMENSIONS.tightness.maxWeight;
  if (atr <= 1.5) return 12;
  if (atr <= 2.5) return 9;
  if (atr <= 3.5) return 5;
  return 2;
}

function scoreRsRank(ctx = {}) {
  const rs = ctx.relativeStrength || 0;    // 0–99 IBD-style
  // Northstar CANSLIM: RS ≥ 85 required (CANSLIM.minRsRating)
  // Scores scale sharply below the minimum to discourage weak leaders
  if (rs >= 95) return SCORING_DIMENSIONS.rsRank.maxWeight;
  if (rs >= 90) return 18;
  if (rs >= CANSLIM.minRsRating) return 15;  // at-threshold = passing
  if (rs >= 70) return 5;   // below threshold = penalty
  return 0;
}

function scorePivotBreakout(ctx = {}) {
  const abovePivot = ctx.abovePivot === true;
  const pivotVolRatio = ctx.pivotVolumeRatio || 1;
  let pts = 0;
  if (abovePivot) pts += 8;
  pts += Math.min(7, Math.max(0, (pivotVolRatio - 1) * 5));
  return Math.min(SCORING_DIMENSIONS.pivotBreakout.maxWeight, pts);
}

function scoreVcp(ctx = {}) {
  const contractions = ctx.contractions || 0;
  const patternConfidence = ctx.patternConfidence || 0;  // 0–100
  let pts = 0;
  // Northstar VCP: 2–4 contractions, each smaller than prior (VCP.minContractions = 2)
  if (contractions >= VCP.maxContractions) pts += 8;       // 4+ = ideal
  else if (contractions >= 3) pts += 5;
  else if (contractions >= VCP.minContractions) pts += 3;  // 2 = minimum passing
  // Pattern confidence
  pts += Math.round((patternConfidence / 100) * 7);
  return Math.min(SCORING_DIMENSIONS.vcpPattern.maxWeight, pts);
}

function scoreRegime(regime = 'UNCERTAIN') {
  // Northstar: BEAR and CORRECTION suppress all buying (REGIME_GATE)
  // Score still reflects quality — Marcus enforces the gate, not Sam
  const buyable = REGIME_GATE[regime]?.buyAllowed;
  const map = { BULL: 5, UNCERTAIN: 3, CORRECTION: 1, BEAR: 0 };
  return buyable === false ? 0 : (map[regime] ?? 3);
}

function scoreIndustry(ctx = {}) {
  const rank = ctx.industryRsRank || 50;  // 0–100, higher = stronger
  if (rank >= 80) return SCORING_DIMENSIONS.industryTrend.maxWeight;
  if (rank >= 60) return 4;
  if (rank >= 40) return 2;
  return 1;
}

function scoreMarketPhase(ctx = {}) {
  // Weinstein Stage: 1=basing, 2=advancing(best), 3=topping, 4=declining
  const stage = ctx.weinsteinStage || 2;
  const map = { 1: 3, 2: 5, 3: 1, 4: 0 };
  return map[stage] ?? 3;
}

// ─── Main scoring function ───────────────────────────────────────────────────

/**
 * Score a single setup and return a confidence score (0–100) plus breakdown.
 *
 * @param {Object} setup            - Signal/setup object from Harry Historian
 * @param {string} setup.regime     - Current market regime
 * @param {Object} setup.context    - Per-ticker context (RS, ATR, contractions, etc.)
 * @returns {Object} { confidenceScore, breakdown, topFactors, setupType }
 */
export function scoreSetup(setup = {}) {
  const ctx = setup.context || {};
  const regime = setup.regime || 'UNCERTAIN';

  const breakdown = {
    volume:       scoreVolume(ctx),
    tightness:    scoreTightness(ctx),
    rsRank:       scoreRsRank(ctx),
    pivotBreakout: scorePivotBreakout(ctx),
    vcpPattern:   scoreVcp(ctx),
    regimeTrend:  scoreRegime(regime),
    industryTrend: scoreIndustry(ctx),
    marketPhase:  scoreMarketPhase(ctx),
  };

  const rawTotal = Object.values(breakdown).reduce((s, v) => s + v, 0);
  const confidenceScore = Math.round((rawTotal / TOTAL_MAX) * 100);

  // Top 3 contributing factors for the UI
  const topFactors = Object.entries(breakdown)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([key, pts]) => ({
      dimension: SCORING_DIMENSIONS[key]?.label || key,
      points: pts,
      maxPoints: SCORING_DIMENSIONS[key]?.maxWeight || 0,
    }));

  // Classify setup type
  const setupType = classifySetupType(ctx);

  return {
    confidenceScore,
    breakdown,
    topFactors,
    setupType,
    regime,
  };
}

/**
 * Score an array of setups and return them sorted by confidence (high → low).
 * Also computes which parameter combinations had the highest win rate + R-multiple
 * across the batch, and attaches that summary.
 *
 * @param {Array} setups   - Array of setup objects
 * @returns {Object} { scoredSetups, winRateByDimension, bestCombination }
 */
export function scoreAllSetups(setups = []) {
  if (!setups.length) return { scoredSetups: [], winRateByDimension: {}, bestCombination: null };

  const scoredSetups = setups
    .map((s) => ({ ...s, scoring: scoreSetup(s) }))
    .sort((a, b) => b.scoring.confidenceScore - a.scoring.confidenceScore);

  // Aggregate win rate by top factor to identify which dimensions predict success
  const dimStats = {};

  for (const s of scoredSetups) {
    const isWin = (s.outcome?.returnPct || 0) > 0;
    const rMult = s.outcome?.rMultiple || 0;

    for (const factor of s.scoring.topFactors) {
      const key = factor.dimension;
      if (!dimStats[key]) dimStats[key] = { wins: 0, total: 0, rSum: 0 };
      dimStats[key].total += 1;
      if (isWin) dimStats[key].wins += 1;
      dimStats[key].rSum += rMult;
    }
  }

  const winRateByDimension = Object.fromEntries(
    Object.entries(dimStats).map(([dim, stat]) => [
      dim,
      {
        winRate: stat.total > 0 ? Math.round((stat.wins / stat.total) * 100) : null,
        avgRMultiple: stat.total > 0 ? parseFloat((stat.rSum / stat.total).toFixed(2)) : null,
        sampleSize: stat.total,
      },
    ])
  );

  // Best combination = top factor pair by win rate among dims with ≥5 samples
  const eligible = Object.entries(winRateByDimension)
    .filter(([, v]) => v.sampleSize >= 5 && v.winRate !== null)
    .sort(([, a], [, b]) => b.winRate - a.winRate);

  const bestCombination = eligible.slice(0, 2).map(([dim]) => dim);

  return { scoredSetups, winRateByDimension, bestCombination };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function classifySetupType(ctx = {}) {
  const contractions = ctx.contractions || 0;
  const slope = ctx.ma10Slope14d || 0;
  const rs = ctx.relativeStrength || 0;

  if (contractions >= 4 && ctx.volumeDryUp) return 'deep_vcp';
  if (contractions >= 2 && slope >= 7 && rs >= 85) return 'momentum_vcp';
  if (contractions >= 2) return 'standard_vcp';
  if (ctx.abovePivot && (ctx.pivotVolumeRatio || 0) >= 1.5) return 'pivot_breakout';
  return 'base_breakout';
}

export const SAM_SCORING_AGENT_META = {
  name: 'Sam Scoring Agent',
  agentType: 'sam_scoring',
  model: 'gpt-5.2-codex-high',
  description:
    'Scores each setup against 8 Minervini parameters and outputs a confidence score (the Opus Signal) per setup type. Identifies which parameter combinations had the highest win rate + R-multiple.',
  dimensions: Object.keys(SCORING_DIMENSIONS),
};
