/**
 * Failure Classification Engine
 * 
 * For every LOSING trade, this module classifies WHY it failed.
 * 
 * Failure Categories (mutually exclusive primary):
 * - MARKET_CONDITION: General market was weak/bearish
 * - FALSE_BREAKOUT: Broke out but volume didn't confirm / closed back in base
 * - WEAK_BASE: Base too deep (>35%) or too short (<5 weeks)
 * - LOW_RS: RS < 80 at entry (should have been stronger)
 * - OVERHEAD_SUPPLY: Too much resistance above entry
 * - EARLY_ENTRY: Entered before proper pivot/VCP completion
 * - EARNINGS_GAP: Gap down on earnings announcement
 * - SECTOR_ROTATION: Sector fell out of favor during hold
 * - STOP_LOSS_TOO_TIGHT: Normal volatility stopped us out (not a real failure)
 * - UNKNOWN: Needs manual review
 * 
 * Each classification includes:
 * - Confidence level (0-100)
 * - Supporting evidence
 * - Secondary contributing factors
 */

import { getSupabase, isSupabaseConfigured } from '../supabase.js';
import { getContextSnapshotByTradeId } from './tradeContext.js';
import { getBars } from '../yahoo.js';

/**
 * Failure category definitions with rules
 */
const FAILURE_RULES = {
  MARKET_CONDITION: {
    priority: 1,
    description: 'General market was weak or bearish',
    check: (context, trade, exitData) => {
      const evidence = [];
      let score = 0;
      
      // Market in correction at entry
      if (context.marketInCorrection) {
        score += 40;
        evidence.push('Market was in correction at entry');
      }
      
      // Market regime was BEAR or CORRECTION
      if (context.marketRegime === 'BEAR' || context.marketRegime === 'CORRECTION') {
        score += 30;
        evidence.push(`Market regime was ${context.marketRegime}`);
      }
      
      // High distribution day count
      if (context.spyDistributionDays >= 4) {
        score += 20;
        evidence.push(`${context.spyDistributionDays} distribution days at entry`);
      }
      
      // SPY below key MAs
      if (!context.spyAbove50ma) {
        score += 10;
        evidence.push('SPY was below 50 MA');
      }
      
      return { score, evidence };
    }
  },
  
  FALSE_BREAKOUT: {
    priority: 2,
    description: 'Price broke out but volume did not confirm or price fell back into base',
    check: (context, trade, exitData) => {
      const evidence = [];
      let score = 0;
      
      // Breakout not confirmed by volume
      if (!context.breakoutConfirmed) {
        score += 35;
        evidence.push(`Breakout volume ratio: ${context.breakoutVolumeRatio}x (need 1.4x+)`);
      }
      
      // Price closed back below pivot quickly
      if (trade.holdingDays <= 3 && context.entryVsPivotPct != null && context.entryVsPivotPct > 0) {
        score += 30;
        evidence.push(`Closed ${trade.holdingDays} days after breakout above pivot`);
      }
      
      // Entry was extended above pivot
      if (context.entryVsPivotPct > 3) {
        score += 15;
        evidence.push(`Entry was ${context.entryVsPivotPct}% above pivot (chasing)`);
      }
      
      // Volume was declining during breakout attempt
      if (context.breakoutVolumeRatio < 0.8) {
        score += 20;
        evidence.push('Volume declining during breakout attempt');
      }
      
      return { score, evidence };
    }
  },
  
  WEAK_BASE: {
    priority: 3,
    description: 'Base was too deep (>35%) or too short (<5 weeks)',
    check: (context, trade, exitData) => {
      const evidence = [];
      let score = 0;
      
      // Base too deep
      if (context.baseDepthPct > 35) {
        score += 40;
        evidence.push(`Base depth ${context.baseDepthPct}% (>35% is too deep)`);
      } else if (context.baseDepthPct > 25) {
        score += 15;
        evidence.push(`Base depth ${context.baseDepthPct}% (borderline deep)`);
      }
      
      // Base too short
      if (context.baseDurationDays < 25) { // ~5 weeks
        score += 35;
        evidence.push(`Base duration ${context.baseDurationDays} days (<5 weeks)`);
      } else if (context.baseDurationDays < 35) {
        score += 15;
        evidence.push(`Base duration ${context.baseDurationDays} days (short)`);
      }
      
      // Few contractions
      if (context.contractions < 2) {
        score += 20;
        evidence.push(`Only ${context.contractions} contractions (need 2+)`);
      }
      
      // No volume dry-up
      if (!context.volumeDryUp) {
        score += 10;
        evidence.push('Volume did not dry up during base');
      }
      
      return { score, evidence };
    }
  },
  
  LOW_RS: {
    priority: 4,
    description: 'Relative Strength was too low at entry',
    check: (context, trade, exitData) => {
      const evidence = [];
      let score = 0;
      
      // RS < 70 (below minimum)
      if (context.relativeStrength < 70) {
        score += 50;
        evidence.push(`RS ${context.relativeStrength} (<70 minimum)`);
      }
      // RS 70-80 (borderline)
      else if (context.relativeStrength < 80) {
        score += 30;
        evidence.push(`RS ${context.relativeStrength} (borderline, prefer 80+)`);
      }
      // RS 80-90 (acceptable but not elite)
      else if (context.relativeStrength < 90) {
        score += 10;
        evidence.push(`RS ${context.relativeStrength} (good but not elite)`);
      }
      
      // Stock underperforming market
      if (context.rsVsSpy6m < 0) {
        score += 20;
        evidence.push(`Underperforming SPY by ${Math.abs(context.rsVsSpy6m)}%`);
      }
      
      return { score, evidence };
    }
  },
  
  OVERHEAD_SUPPLY: {
    priority: 5,
    description: 'Too much resistance/supply above entry price',
    check: (context, trade, exitData) => {
      const evidence = [];
      let score = 0;
      
      // Entry far from 52w high (lots of overhead)
      if (context.pctFromHigh > 20) {
        score += 35;
        evidence.push(`Entry ${context.pctFromHigh}% below 52w high (heavy overhead)`);
      } else if (context.pctFromHigh > 15) {
        score += 20;
        evidence.push(`Entry ${context.pctFromHigh}% below 52w high`);
      }
      
      // MA alignment not proper (price fighting against falling MAs)
      if (!context.maAlignmentValid) {
        score += 25;
        evidence.push('MA alignment not proper (50 < 150 < 200)');
      }
      
      // 200 MA not rising (downtrend)
      if (!context.ma200Rising) {
        score += 15;
        evidence.push('200 MA not rising');
      }
      
      // Entry below key MAs
      if (!context.priceAboveAllMAs) {
        score += 20;
        evidence.push('Price not above all MAs at entry');
      }
      
      return { score, evidence };
    }
  },
  
  EARLY_ENTRY: {
    priority: 6,
    description: 'Entered before proper pivot/VCP completion',
    check: (context, trade, exitData) => {
      const evidence = [];
      let score = 0;
      
      // Entry below pivot
      if (context.entryVsPivotPct < 0) {
        score += 40;
        evidence.push(`Entered ${Math.abs(context.entryVsPivotPct)}% below pivot`);
      }
      
      // Low pattern confidence
      if (context.patternConfidence < 50) {
        score += 30;
        evidence.push(`Pattern confidence only ${context.patternConfidence}%`);
      }
      
      // VCP not valid
      if (!context.vcpValid) {
        score += 25;
        evidence.push('VCP pattern not valid');
      }
      
      // Few contractions
      if (context.contractions < 2) {
        score += 20;
        evidence.push(`Only ${context.contractions} contractions`);
      }
      
      // 10 MA slope not strong enough
      if (context.ma10Slope14d < 4) {
        score += 15;
        evidence.push(`10 MA slope only ${context.ma10Slope14d}% (need 4%+)`);
      }
      
      return { score, evidence };
    }
  },
  
  EARNINGS_GAP: {
    priority: 7,
    description: 'Stock gapped down on earnings announcement',
    check: async (context, trade, exitData) => {
      const evidence = [];
      let score = 0;
      
      // Check if exit was a large gap (>5% overnight)
      if (exitData && exitData.gapDownPct && exitData.gapDownPct > 5) {
        score += 50;
        evidence.push(`Gapped down ${exitData.gapDownPct}%`);
        
        // TODO: Cross-reference with earnings dates
        // This would require fetching earnings calendar
        evidence.push('Potential earnings-related gap');
      }
      
      // Very quick stop-out with large loss
      if (trade.holdingDays <= 2 && trade.returnPct < -5) {
        score += 30;
        evidence.push(`Lost ${Math.abs(trade.returnPct)}% in ${trade.holdingDays} days`);
      }
      
      return { score, evidence };
    }
  },
  
  SECTOR_ROTATION: {
    priority: 8,
    description: 'Sector/industry fell out of favor during hold period',
    check: (context, trade, exitData) => {
      const evidence = [];
      let score = 0;
      
      // Industry rank was poor at entry
      if (context.industryRank > 60) {
        score += 25;
        evidence.push(`Industry rank #${context.industryRank} (below average)`);
      }
      
      // Low conviction (user wasn't confident in sector)
      if (context.convictionLevel <= 2) {
        score += 15;
        evidence.push(`Low conviction level (${context.convictionLevel}/5)`);
      }
      
      // Longer hold with gradual decline suggests sector weakness
      if (trade.holdingDays > 10 && trade.returnPct > -8) {
        score += 20;
        evidence.push(`Slow bleed over ${trade.holdingDays} days (sector weakness pattern)`);
      }
      
      return { score, evidence };
    }
  },
  
  STOP_LOSS_TOO_TIGHT: {
    priority: 9,
    description: 'Normal volatility triggered stop (not a setup failure)',
    check: (context, trade, exitData) => {
      const evidence = [];
      let score = 0;
      
      // Exit right at stop loss
      if (trade.returnPct >= -4.5 && trade.returnPct <= -3.5) {
        score += 40;
        evidence.push(`Stopped out at ${trade.returnPct}% (right at 4% stop)`);
      }
      
      // Very short hold (volatility shakeout)
      if (trade.holdingDays <= 2 && trade.returnPct > -5) {
        score += 30;
        evidence.push(`Held only ${trade.holdingDays} days before stop hit`);
      }
      
      // Setup was actually good
      if (context.vcpValid && context.breakoutConfirmed && context.relativeStrength >= 80) {
        score += 25;
        evidence.push('Setup criteria were met (RS, VCP, volume confirmed)');
      }
      
      // Market was fine
      if (context.marketRegime === 'BULL' && !context.marketInCorrection) {
        score += 15;
        evidence.push('Market was in bull regime');
      }
      
      return { score, evidence };
    }
  }
};

