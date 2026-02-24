/**
 * Self-Learning Trading System
 * 
 * Main entry point for all learning modules.
 * 
 * This system implements Minervini's self-improvement principle:
 * "The best traders learn more from their losses than their wins."
 * 
 * ARCHITECTURE:
 * 
 * ┌─────────────────────────────────────────────────────────────┐
 * │                    TRADE LIFECYCLE                          │
 * ├─────────────────────────────────────────────────────────────┤
 * │                                                              │
 * │  1. ENTRY (createTrade)                                     │
 * │     └─> createTradeContextSnapshot()                        │
 * │         └─> Captures: MAs, VCP, Volume, RS, Market, etc.   │
 * │                                                              │
 * │  2. HOLDING                                                  │
 * │     └─> checkAutoExits() [existing]                        │
 * │                                                              │
 * │  3. EXIT (closeTrade)                                       │
 * │     └─> if LOSS: analyzeLoss()                              │
 * │         └─> classifyFailure()                               │
 * │         └─> Check if pattern analysis needed                │
 * │                                                              │
 * │  4. PERIODIC ANALYSIS (every 10 trades)                     │
 * │     └─> analyzePatterns()                                   │
 * │     └─> updateSetupWinRates()                               │
 * │                                                              │
 * │  5. WEEKLY REPORT (Sunday)                                  │
 * │     └─> generateWeeklyReport()                              │
 * │     └─> applyLearnedWeights()                               │
 * │                                                              │
 * └─────────────────────────────────────────────────────────────┘
 * 
 * MODULES:
 * - tradeContext.js    - Capture full entry context snapshot
 * - distributionDays.js - Track market condition (IBD-style)
 * - failureClassifier.js - Classify why trades failed
 * - lossAnalyzer.js    - Analyze losses, find patterns
 * - breakoutConfirm.js - Validate breakout quality
 * - adaptiveScoring.js - Learn from historical outcomes
 * - weeklyReport.js    - Generate "What I Learned" reports
 */

// Trade Context Snapshot
export {
  createTradeContextSnapshot,
  getContextSnapshotByTradeId,
  getContextSnapshots,
  calculateAllMAs,
  calculateBaseMetrics,
  calculate52WeekStats,
  calculateBreakoutVolume
} from './tradeContext.js';

// Distribution Days & Market Condition
export {
  getCurrentMarketCondition,
  getHistoricalMarketConditions,
  isMarketInCorrection,
  getMarketRegimeForSizing,
  isDistributionDay,
  countDistributionDays,
  checkFollowThroughDay,
  determineMarketRegime
} from './distributionDays.js';

// Failure Classification
export {
  classifyFailure,
  classifyAllUnclassified,
  getClassification,
  getClassificationStats,
  FAILURE_RULES
} from './failureClassifier.js';

// Loss Analysis & Pattern Recognition
export {
  analyzeLoss,
  analyzePatterns,
  getLatestPatternAnalysis,
  generateInsights,
  analyzeCorrelations,
  findOptimalRanges
} from './lossAnalyzer.js';

// Breakout Confirmation
export {
  analyzeBreakout,
  checkVolumeConfirmation,
  calculatePivotPrice,
  validateBreakoutEntry,
  getBreakoutStats,
  calculate50DayAvgVolume
} from './breakoutConfirm.js';

// Adaptive Scoring
export {
  getHistoricalWinRate,
  adjustConfidenceFromHistory,
  updateSetupWinRates,
  applyLearnedWeights,
  getEffectiveWeights,
  calculateAdaptiveConfidence,
  getBucket,
  BUCKETS
} from './adaptiveScoring.js';

// Weekly Reports
export {
  generateWeeklyReport,
  getAllWeeklyReports,
  getLatestWeeklyReport,
  formatReportAsMarkdown,
  generateKeyLearnings,
  generateActionItems
} from './weeklyReport.js';

// Historical Signal Scanner
export {
  scanTickerForSignals,
  scanMultipleTickers,
  getTickerList,
  simulateTrade,
  captureContext
} from './historicalSignalScanner.js';

// Cross-Stock Pattern Analysis
export {
  analyzeFactorWinRate,
  analyzeFactorByObjective,
  analyzeAllFactors,
  findOptimalSetup,
  analyzePatternTypes,
  analyzeExitTypes,
  generateWeightRecommendations,
  runCrossStockAnalysis,
  calculateExpectancy,
  computeSignalMetrics,
  FACTORS,
  getBucketLabel
} from './crossStockAnalyzer.js';

// Auto-Populate (Main Entry Point for Historical Learning)
export {
  runHistoricalAnalysis,
  quickAnalysis,
  getLatestAnalysis,
  getStoredSignals,
  storeSignalsInDatabase,
  storeAnalysisResults
} from './autoPopulate.js';

