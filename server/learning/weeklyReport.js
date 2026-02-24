/**
 * Weekly Learning Report Generator
 * 
 * Generates a "What I Learned This Week" summary including:
 * - Trade activity (opened, closed, performance)
 * - Failure analysis breakdown
 * - Key learnings and insights
 * - Pattern discoveries
 * - Recommended actions for next week
 * 
 * This report is the human-readable output of the self-learning system.
 * It should be generated every Sunday or on-demand.
 */

import { getSupabase, isSupabaseConfigured } from '../supabase.js';
import { getAllTrades } from '../trades.js';
import { getClassificationStats } from './failureClassifier.js';
import { getLatestPatternAnalysis, analyzePatterns } from './lossAnalyzer.js';
import { getBreakoutStats } from './breakoutConfirm.js';
import { getHistoricalMarketConditions } from './distributionDays.js';

/**
 * Generate the weekly learning report
 * 
 * @param {Date|string} weekEndDate - The end date of the week (default: today)
 * @returns {Promise<Object>} The weekly report
 */
export async function generateWeeklyReport(weekEndDate = null) {
  const endDate = weekEndDate ? new Date(weekEndDate) : new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 7);
  
  const weekStart = startDate.toISOString().slice(0, 10);
  const weekEnd = endDate.toISOString().slice(0, 10);
  
  console.log(`📊 Generating weekly report: ${weekStart} to ${weekEnd}`);
  
  // Get all trades
  const allTrades = await getAllTrades();
  
  // Filter to trades active this week
  const tradesOpenedThisWeek = allTrades.filter(t => {
    const entryDate = t.entryDate || t.entry_date;
    return entryDate >= weekStart && entryDate <= weekEnd;
  });
  
  const tradesClosedThisWeek = allTrades.filter(t => {
    const exitDate = t.exitDate || t.exit_date;
    const status = t.status;
    return exitDate >= weekStart && exitDate <= weekEnd && status !== 'open';
  });
  
  // Calculate performance metrics
  const closedReturns = tradesClosedThisWeek
    .map(t => t.returnPct ?? t.return_pct)
    .filter(r => r != null);
  
  const grossReturn = closedReturns.length > 0
    ? closedReturns.reduce((a, b) => a + b, 0)
    : 0;
  
  const winners = closedReturns.filter(r => r > 0);
  const winRate = closedReturns.length > 0
    ? Math.round((winners.length / closedReturns.length) * 100)
    : null;
  
  // Best and worst trades
  let bestTrade = null;
  let worstTrade = null;
  
  if (tradesClosedThisWeek.length > 0) {
    const sorted = [...tradesClosedThisWeek].sort((a, b) => 
      (b.returnPct ?? b.return_pct ?? 0) - (a.returnPct ?? a.return_pct ?? 0)
    );
    bestTrade = {
      ticker: sorted[0].ticker,
      returnPct: sorted[0].returnPct ?? sorted[0].return_pct
    };
    worstTrade = {
      ticker: sorted[sorted.length - 1].ticker,
      returnPct: sorted[sorted.length - 1].returnPct ?? sorted[sorted.length - 1].return_pct
    };
  }
  
  // Get failure analysis for this week's losses
  const losses = tradesClosedThisWeek.filter(t => (t.returnPct ?? t.return_pct) < 0);
  const failureStats = await getClassificationStats();
  
  // Get latest pattern analysis
  let patternAnalysis = await getLatestPatternAnalysis();
  
  // If pattern analysis is old or missing, run a new one
  if (!patternAnalysis || allTrades.filter(t => t.status !== 'open').length > 10) {
    try {
      patternAnalysis = await analyzePatterns();
    } catch (e) {
      console.warn('Could not run pattern analysis:', e.message);
    }
  }
  
  // Get market conditions for the week
  let marketSummary = { regime: 'UNKNOWN', distributionDays: 0 };
  try {
    const conditions = await getHistoricalMarketConditions(weekStart, weekEnd);
    if (conditions && conditions.length > 0) {
      const lastCondition = conditions[conditions.length - 1];
      marketSummary = {
        regime: lastCondition.market_regime,
        distributionDays: lastCondition.spy_distribution_count_25d
      };
    }
  } catch (e) {
    console.warn('Could not get market conditions:', e.message);
  }
  
  // Generate key learnings
  const keyLearnings = generateKeyLearnings(
    tradesClosedThisWeek,
    failureStats,
    patternAnalysis,
    marketSummary
  );
  
  // Generate action items
  const actionItems = generateActionItems(
    failureStats,
    patternAnalysis,
    marketSummary
  );
  
  // Get breakout stats
  let breakoutInsights = null;
  try {
    breakoutInsights = await getBreakoutStats();
  } catch (e) {
    console.warn('Could not get breakout stats:', e.message);
  }
  
  // Compile the report
  const report = {
    weekStart,
    weekEnd,
    
    // Trade activity
    tradesOpened: tradesOpenedThisWeek.length,
    tradesClosed: tradesClosedThisWeek.length,
    
    // Performance
    grossReturnPct: Math.round(grossReturn * 10) / 10,
    bestTradeTicker: bestTrade?.ticker,
    bestTradeReturn: bestTrade?.returnPct,
    worstTradeTicker: worstTrade?.ticker,
    worstTradeReturn: worstTrade?.returnPct,
    winRate,
    
    // Failures
    newFailuresAnalyzed: losses.length,
    failureBreakdown: failureStats?.byCategory || {},
    
    // Key learnings
    keyLearnings,
    
    // Pattern changes
    newPatternsDiscovered: extractNewPatterns(patternAnalysis),
    patternsConfirmed: extractConfirmedPatterns(patternAnalysis),
    patternsInvalidated: [],
    
    // Weight adjustments
    weightAdjustments: patternAnalysis?.suggestedWeightChanges || [],
    
    // Market condition
    marketRegimeThisWeek: marketSummary.regime,
    distributionDaysThisWeek: marketSummary.distributionDays,
    
    // Action items
    actionItems,
    
    // Confidence
    learningQualityScore: calculateLearningQuality(
      tradesClosedThisWeek.length,
      patternAnalysis?.statisticalConfidence || 0
    ),
    
    reportGeneratedAt: new Date().toISOString()
  };
  
  // Save to database
  if (isSupabaseConfigured()) {
    await saveWeeklyReport(report);
  }
  
  console.log('✅ Weekly report generated');
  
  return report;
}

