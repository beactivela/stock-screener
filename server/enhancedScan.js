/**
 * Enhanced VCP + CANSLIM + Industry Scoring
 * Integrates with scan.js to add enhanced scores (0-100) from VCP result, fundamentals, and industry data.
 * Works with partial data: when fundamentals/industry missing, those sections score 0.
 * 
 * IMPROVEMENT: Added industry ranking system with multiplier (±20% boost/penalty)
 */

import { sma, findPullbacks } from './vcp.js';

/**
 * Rank all industries by 1Y performance
 * Returns { industryName: { rank, percentile, return1Y, totalCount } }
 * 
 * @param {Object} industryReturnsMap - Map of industry name to { return1Y, return6Mo, return3Mo, ytd }
 * @returns {Object} Ranked industries with metadata
 */
export function rankIndustries(industryReturnsMap) {
  if (!industryReturnsMap || typeof industryReturnsMap !== 'object') {
    return {};
  }

  // Extract industries with valid 1Y returns
  const industries = Object.entries(industryReturnsMap)
    .filter(([name, data]) => data && data.return1Y != null && !Number.isNaN(data.return1Y))
    .map(([name, data]) => ({ 
      name, 
      return1Y: data.return1Y,
      return6Mo: data.return6Mo,
      return3Mo: data.return3Mo
    }))
    .sort((a, b) => b.return1Y - a.return1Y); // Sort descending by 1Y return
  
  const total = industries.length;
  const ranked = {};
  
  industries.forEach((ind, idx) => {
    const rank = idx + 1;
    ranked[ind.name] = {
      rank,
      percentile: Math.round(((total - rank) / total) * 100),
      return1Y: ind.return1Y,
      return6Mo: ind.return6Mo,
      return3Mo: ind.return3Mo,
      totalCount: total
    };
  });
  
  return ranked;
}

/**
 * Calculate industry multiplier based on rank
 * Top industries get boost, bottom industries get penalty
 * 
 * @param {number} industryRank - Rank of industry (1 = best)
 * @param {number} totalIndustries - Total number of ranked industries
 * @returns {number} Multiplier (0.90 - 1.20)
 */
export function getIndustryMultiplier(industryRank, totalIndustries) {
  if (!industryRank || !totalIndustries) return 1.0;
  
  // Top 20 industries: +20% boost
  if (industryRank <= 20) return 1.20;
  
  // Top 40 industries: +15% boost
  if (industryRank <= 40) return 1.15;
  
  // Top 60 industries: +10% boost
  if (industryRank <= 60) return 1.10;
  
  // Top 80 industries: +5% boost
  if (industryRank <= 80) return 1.05;
  
  // Bottom 50% industries: -10% penalty
  if (industryRank > totalIndustries * 0.5) return 0.90;
  
  // Middle tier: neutral
  return 1.0;
}

/** Get last valid SMA value from closes. */
function lastSma(closes, period) {
  if (!Array.isArray(closes) || closes.length < period) return null;
  let sum = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const v = closes[i];
    sum += Number.isFinite(v) ? v : 0;
  }
  return sum / period;
}

/**
 * Build enhanced scoring input from VCP result + bars + optional fundamentals + industry.
 * When bars is null (e.g. post-scan API enhancement), uses vcpResult.pullbackPcts and volume fields.
 */