// Auto-Optimize (Self-Tuning Opus4.5 Weights)
export {
  generateOptimizedWeights,
  storeOptimizedWeights,
  loadOptimizedWeights,
  runWeightOptimization,
  compareWeights,
  storeLearningRun,
  loadLatestLearningRun,
  loadLearningRunHistory,
  archiveLearningRuns,
  FACTOR_TO_WEIGHT_MAP
} from './autoOptimize.js';

// Iterative Profitability Optimizer
export {
  runIterativeOptimization,
  runIterativeOptimizationWithProgress,
  runOptimizationIteration,
  analyzeFactorProfitability,
  generateProfitabilityWeights,
  evaluateWeightsOnSignals,
  compareControlVariant
} from './iterativeOptimizer.js';

/**
 * Hook: Call this when a new trade is created
 * 
 * Automatically captures the full entry context for later analysis.
 * 
 * @param {Object} params - Trade creation parameters
 * @returns {Promise<Object>} Context snapshot
 */
export async function onTradeCreated(params) {
  const { createTradeContextSnapshot } = await import('./tradeContext.js');
  return createTradeContextSnapshot(params);
}

/**
 * Hook: Call this when a trade is closed with a loss
 * 
 * Automatically analyzes the loss and updates learning data.
 * 
 * @param {Object} trade - The closed trade
 * @returns {Promise<Object>} Loss analysis result
 */
export async function onTradeClosed(trade) {
  if (!trade || trade.returnPct >= 0) {
    return { skipped: true, reason: 'Not a loss' };
  }
  
  const { analyzeLoss } = await import('./lossAnalyzer.js');
  const analysis = await analyzeLoss(trade);
  
  // Check if we should run pattern analysis
  if (analysis.shouldAnalyzePatterns) {
    const { analyzePatterns } = await import('./lossAnalyzer.js');
    const { updateSetupWinRates } = await import('./adaptiveScoring.js');
    
    console.log('🔄 Triggering pattern analysis (10+ trades since last)...');
    await analyzePatterns();
    await updateSetupWinRates();
  }
  
  return analysis;
}

/**
 * Run the full weekly learning cycle
 * 
 * This should be called once per week (e.g., Sunday) to:
 * 1. Generate the weekly report
 * 2. Update setup win rates
 * 3. Apply any learned weight adjustments
 * 
 * @returns {Promise<Object>} Weekly cycle results
 */
export async function runWeeklyLearningCycle() {
  console.log('📚 Running weekly learning cycle...');
  
  const results = {
    report: null,
    winRates: null,
    weights: null
  };
  
  // Step 1: Generate weekly report
  try {
    const { generateWeeklyReport } = await import('./weeklyReport.js');
    results.report = await generateWeeklyReport();
    console.log('✅ Weekly report generated');
  } catch (e) {
    console.error('❌ Weekly report failed:', e.message);
    results.report = { error: e.message };
  }
  
  // Step 2: Update setup win rates
  try {
    const { updateSetupWinRates } = await import('./adaptiveScoring.js');
    results.winRates = await updateSetupWinRates();
    console.log('✅ Setup win rates updated');
  } catch (e) {
    console.error('❌ Win rates update failed:', e.message);
    results.winRates = { error: e.message };
  }
  
  // Step 3: Apply learned weights (if any)
  try {
    const { applyLearnedWeights } = await import('./adaptiveScoring.js');
    results.weights = await applyLearnedWeights();
    console.log('✅ Weight adjustments processed');
  } catch (e) {
    console.error('❌ Weight adjustment failed:', e.message);
    results.weights = { error: e.message };
  }
  
  console.log('📚 Weekly learning cycle complete');
  
  return results;
}

/**
 * Get a comprehensive learning dashboard summary
 * 
 * Returns all key learning metrics in one call.
 * 
 * @returns {Promise<Object>} Learning dashboard data
 */