/**
 * Generate key learnings from the week's data
 */
function generateKeyLearnings(trades, failureStats, patternAnalysis, marketSummary) {
  const learnings = [];
  
  // Learning 1: Top failure category
  if (failureStats?.topCategory) {
    const topCat = failureStats.topCategory;
    const pct = failureStats.byCategory[topCat]?.percentage || 0;
    
    const actionByCategory = {
      'MARKET_CONDITION': 'Reduce position size when distribution days > 4',
      'FALSE_BREAKOUT': 'Require volume confirmation (40%+ above avg)',
      'WEAK_BASE': 'Require minimum 5-week base with <35% depth',
      'LOW_RS': 'Focus on RS 90+ stocks only',
      'EARLY_ENTRY': 'Wait for price to clear pivot on volume',
      'OVERHEAD_SUPPLY': 'Prefer stocks within 10% of 52-week high'
    };
    
    learnings.push({
      insight: `${pct}% of losses were due to ${topCat.replace(/_/g, ' ').toLowerCase()}`,
      evidence: `Top failure category in analysis`,
      action: actionByCategory[topCat] || 'Review entry criteria',
      priority: 'high'
    });
  }
  
  // Learning 2: Pattern analysis insights
  if (patternAnalysis?.topWinPredictors?.length > 0) {
    const topPredictor = patternAnalysis.topWinPredictors[0];
    learnings.push({
      insight: `${topPredictor.factor} is the strongest win predictor`,
      evidence: `Winners avg ${topPredictor.winAvg} vs losers ${topPredictor.lossAvg}`,
      action: `Prioritize stocks with high ${topPredictor.factor}`,
      priority: 'high'
    });
  }
  
  // Learning 3: Market condition impact
  if (marketSummary.regime === 'CORRECTION' || marketSummary.distributionDays >= 5) {
    learnings.push({
      insight: 'Market was in correction - reduced win probability',
      evidence: `${marketSummary.distributionDays} distribution days`,
      action: 'Reduce exposure or avoid new longs in correction',
      priority: 'high'
    });
  }
  
  // Learning 4: Win rate by condition
  if (patternAnalysis?.marketConditionImpact) {
    const bestRegime = Object.entries(patternAnalysis.marketConditionImpact)
      .filter(([_, v]) => v.trades >= 3)
      .sort((a, b) => b[1].winRate - a[1].winRate)[0];
    
    if (bestRegime) {
      learnings.push({
        insight: `Best results in ${bestRegime[0]} market: ${bestRegime[1].winRate}% win rate`,
        evidence: `Based on ${bestRegime[1].trades} trades`,
        action: 'Size up in favorable market conditions',
        priority: 'medium'
      });
    }
  }
  
  // Learning 5: Optimal ranges
  if (patternAnalysis?.optimalRsRange) {
    learnings.push({
      insight: `Optimal RS range: ${patternAnalysis.optimalRsRange.min}-${patternAnalysis.optimalRsRange.max}`,
      evidence: `Based on winning trades (ideal: ${patternAnalysis.optimalRsRange.ideal})`,
      action: 'Filter for stocks in optimal RS range',
      priority: 'medium'
    });
  }
  
  return learnings;
}