function buildEnhancedData(vcpResult, bars, fundamentals = null, industryData = null) {
  const closes = bars?.map((b) => b.c) ?? [];
  const volumes = bars?.map((b) => b.v ?? b.volume ?? 0) ?? [];
  const lastIdx = closes.length - 1;
  const lastClose = vcpResult.lastClose ?? closes[lastIdx];

  // Compute SMAs (vcp has 10/20/50; we need 150/200 for full enhanced score)
  const sma10 = vcpResult.sma10 ?? lastSma(closes, 10);
  const sma20 = vcpResult.sma20 ?? lastSma(closes, 20);
  const sma50 = vcpResult.sma50 ?? lastSma(closes, 50);
  const sma150 = lastSma(closes, 150) ?? sma50;
  const sma200 = lastSma(closes, 200) ?? sma50;

  // Contractions: from pullbacks when bars available, else from vcpResult.pullbackPcts
  const pullbacks = bars && bars.length > 0 ? findPullbacks(bars, 80) : [];
  let contractions;
  if (pullbacks.length > 0) {
    contractions = pullbacks.slice(-5).map((p) => ({ range: p.pct / 100, avgVolume: p.avgVolume }));
  } else {
    const pcts = vcpResult.pullbackPcts ?? [];
    contractions = pcts.map((p) => ({ range: parseFloat(String(p)) / 100 || 0, avgVolume: null }));
  }

  // Volume analysis
  let volSma20 = null;
  let pullbackVol = null;
  let upDayVol = null;
  if (bars && volumes.length >= 20) {
    volSma20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const lastPullback = pullbacks[pullbacks.length - 1];
    pullbackVol = lastPullback?.avgVolume ?? volSma20;
    const upDays = bars.filter((b, i) => i > 0 && (b.c ?? 0) > (bars[i - 1].c ?? 0));
    upDayVol = upDays.length > 0 ? upDays.reduce((s, b) => s + (b.v ?? b.volume ?? 0), 0) / upDays.length : volSma20;
  } else if (vcpResult.avgVol20 != null) {
    volSma20 = vcpResult.avgVol20;
    const ratio = vcpResult.volumeRatio ?? 1;
    pullbackVol = volSma20 * ratio;
    upDayVol = volSma20 * 1.1;
  }

  const rsRating = vcpResult?.rsData?.rsRating ?? vcpResult?.relativeStrength ?? null;

  return {
    contractions,
    volumeData: volSma20 != null
      ? {
          recentAverage: volSma20,
          pullbackAverage: pullbackVol ?? volSma20,
          upDayVolume: upDayVol ?? volSma20,
        }
      : null,
    movingAverages: {
      sma10: sma10 ?? lastClose,
      sma20: sma20 ?? lastClose,
      sma50: sma50 ?? lastClose,
      sma150: sma150 ?? sma50 ?? lastClose,
      sma200: sma200 ?? sma50 ?? lastClose,
    },
    priceAction: { currentPrice: lastClose, pivotHigh: lastClose },
    relativeStrength: rsRating, // IBD RS Rating (1–99) when available

    earnings: fundamentals
      ? {
          quarterlyGrowth: fundamentals.qtrEarningsYoY ?? null,
          acceleration: null,
          annualGrowth: null,
          roe: null,
          volumeOnEarnings: null,
          avgVolume: null,
          industryRank: null,
          industryRS: null,
        }
      : null,
    products: null,
    institutional: fundamentals?.pctHeldByInst != null
      ? {
          accumulationDistribution: fundamentals.pctHeldByInst >= 70 ? 'A' : fundamentals.pctHeldByInst >= 50 ? 'B+' : 'B',
          increasingInstitutions: null,
        }
      : null,
    marketDirection: { isConfirmedUptrend: true },

    industry: industryData
      ? {
          groupRank: industryData.rank ?? null,
          earningsGrowth: industryData.return1Y ?? industryData.return6Mo ?? null,
        }
      : null,
    sector: industryData
      ? { rotationScore: industryData.return6Mo ?? industryData.return1Y ?? 0, isMidCycle: true }
      : null,
    marketTrend: { cyclePhase: 'midCycle' },
  };
}

/** VCP Technical Score (40 pts max) */
function calculateVCPTechnicalScore(data) {
  let score = 0;
  const { contractions, volumeData, movingAverages, priceAction, relativeStrength } = data;

  if (contractions.length > 0) {
    const contractionCount = contractions.length;
    if (contractionCount >= 3) score += 8;
    else if (contractionCount >= 2) score += 5;
    else if (contractionCount >= 1) score += 2;
    for (let i = 1; i < contractions.length; i++) {
      if (contractions[i].range < contractions[i - 1].range) score += 2;
    }
    score = Math.min(score, 12);
  }

  if (volumeData) {
    const avg = volumeData.recentAverage;
    const pullback = volumeData.pullbackAverage;
    if (avg > 0 && pullback != null) {
      if (pullback < avg * 0.7) score += 6;
      else if (pullback < avg * 0.9) score += 4;
      else if (pullback < avg) score += 2;
    }
    if (volumeData.upDayVolume > (volumeData.recentAverage || 0) * 1.2) score += 2;
  }
  score = Math.min(score, 20);

  const { sma10, sma20, sma50, sma150, sma200 } = movingAverages;
  const price = priceAction.currentPrice;
  if (price > sma200 && price > sma150) {
    score += 4;
    if (Math.abs(price - sma50) / sma50 < 0.02) score += 4;
    else if (Math.abs(price - sma20) / sma20 < 0.02) score += 3;
    else if (Math.abs(price - sma10) / sma10 < 0.02) score += 2;
  }
  if (price > sma50 && price > sma20) score += 4;

  if (relativeStrength != null) {
    if (relativeStrength > 80) score += 8;
    else if (relativeStrength > 70) score += 6;
    else if (relativeStrength > 60) score += 4;
    else if (relativeStrength > 50) score += 2;
  }

  return Math.min(score, 40);
}

/** CANSLIM Score (35 pts max) */
function calculateCANSLIMScore(data) {
  let score = 0;
  const { earnings, institutional, marketDirection } = data;

  if (earnings?.quarterlyGrowth != null) {
    const g = earnings.quarterlyGrowth;
    if (g > 50) score += 8;
    else if (g > 30) score += 6;
    else if (g > 25) score += 4;
    else if (g > 15) score += 2;
  }
  if (earnings?.acceleration) score += 3;

  if (earnings?.annualGrowth != null && earnings?.roe != null) {
    if (earnings.annualGrowth > 25 && earnings.roe > 17) score += 6;
    else if (earnings.annualGrowth > 20 || earnings.roe > 15) score += 4;
    else if (earnings.annualGrowth > 15 || earnings.roe > 12) score += 2;
  }

  if (institutional) {
    const ad = institutional.accumulationDistribution;
    if (ad === 'A+' || ad === 'A') score += 5;
    else if (ad === 'B+') score += 3;
    else if (ad === 'B') score += 1;
    if (institutional.increasingInstitutions) score += 2;
  }

  if (marketDirection?.isConfirmedUptrend) score += 2;

  return Math.min(score, 35);
}