export async function getLearningDashboard() {
  const { getClassificationStats } = await import('./failureClassifier.js');
  const { getLatestPatternAnalysis } = await import('./lossAnalyzer.js');
  const { getLatestWeeklyReport } = await import('./weeklyReport.js');
  const { getCurrentMarketCondition } = await import('./distributionDays.js');
  const { getBreakoutStats } = await import('./breakoutConfirm.js');
  const { getEffectiveWeights } = await import('./adaptiveScoring.js');
  
  const [
    failureStats,
    patternAnalysis,
    weeklyReport,
    marketCondition,
    breakoutStats,
    weights
  ] = await Promise.all([
    getClassificationStats().catch(() => null),
    getLatestPatternAnalysis().catch(() => null),
    getLatestWeeklyReport().catch(() => null),
    getCurrentMarketCondition().catch(() => null),
    getBreakoutStats().catch(() => null),
    getEffectiveWeights().catch(() => ({ weights: null, source: 'default' }))
  ]);
  
  return {
    // Current market state
    market: marketCondition ? {
      regime: marketCondition.marketRegime,
      distributionDays: Math.max(
        marketCondition.spyDistributionCount25d || 0,
        marketCondition.qqqDistributionCount25d || 0
      ),
      spyAbove50ma: marketCondition.spyAbove50ma,
      inCorrection: (marketCondition.spyDistributionCount25d || 0) >= 5
    } : null,
    
    // Failure analysis summary
    failures: failureStats ? {
      totalAnalyzed: failureStats.total,
      topCategory: failureStats.topCategory,
      breakdown: failureStats.byCategory
    } : null,
    
    // Pattern insights
    patterns: patternAnalysis ? {
      winRate: patternAnalysis.win_rate,
      topWinPredictor: patternAnalysis.top_win_predictors?.[0]?.factor,
      optimalRS: patternAnalysis.optimal_rs_range,
      suggestedChanges: patternAnalysis.suggested_weight_changes?.length || 0
    } : null,
    
    // Breakout stats
    breakouts: breakoutStats,
    
    // Current weights
    weights: {
      source: weights.source,
      lastUpdated: weights.lastUpdated
    },
    
    // Latest report summary
    latestReport: weeklyReport ? {
      weekStart: weeklyReport.week_start,
      winRate: weeklyReport.win_rate,
      grossReturn: weeklyReport.gross_return_pct,
      keyLearningCount: weeklyReport.key_learnings?.length || 0,
      actionItemCount: weeklyReport.action_items?.length || 0
    } : null
  };
}

/**
 * Validate a potential entry using all learning modules
 * 
 * This is the entry point for the enhanced signal validation
 * that incorporates all learned insights.
 * 
 * @param {Object} params - Entry parameters
 * @returns {Promise<Object>} Validation result with confidence
 */
export async function validateEntryWithLearning(params) {
  const {
    bars,
    vcpResult,
    opus45Signal,
    fundamentals,
    industryData
  } = params;
  
  const { validateBreakoutEntry, calculatePivotPrice } = await import('./breakoutConfirm.js');
  const { calculateAdaptiveConfidence } = await import('./adaptiveScoring.js');
  const { getCurrentMarketCondition } = await import('./distributionDays.js');
  
  // Get market condition
  const marketCondition = await getCurrentMarketCondition();
  
  // Validate breakout quality
  const pivot = calculatePivotPrice(bars);
  const breakoutValidation = validateBreakoutEntry(bars, pivot.pivotPrice);
  
  // Build setup for confidence adjustment
  const setup = {
    relativeStrength: vcpResult?.relativeStrength,
    contractions: vcpResult?.contractions,
    pullbackPct: vcpResult?.baseDepthPct || 0,
    industryRank: industryData?.rank,
    marketRegime: marketCondition?.marketRegime,
    marketInCorrection: marketCondition?.spyDistributionCount25d >= 5,
    distributionDays: marketCondition?.spyDistributionCount25d
  };
  
  // Calculate adaptive confidence
  const baseConfidence = opus45Signal?.opus45Confidence || 50;
  const adaptiveConfidence = await calculateAdaptiveConfidence(baseConfidence, setup);
  
  // Generate warnings
  const warnings = [];
  
  if (!breakoutValidation.valid) {
    warnings.push(...breakoutValidation.issues);
  }
  
  if (marketCondition?.marketRegime === 'CORRECTION') {
    warnings.push('Market in correction - avoid new longs');
  } else if ((marketCondition?.spyDistributionCount25d || 0) >= 4) {
    warnings.push(`${marketCondition.spyDistributionCount25d} distribution days - use caution`);
  }
  
  if (adaptiveConfidence.historicalData?.winRate < 30) {
    warnings.push(`Similar setups have only ${adaptiveConfidence.historicalData.winRate}% historical win rate`);
  }
  
  // Final recommendation
  let recommendation = 'PASS';
  if (warnings.length >= 3 || adaptiveConfidence.finalConfidence < 40) {
    recommendation = 'AVOID';
  } else if (warnings.length >= 1 || adaptiveConfidence.finalConfidence < 60) {
    recommendation = 'CAUTION';
  }
  
  return {
    recommendation,
    confidence: {
      base: adaptiveConfidence.baseConfidence,
      adjusted: adaptiveConfidence.finalConfidence,
      adjustments: adaptiveConfidence.adjustments
    },
    breakout: breakoutValidation,
    market: {
      regime: marketCondition?.marketRegime,
      distributionDays: marketCondition?.spyDistributionCount25d
    },
    historical: adaptiveConfidence.historicalData,
    warnings
  };
}