/**
 * Generate action items for next week
 */
function generateActionItems(failureStats, patternAnalysis, marketSummary) {
  const actions = [];
  
  // Action 1: Based on market condition
  if (marketSummary.distributionDays >= 4) {
    actions.push({
      action: 'Reduce new long positions until distribution days decrease',
      reason: `Currently at ${marketSummary.distributionDays} distribution days`,
      priority: 'high'
    });
  } else if (marketSummary.regime === 'BULL') {
    actions.push({
      action: 'Normal position sizing allowed - market conditions favorable',
      reason: 'Market in confirmed uptrend',
      priority: 'low'
    });
  }
  
  // Action 2: Based on failure patterns
  if (failureStats?.topCategory === 'FALSE_BREAKOUT') {
    actions.push({
      action: 'Double-check volume confirmation before every entry',
      reason: 'False breakouts are the top failure category',
      priority: 'high'
    });
  }
  
  if (failureStats?.topCategory === 'WEAK_BASE') {
    actions.push({
      action: 'Add base quality filter: minimum 5 weeks, <35% depth',
      reason: 'Weak bases are leading to failures',
      priority: 'high'
    });
  }
  
  // Action 3: Based on pattern analysis
  if (patternAnalysis?.suggestedWeightChanges?.length > 0) {
    const topSuggestion = patternAnalysis.suggestedWeightChanges[0];
    actions.push({
      action: `Consider adjusting ${topSuggestion.weight}: ${topSuggestion.suggestedChange}`,
      reason: topSuggestion.reason,
      priority: 'medium'
    });
  }
  
  // Action 4: Review manual items
  if (failureStats?.byCategory?.UNKNOWN?.count > 0) {
    actions.push({
      action: `Review ${failureStats.byCategory.UNKNOWN.count} unclassified losses manually`,
      reason: 'These need human analysis to classify',
      priority: 'medium'
    });
  }
  
  return actions;
}

/**
 * Extract new patterns discovered from analysis
 */
function extractNewPatterns(patternAnalysis) {
  if (!patternAnalysis) return [];
  
  const patterns = [];
  
  // Check for strong correlations
  for (const predictor of (patternAnalysis.topWinPredictors || [])) {
    if (predictor.strength > 30) {
      patterns.push({
        pattern: `High ${predictor.factor} correlates with wins`,
        strength: predictor.strength,
        data: predictor
      });
    }
  }
  
  return patterns;
}

/**
 * Extract confirmed patterns from analysis
 */
function extractConfirmedPatterns(patternAnalysis) {
  if (!patternAnalysis) return [];
  
  const confirmed = [];
  
  // RS correlation is almost always confirmed
  if (patternAnalysis.winCorrelations?.relativeStrength > 
      patternAnalysis.lossCorrelations?.relativeStrength) {
    confirmed.push({
      pattern: 'Higher RS correlates with better outcomes',
      confidence: 'high'
    });
  }
  
  // Market regime impact
  if (patternAnalysis.marketConditionImpact?.BULL?.winRate > 
      patternAnalysis.marketConditionImpact?.BEAR?.winRate) {
    confirmed.push({
      pattern: 'Bull market produces higher win rate than bear',
      confidence: 'high'
    });
  }
  
  return confirmed;
}

/**
 * Calculate learning quality score
 */
function calculateLearningQuality(tradesThisWeek, patternConfidence) {
  let score = 0;
  
  // More trades = better learning
  if (tradesThisWeek >= 5) score += 30;
  else if (tradesThisWeek >= 3) score += 20;
  else if (tradesThisWeek >= 1) score += 10;
  
  // Pattern analysis confidence
  score += patternConfidence * 0.5;
  
  // Cap at 100
  return Math.min(100, Math.round(score));
}

/**
 * Save weekly report to database
 */