/** Industry Context Score (25 pts max) */
function calculateIndustryContextScore(data) {
  let score = 0;
  const { industry, sector } = data;

  if (industry?.groupRank != null) {
    const r = industry.groupRank;
    if (r <= 5) score += 10;
    else if (r <= 10) score += 8;
    else if (r <= 20) score += 6;
    else if (r <= 40) score += 4;
    else if (r <= 60) score += 2;
  }
  if (industry?.earningsGrowth != null) {
    const g = industry.earningsGrowth;
    if (g > 20) score += 5;
    else if (g > 10) score += 3;
    else if (g > 0) score += 1;
  }
  if (sector?.rotationScore != null) {
    const rs = sector.rotationScore;
    if (rs > 70) score += 8;
    else if (rs > 40) score += 6;
    else if (rs > 10) score += 4;
    else if (rs > -10) score += 2;
  }

  return Math.min(score, 25);
}

function getScoreGrade(score) {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B+';
  if (score >= 60) return 'B';
  if (score >= 50) return 'C+';
  if (score >= 40) return 'C';
  if (score >= 30) return 'D';
  return 'F';
}

function getRecommendation(score) {
  if (score >= 80) return 'STRONG BUY - Excellent setup with strong fundamentals and industry tailwinds';
  if (score >= 70) return 'BUY - Good technical pattern with solid fundamentals and positive industry context';
  if (score >= 60) return 'WATCH/CONSIDER - Decent setup but may need improvement in some areas';
  if (score >= 50) return 'CAUTIOUS - Mixed signals, wait for better setup or improvement';
  if (score >= 40) return 'AVOID - Weak setup with multiple concerns';
  return 'STRONG AVOID - Poor technical and fundamental outlook';
}

/**
 * Compute enhanced score from VCP result + bars + optional fundamentals + industry.
 * Call this from scan.js after checkVCP.
 * 
 * IMPROVEMENT: Now accepts allIndustryRanks to apply industry multiplier
 * 
 * @param {Object} vcpResult - Result from checkVCP()
 * @param {Array} bars - Price bars (or null for post-scan enhancement)
 * @param {Object} fundamentals - Company fundamentals (optional)
 * @param {Object} industryData - Industry performance data (optional)
 * @param {Object} allIndustryRanks - All ranked industries from rankIndustries() (optional)
 * @returns {Object} Enhanced score with breakdown
 */
export function computeEnhancedScore(vcpResult, bars, fundamentals = null, industryData = null, allIndustryRanks = null) {
  const data = buildEnhancedData(vcpResult, bars, fundamentals, industryData);

  const vcpScore = calculateVCPTechnicalScore(data);
  const canslimScore = calculateCANSLIMScore(data);
  const industryScore = calculateIndustryContextScore(data);

  // Base composite score (0-100)
  const baseScore = vcpScore + canslimScore + industryScore;
  
  // Industry momentum multiplier (NEW)
  let industryMultiplier = 1.0; // neutral
  let industryRank = null;
  let industryName = null;
  
  if (fundamentals?.industry && allIndustryRanks && allIndustryRanks[fundamentals.industry]) {
    const rankData = allIndustryRanks[fundamentals.industry];
    industryRank = rankData.rank;
    industryName = fundamentals.industry;
    const totalIndustries = rankData.totalCount || Object.keys(allIndustryRanks).length;
    
    // Calculate multiplier based on rank
    industryMultiplier = getIndustryMultiplier(industryRank, totalIndustries);
  }
  
  // Apply multiplier to base score
  const finalScore = Math.min(100, Math.round(baseScore * industryMultiplier));

  const grade = getScoreGrade(finalScore);
  const recommendation = getRecommendation(finalScore);

  return {
    enhancedScore: finalScore,
    baseScore: Math.round(baseScore), // Score before multiplier
    industryMultiplier: Math.round(industryMultiplier * 100) / 100, // Round to 2 decimals
    industryRank,
    industryName,
    enhancedGrade: grade,
    enhancedRecommendation: recommendation,
    vcpScore,
    canslimScore,
    industryScore,
  };
}

/**
 * Apply enhanced scoring to scan results. Merges fundamentals + industry when available.
 */
export function applyEnhancedScoresToResults(results, barsByTicker, fundamentals, industryByTicker) {
  return results.map((r) => {
    const bars = barsByTicker?.[r.ticker];
    const fund = fundamentals?.[r.ticker];
    const ind = industryByTicker?.[r.ticker];
    const enhanced = computeEnhancedScore(r, bars, fund, ind);
    return { ...r, ...enhanced };
  });
}