/**
 * Calculate gap down percentage if applicable
 */
async function checkForGapDown(ticker, entryDate, exitDate) {
  if (!exitDate) return null;
  
  try {
    const from = new Date(exitDate);
    from.setDate(from.getDate() - 5);
    const to = new Date(exitDate);
    to.setDate(to.getDate() + 1);
    
    const bars = await getBars(ticker, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10));
    if (!bars || bars.length < 2) return null;
    
    const sorted = [...bars].sort((a, b) => a.t - b.t);
    const lastIdx = sorted.length - 1;
    
    // Check if last bar opened significantly lower than prior close
    const priorClose = sorted[lastIdx - 1]?.c;
    const openPrice = sorted[lastIdx]?.o;
    
    if (priorClose && openPrice) {
      const gapPct = ((openPrice - priorClose) / priorClose) * 100;
      if (gapPct < -2) {
        return Math.abs(gapPct);
      }
    }
    
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Classify why a trade failed
 * 
 * @param {Object} trade - The closed trade object
 * @returns {Promise<Object>} Classification result
 */
export async function classifyFailure(trade) {
  // Only classify losing trades
  if (!trade || trade.returnPct >= 0) {
    return null;
  }
  
  // Get the context snapshot from entry
  const context = await getContextSnapshotByTradeId(trade.id);
  
  if (!context) {
    return {
      tradeId: trade.id,
      primaryCategory: 'UNKNOWN',
      classificationConfidence: 0,
      evidence: { reason: 'No context snapshot available' },
      secondaryFactors: []
    };
  }
  
  // Check for gap down (earnings indicator)
  const gapDownPct = await checkForGapDown(trade.ticker, trade.entryDate, trade.exitDate);
  const exitData = { gapDownPct };
  
  // Run all classification rules
  const results = [];
  
  for (const [category, rule] of Object.entries(FAILURE_RULES)) {
    const result = await rule.check(context, trade, exitData);
    results.push({
      category,
      score: result.score,
      evidence: result.evidence,
      priority: rule.priority,
      description: rule.description
    });
  }
  
  // Sort by score (highest first)
  results.sort((a, b) => b.score - a.score);
  
  // Primary category is the highest scoring one with score >= 30
  let primary = results[0];
  if (primary.score < 30) {
    primary = {
      category: 'UNKNOWN',
      score: 0,
      evidence: ['No clear failure pattern detected'],
      description: 'Needs manual review'
    };
  }
  
  // Secondary factors are any others with score >= 20
  const secondary = results
    .filter(r => r.category !== primary.category && r.score >= 20)
    .map(r => ({
      category: r.category,
      score: r.score,
      evidence: r.evidence
    }));
  
  // Calculate confidence based on score spread
  const topScore = primary.score;
  const secondScore = results[1]?.score || 0;
  const scoreDiff = topScore - secondScore;
  
  // High confidence if clear winner, low if close call
  let confidence = Math.min(100, topScore + (scoreDiff * 2));
  if (topScore < 50) confidence = Math.min(50, confidence);
  
  const classification = {
    tradeId: trade.id,
    contextSnapshotId: context.id,
    primaryCategory: primary.category,
    classificationConfidence: Math.round(confidence),
    evidence: {
      primary: primary.evidence,
      all: results.filter(r => r.score > 0)
    },
    secondaryFactors: secondary
  };
  
  // Save to database
  if (isSupabaseConfigured()) {
    try {
      await saveClassification(classification);
    } catch (e) {
      console.error('Failed to save classification:', e.message);
    }
  }
  
  return classification;
}

/**
 * Save classification to Supabase
 */
async function saveClassification(classification) {
  const supabase = getSupabase();
  if (!supabase) return;
  
  const row = {
    trade_id: classification.tradeId,
    context_snapshot_id: classification.contextSnapshotId,
    primary_category: classification.primaryCategory,
    secondary_factors: classification.secondaryFactors,
    classification_confidence: classification.classificationConfidence,
    evidence: classification.evidence,
    analyzed_at: new Date().toISOString()
  };
  
  const { error } = await supabase
    .from('failure_classifications')
    .upsert(row, { onConflict: 'trade_id' });
  
  if (error) throw new Error(error.message);
}

/**
 * Classify all unclassified losing trades
 * 
 * @returns {Promise<Object>} Summary of classifications
 */
export async function classifyAllUnclassified() {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase required for batch classification');
  }
  
  const supabase = getSupabase();
  
  // Find losing trades without classifications
  const { data: trades, error } = await supabase
    .from('trades')
    .select('*')
    .eq('status', 'closed')
    .lt('return_pct', 0);
  
  if (error) throw new Error(error.message);
  
  // Get existing classifications
  const { data: existing } = await supabase
    .from('failure_classifications')
    .select('trade_id');
  
  const classifiedIds = new Set((existing || []).map(e => e.trade_id));
  
  // Filter to unclassified
  const unclassified = (trades || []).filter(t => !classifiedIds.has(t.id));
  
  console.log(`Classifying ${unclassified.length} unclassified losing trades...`);
  
  const results = {
    total: unclassified.length,
    classified: 0,
    byCategory: {}
  };
  
  for (const trade of unclassified) {
    // Convert snake_case to camelCase
    const tradeCamel = {
      id: trade.id,
      ticker: trade.ticker,
      entryDate: trade.entry_date,
      exitDate: trade.exit_date,
      returnPct: trade.return_pct,
      holdingDays: trade.holding_days
    };
    
    const classification = await classifyFailure(tradeCamel);
    
    if (classification) {
      results.classified++;
      const cat = classification.primaryCategory;
      results.byCategory[cat] = (results.byCategory[cat] || 0) + 1;
    }
  }
  
  console.log(`Classification complete:`, results);
  
  return results;
}

/**
 * Get failure classification for a trade
 * 
 * @param {string} tradeId - UUID of the trade
 * @returns {Promise<Object|null>} Classification or null
 */
export async function getClassification(tradeId) {
  if (!isSupabaseConfigured()) return null;
  
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('failure_classifications')
    .select('*')
    .eq('trade_id', tradeId)
    .single();
  
  if (error || !data) return null;
  
  return data;
}

/**
 * Get classification statistics
 * 
 * @returns {Promise<Object>} Category counts and percentages
 */
export async function getClassificationStats() {
  if (!isSupabaseConfigured()) return null;
  
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('failure_classifications')
    .select('primary_category');
  
  if (error) throw new Error(error.message);
  
  const counts = {};
  for (const row of (data || [])) {
    const cat = row.primary_category;
    counts[cat] = (counts[cat] || 0) + 1;
  }
  
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  
  const stats = {};
  for (const [cat, count] of Object.entries(counts)) {
    stats[cat] = {
      count,
      percentage: Math.round((count / total) * 100)
    };
  }
  
  return {
    total,
    byCategory: stats,
    topCategory: Object.entries(stats).sort((a, b) => b[1].count - a[1].count)[0]?.[0] || null
  };
}

export { FAILURE_RULES };