async function saveWeeklyReport(report) {
  const supabase = getSupabase();
  if (!supabase) return;
  
  const row = {
    week_start: report.weekStart,
    week_end: report.weekEnd,
    trades_opened: report.tradesOpened,
    trades_closed: report.tradesClosed,
    gross_return_pct: report.grossReturnPct,
    best_trade_ticker: report.bestTradeTicker,
    best_trade_return: report.bestTradeReturn,
    worst_trade_ticker: report.worstTradeTicker,
    worst_trade_return: report.worstTradeReturn,
    win_rate: report.winRate,
    new_failures_analyzed: report.newFailuresAnalyzed,
    failure_breakdown: report.failureBreakdown,
    key_learnings: report.keyLearnings,
    new_patterns_discovered: report.newPatternsDiscovered,
    patterns_confirmed: report.patternsConfirmed,
    patterns_invalidated: report.patternsInvalidated,
    weight_adjustments: report.weightAdjustments,
    market_regime_this_week: report.marketRegimeThisWeek,
    distribution_days_this_week: report.distributionDaysThisWeek,
    action_items: report.actionItems,
    learning_quality_score: report.learningQualityScore,
    report_generated_at: report.reportGeneratedAt
  };
  
  const { error } = await supabase
    .from('weekly_learning_reports')
    .upsert(row, { onConflict: 'week_start' });
  
  if (error) {
    console.error('Failed to save weekly report:', error.message);
  }
}

/**
 * Get all weekly reports
 */
export async function getAllWeeklyReports() {
  if (!isSupabaseConfigured()) return [];
  
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('weekly_learning_reports')
    .select('*')
    .order('week_start', { ascending: false });
  
  if (error) throw new Error(error.message);
  return data || [];
}

/**
 * Get the latest weekly report
 */
export async function getLatestWeeklyReport() {
  if (!isSupabaseConfigured()) return null;
  
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('weekly_learning_reports')
    .select('*')
    .order('week_start', { ascending: false })
    .limit(1)
    .single();
  
  if (error) return null;
  return data;
}

/**
 * Format report as markdown for display
 */
export function formatReportAsMarkdown(report) {
  if (!report) return 'No report available.';
  
  const lines = [
    `# Weekly Learning Report`,
    `**Week:** ${report.weekStart || report.week_start} to ${report.weekEnd || report.week_end}`,
    '',
    '## Trade Activity',
    `- Trades Opened: ${report.tradesOpened ?? report.trades_opened}`,
    `- Trades Closed: ${report.tradesClosed ?? report.trades_closed}`,
    `- Gross Return: ${(report.grossReturnPct ?? report.gross_return_pct)?.toFixed(1)}%`,
    `- Win Rate: ${report.winRate ?? report.win_rate}%`,
    '',
    '## Best & Worst',
    `- Best: ${report.bestTradeTicker ?? report.best_trade_ticker} (+${(report.bestTradeReturn ?? report.best_trade_return)?.toFixed(1)}%)`,
    `- Worst: ${report.worstTradeTicker ?? report.worst_trade_ticker} (${(report.worstTradeReturn ?? report.worst_trade_return)?.toFixed(1)}%)`,
    '',
    '## Market Conditions',
    `- Regime: ${report.marketRegimeThisWeek ?? report.market_regime_this_week}`,
    `- Distribution Days: ${report.distributionDaysThisWeek ?? report.distribution_days_this_week}`,
    '',
    '## Key Learnings'
  ];
  
  const learnings = report.keyLearnings ?? report.key_learnings ?? [];
  for (const learning of learnings) {
    lines.push(`### ${learning.insight}`);
    lines.push(`- Evidence: ${learning.evidence}`);
    lines.push(`- Action: ${learning.action}`);
    lines.push(`- Priority: ${learning.priority}`);
    lines.push('');
  }
  
  lines.push('## Action Items');
  const actions = report.actionItems ?? report.action_items ?? [];
  for (const action of actions) {
    lines.push(`- [${action.priority.toUpperCase()}] ${action.action}`);
    lines.push(`  - Reason: ${action.reason}`);
  }
  
  lines.push('');
  lines.push(`---`);
  lines.push(`*Learning Quality Score: ${report.learningQualityScore ?? report.learning_quality_score}/100*`);
  lines.push(`*Generated: ${report.reportGeneratedAt ?? report.report_generated_at}*`);
  
  return lines.join('\n');
}

export { generateKeyLearnings, generateActionItems };
