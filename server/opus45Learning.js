/**
 * Opus4.5 Learning System
 * 
 * Analyzes backtest results to optimize signal weights and thresholds.
 * Uses a "Medium" complexity approach:
 * 1. Factor importance ranking based on win rates
 * 2. Automatic threshold tuning
 * 3. Weight adjustment recommendations
 * 
 * The system learns from historical trades to improve future signal quality.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_WEIGHTS, MANDATORY_THRESHOLDS } from './opus45Signal.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const LEARNING_DIR = path.join(DATA_DIR, 'opus45-learning');

// ============================================================================
// FILE MANAGEMENT
// ============================================================================

function ensureLearningDir() {
  if (!fs.existsSync(LEARNING_DIR)) {
    fs.mkdirSync(LEARNING_DIR, { recursive: true });
  }
}

/**
 * Load the current optimized weights
 * Falls back to default weights if no optimization exists
 */
export function loadOptimizedWeights() {
  ensureLearningDir();
  const filepath = path.join(LEARNING_DIR, 'optimized-weights.json');
  
  if (!fs.existsSync(filepath)) {
    return { ...DEFAULT_WEIGHTS };
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    return { ...DEFAULT_WEIGHTS, ...data.weights };
  } catch (e) {
    console.error('Error loading optimized weights:', e.message);
    return { ...DEFAULT_WEIGHTS };
  }
}

/**
 * Save optimized weights
 */
function saveOptimizedWeights(weights, analysis) {
  ensureLearningDir();
  const filepath = path.join(LEARNING_DIR, 'optimized-weights.json');
  
  const data = {
    weights,
    lastOptimized: new Date().toISOString(),
    basedOnTrades: analysis.totalTrades,
    overallWinRate: analysis.overallWinRate,
    improvements: analysis.improvements || [],
    version: (loadOptimizedWeights()._version || 0) + 1,
    _version: 1
  };
  
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`✅ Optimized weights saved (version ${data.version})`);
  
  return data;
}

/**
 * Load learning history (all optimization runs)
 */
export function loadLearningHistory() {
  ensureLearningDir();
  const filepath = path.join(LEARNING_DIR, 'learning-history.json');
  
  if (!fs.existsSync(filepath)) {
    return [];
  }
  
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch (e) {
    return [];
  }
}

/**
 * Append to learning history
 */
function appendToHistory(analysis) {
  ensureLearningDir();
  const filepath = path.join(LEARNING_DIR, 'learning-history.json');
  
  const history = loadLearningHistory();
  history.push({
    timestamp: new Date().toISOString(),
    ...analysis
  });
  
  // Keep last 100 analyses
  const trimmed = history.slice(-100);
  fs.writeFileSync(filepath, JSON.stringify(trimmed, null, 2), 'utf8');
}

// ============================================================================
// FACTOR ANALYSIS
// ============================================================================

/**
 * Analyze which factors are most predictive of success
 * Groups trades by factor presence and compares win rates
 * 
 * @param {Array} trades - Array of trade results with metrics
 * @returns {Object} Factor importance rankings
 */
export function analyzeFactorImportance(trades) {
  if (!trades || trades.length < 20) {
    return {
      error: 'Insufficient data',
      message: 'Need at least 20 trades for factor analysis',
      trades: trades?.length || 0
    };
  }
  
  // Define factors to analyze
  const factors = [
    { name: 'contractions_3plus', check: t => (t.contractions || 0) >= 3, category: 'vcp' },
    { name: 'contractions_4plus', check: t => (t.contractions || 0) >= 4, category: 'vcp' },
    { name: 'volume_dryup', check: t => t.volumeDryUp === true, category: 'vcp' },
    { name: 'pattern_confidence_60plus', check: t => (t.patternConfidence || 0) >= 60, category: 'vcp' },
    { name: 'rs_70plus', check: t => (t.relativeStrength || 0) >= 70, category: 'entry' },
    { name: 'rs_80plus', check: t => (t.relativeStrength || 0) >= 80, category: 'entry' },
    { name: 'rs_90plus', check: t => (t.relativeStrength || 0) >= 90, category: 'entry' },
    { name: 'at_10ma', check: t => t.atMa10 === true, category: 'entry' },
    { name: 'at_20ma', check: t => t.atMa20 === true, category: 'entry' },
    { name: 'industry_top20', check: t => (t.industryRank || 999) <= 20, category: 'fundamentals' },
    { name: 'industry_top40', check: t => (t.industryRank || 999) <= 40, category: 'fundamentals' },
    { name: 'institutional_50plus', check: t => (t.institutionalOwnership || 0) >= 50, category: 'fundamentals' },
    { name: 'eps_positive', check: t => (t.epsGrowth || 0) > 0, category: 'fundamentals' },
    { name: 'score_80plus', check: t => (t.enhancedScore || 0) >= 80, category: 'overall' },
    { name: 'score_90plus', check: t => (t.enhancedScore || 0) >= 90, category: 'overall' },
  ];
  
  const results = [];
  const overallWinRate = trades.filter(t => t.outcome === 'WIN').length / trades.length;
  
  for (const factor of factors) {
    const withFactor = trades.filter(factor.check);
    const withoutFactor = trades.filter(t => !factor.check(t));
    
    if (withFactor.length < 5 || withoutFactor.length < 5) {
      results.push({
        factor: factor.name,
        category: factor.category,
        withFactorCount: withFactor.length,
        withoutFactorCount: withoutFactor.length,
        impact: 'INSUFFICIENT_DATA'
      });
      continue;
    }
    
    const winRateWith = withFactor.filter(t => t.outcome === 'WIN').length / withFactor.length;
    const winRateWithout = withoutFactor.filter(t => t.outcome === 'WIN').length / withoutFactor.length;
    
    const avgReturnWith = withFactor.reduce((s, t) => s + (t.forwardReturn || 0), 0) / withFactor.length;
    const avgReturnWithout = withoutFactor.reduce((s, t) => s + (t.forwardReturn || 0), 0) / withoutFactor.length;
    
    // Impact = how much this factor improves win rate over baseline
    const winRateLift = winRateWith - winRateWithout;
    const returnLift = avgReturnWith - avgReturnWithout;
    
    // Calculate importance score (combination of lift and reliability)
    const sampleSizeWeight = Math.min(1, withFactor.length / 30);  // Full weight at 30+ samples
    const importanceScore = (winRateLift * 50 + returnLift) * sampleSizeWeight;
    
    let impact = 'NEUTRAL';
    if (importanceScore > 5) impact = 'STRONG_POSITIVE';
    else if (importanceScore > 2) impact = 'POSITIVE';
    else if (importanceScore < -5) impact = 'STRONG_NEGATIVE';
    else if (importanceScore < -2) impact = 'NEGATIVE';
    
    results.push({
      factor: factor.name,
      category: factor.category,
      withFactorCount: withFactor.length,
      withoutFactorCount: withoutFactor.length,
      winRateWith: Math.round(winRateWith * 1000) / 10,
      winRateWithout: Math.round(winRateWithout * 1000) / 10,
      winRateLift: Math.round(winRateLift * 1000) / 10,
      avgReturnWith: Math.round(avgReturnWith * 10) / 10,
      avgReturnWithout: Math.round(avgReturnWithout * 10) / 10,
      returnLift: Math.round(returnLift * 10) / 10,
      importanceScore: Math.round(importanceScore * 10) / 10,
      impact
    });
  }
  
  // Sort by importance score
  results.sort((a, b) => (b.importanceScore || 0) - (a.importanceScore || 0));
  
  return {
    totalTrades: trades.length,
    overallWinRate: Math.round(overallWinRate * 1000) / 10,
    factors: results,
    topPositiveFactors: results.filter(f => f.impact === 'STRONG_POSITIVE' || f.impact === 'POSITIVE').slice(0, 5),
    topNegativeFactors: results.filter(f => f.impact === 'STRONG_NEGATIVE' || f.impact === 'NEGATIVE').slice(0, 3)
  };
}

// ============================================================================
// WEIGHT OPTIMIZATION
// ============================================================================

/**
 * Generate weight adjustments based on factor analysis
 * 
 * @param {Object} factorAnalysis - Result from analyzeFactorImportance()
 * @param {Object} currentWeights - Current weight configuration
 * @returns {Object} Suggested weight adjustments
 */
export function generateWeightAdjustments(factorAnalysis, currentWeights = DEFAULT_WEIGHTS) {
  if (factorAnalysis.error) {
    return { error: factorAnalysis.error, adjustments: [] };
  }
  
  const adjustments = [];
  const newWeights = { ...currentWeights };
  
  // Map factors to weights
  const factorToWeight = {
    'contractions_3plus': 'vcpContractions3Plus',
    'contractions_4plus': 'vcpContractions4Plus',
    'volume_dryup': 'vcpVolumeDryUp',
    'pattern_confidence_60plus': 'vcpPatternConfidence',
    'at_10ma': 'entryAt10MA',
    'at_20ma': 'entryAt20MA',
    'rs_90plus': 'entryRSAbove90',
    'industry_top20': 'industryTop20',
    'industry_top40': 'industryTop40',
    'institutional_50plus': 'institutionalOwnership',
    'eps_positive': 'epsGrowthPositive',
    'rs_80plus': 'relativeStrengthBonus'
  };
  
  for (const factor of factorAnalysis.factors) {
    const weightKey = factorToWeight[factor.factor];
    if (!weightKey || !currentWeights[weightKey]) continue;
    
    const currentWeight = currentWeights[weightKey];
    let suggestedChange = 0;
    let reason = '';
    
    // Strong positive impact -> increase weight
    if (factor.impact === 'STRONG_POSITIVE' && factor.importanceScore > 5) {
      suggestedChange = Math.min(5, Math.round(currentWeight * 0.25));
      reason = `Factor shows ${factor.winRateLift}% win rate lift`;
    }
    // Positive impact -> slight increase
    else if (factor.impact === 'POSITIVE' && factor.importanceScore > 2) {
      suggestedChange = Math.min(3, Math.round(currentWeight * 0.15));
      reason = `Factor shows moderate positive impact`;
    }
    // Negative impact -> decrease weight
    else if (factor.impact === 'STRONG_NEGATIVE') {
      suggestedChange = -Math.min(5, Math.round(currentWeight * 0.30));
      reason = `Factor shows ${factor.winRateLift}% win rate drag`;
    }
    else if (factor.impact === 'NEGATIVE') {
      suggestedChange = -Math.min(3, Math.round(currentWeight * 0.20));
      reason = `Factor shows negative correlation`;
    }
    
    if (suggestedChange !== 0) {
      const newWeight = Math.max(0, currentWeight + suggestedChange);
      newWeights[weightKey] = newWeight;
      
      adjustments.push({
        factor: factor.factor,
        weightKey,
        currentWeight,
        suggestedChange,
        newWeight,
        reason,
        confidence: factor.withFactorCount >= 30 ? 'HIGH' : factor.withFactorCount >= 15 ? 'MEDIUM' : 'LOW'
      });
    }
  }
  
  // Normalize weights to keep total similar
  const currentTotal = Object.values(currentWeights).reduce((a, b) => a + b, 0);
  const newTotal = Object.values(newWeights).reduce((a, b) => a + b, 0);
  const scaleFactor = currentTotal / newTotal;
  
  // Only normalize if change is significant (>10%)
  if (Math.abs(1 - scaleFactor) > 0.10) {
    for (const key of Object.keys(newWeights)) {
      newWeights[key] = Math.round(newWeights[key] * scaleFactor);
    }
  }
  
  return {
    currentWeights,
    newWeights,
    adjustments,
    totalAdjustments: adjustments.length,
    impactSummary: {
      highConfidence: adjustments.filter(a => a.confidence === 'HIGH').length,
      mediumConfidence: adjustments.filter(a => a.confidence === 'MEDIUM').length,
      lowConfidence: adjustments.filter(a => a.confidence === 'LOW').length
    }
  };
}

// ============================================================================
// THRESHOLD OPTIMIZATION
// ============================================================================

/**
 * Analyze optimal thresholds for mandatory criteria
 * Tests different threshold values to find optimal win rates
 * 
 * @param {Array} trades - Array of trade results
 * @returns {Object} Threshold optimization suggestions
 */
export function optimizeThresholds(trades) {
  if (!trades || trades.length < 30) {
    return { error: 'Insufficient data for threshold optimization' };
  }
  
  const suggestions = [];
  
  // Test RS thresholds (60, 70, 80, 90)
  const rsThresholds = [60, 70, 80, 90];
  const rsResults = [];
  
  for (const threshold of rsThresholds) {
    const matching = trades.filter(t => (t.relativeStrength || 0) >= threshold);
    if (matching.length < 10) continue;
    
    const winRate = matching.filter(t => t.outcome === 'WIN').length / matching.length;
    const avgReturn = matching.reduce((s, t) => s + (t.forwardReturn || 0), 0) / matching.length;
    
    rsResults.push({
      threshold,
      matchingTrades: matching.length,
      winRate: Math.round(winRate * 1000) / 10,
      avgReturn: Math.round(avgReturn * 10) / 10,
      // Score = win rate * sqrt(sample size) to balance accuracy with confidence
      score: winRate * Math.sqrt(matching.length)
    });
  }
  
  if (rsResults.length > 0) {
    rsResults.sort((a, b) => b.score - a.score);
    const bestRS = rsResults[0];
    const currentRS = MANDATORY_THRESHOLDS.minRelativeStrength;
    
    if (bestRS.threshold !== currentRS && bestRS.matchingTrades >= 15) {
      suggestions.push({
        parameter: 'minRelativeStrength',
        currentValue: currentRS,
        suggestedValue: bestRS.threshold,
        reason: `RS >= ${bestRS.threshold} shows ${bestRS.winRate}% win rate (${bestRS.matchingTrades} trades)`,
        allResults: rsResults
      });
    }
  }
  
  // Test contraction thresholds (1, 2, 3, 4)
  const contractionThresholds = [1, 2, 3, 4];
  const contractionResults = [];
  
  for (const threshold of contractionThresholds) {
    const matching = trades.filter(t => (t.contractions || 0) >= threshold);
    if (matching.length < 10) continue;
    
    const winRate = matching.filter(t => t.outcome === 'WIN').length / matching.length;
    const avgReturn = matching.reduce((s, t) => s + (t.forwardReturn || 0), 0) / matching.length;
    
    contractionResults.push({
      threshold,
      matchingTrades: matching.length,
      winRate: Math.round(winRate * 1000) / 10,
      avgReturn: Math.round(avgReturn * 10) / 10,
      score: winRate * Math.sqrt(matching.length)
    });
  }
  
  if (contractionResults.length > 0) {
    contractionResults.sort((a, b) => b.score - a.score);
    const bestContr = contractionResults[0];
    const currentContr = MANDATORY_THRESHOLDS.minContractions;
    
    if (bestContr.threshold !== currentContr && bestContr.matchingTrades >= 15) {
      suggestions.push({
        parameter: 'minContractions',
        currentValue: currentContr,
        suggestedValue: bestContr.threshold,
        reason: `${bestContr.threshold}+ contractions shows ${bestContr.winRate}% win rate`,
        allResults: contractionResults
      });
    }
  }
  
  return {
    suggestions,
    rsAnalysis: rsResults,
    contractionAnalysis: contractionResults,
    currentThresholds: MANDATORY_THRESHOLDS
  };
}

// ============================================================================
// MAIN LEARNING PIPELINE
// ============================================================================

/**
 * Run the complete learning pipeline on backtest results
 * 
 * @param {Object} backtestResults - Results from backtest.js calculateForwardReturns()
 * @param {boolean} autoApply - Whether to automatically apply weight changes
 * @returns {Object} Complete learning analysis with recommendations
 */
export function runLearningPipeline(backtestResults, autoApply = false) {
  console.log('\n🧠 Running Opus4.5 Learning Pipeline...\n');
  
  // Validate input
  if (!backtestResults?.results || backtestResults.results.length < 20) {
    return {
      error: 'INSUFFICIENT_DATA',
      message: `Need at least 20 valid trades, got ${backtestResults?.results?.length || 0}`,
      applied: false
    };
  }
  
  // Filter to valid trades only
  const validTrades = backtestResults.results.filter(
    t => t.outcome !== 'NO_DATA' && t.outcome !== 'ERROR' && t.outcome !== 'NO_SIGNAL'
  );
  
  console.log(`📊 Analyzing ${validTrades.length} valid trades...`);
  
  // Step 1: Factor importance analysis
  const factorAnalysis = analyzeFactorImportance(validTrades);
  console.log(`\n📈 Factor Analysis Complete:`);
  console.log(`   Overall Win Rate: ${factorAnalysis.overallWinRate}%`);
  console.log(`   Top Positive Factors: ${factorAnalysis.topPositiveFactors?.length || 0}`);
  console.log(`   Top Negative Factors: ${factorAnalysis.topNegativeFactors?.length || 0}`);
  
  // Step 2: Weight adjustments
  const currentWeights = loadOptimizedWeights();
  const weightAdjustments = generateWeightAdjustments(factorAnalysis, currentWeights);
  console.log(`\n⚖️ Weight Adjustments:`);
  console.log(`   Total Adjustments: ${weightAdjustments.totalAdjustments}`);
  console.log(`   High Confidence: ${weightAdjustments.impactSummary?.highConfidence || 0}`);
  
  // Step 3: Threshold optimization
  const thresholdOptimization = optimizeThresholds(validTrades);
  console.log(`\n🎯 Threshold Optimization:`);
  console.log(`   Suggestions: ${thresholdOptimization.suggestions?.length || 0}`);
  
  // Step 4: Generate summary
  const summary = {
    scanDate: backtestResults.scanDate,
    daysForward: backtestResults.daysForward,
    analyzedAt: new Date().toISOString(),
    totalTrades: validTrades.length,
    overallWinRate: factorAnalysis.overallWinRate,
    
    factorAnalysis: {
      topPositive: factorAnalysis.topPositiveFactors,
      topNegative: factorAnalysis.topNegativeFactors
    },
    
    weightAdjustments: {
      adjustments: weightAdjustments.adjustments,
      totalChanges: weightAdjustments.totalAdjustments,
      newWeights: weightAdjustments.newWeights
    },
    
    thresholdSuggestions: thresholdOptimization.suggestions,
    
    improvements: [],
    applied: false
  };
  
  // Identify key improvements
  if (weightAdjustments.adjustments?.length > 0) {
    for (const adj of weightAdjustments.adjustments.slice(0, 3)) {
      summary.improvements.push(
        `${adj.suggestedChange > 0 ? '↑' : '↓'} ${adj.factor}: ${adj.reason}`
      );
    }
  }
  
  // Step 5: Optionally apply changes
  if (autoApply && weightAdjustments.adjustments?.length > 0) {
    // Only auto-apply if we have high-confidence adjustments
    const highConfidenceCount = weightAdjustments.impactSummary?.highConfidence || 0;
    
    if (highConfidenceCount >= 2 && factorAnalysis.overallWinRate > 50) {
      console.log('\n✅ Auto-applying weight adjustments...');
      saveOptimizedWeights(weightAdjustments.newWeights, summary);
      summary.applied = true;
    } else {
      console.log('\n⚠️ Not enough confidence for auto-apply. Review manually.');
    }
  }
  
  // Save to history
  appendToHistory(summary);
  
  // Save detailed report
  ensureLearningDir();
  const reportFile = path.join(LEARNING_DIR, `report-${backtestResults.scanDate}.json`);
  fs.writeFileSync(reportFile, JSON.stringify({
    ...summary,
    factorAnalysisComplete: factorAnalysis,
    weightAdjustmentsComplete: weightAdjustments,
    thresholdOptimizationComplete: thresholdOptimization
  }, null, 2), 'utf8');
  console.log(`\n📄 Report saved: report-${backtestResults.scanDate}.json`);
  
  return summary;
}

/**
 * Manually apply weight changes after review
 */
export function applyWeightChanges(newWeights) {
  ensureLearningDir();
  
  const analysis = {
    totalTrades: 0,
    overallWinRate: 0,
    improvements: ['Manual weight update'],
    applied: true
  };
  
  return saveOptimizedWeights(newWeights, analysis);
}

/**
 * Reset weights to defaults
 */
export function resetWeightsToDefault() {
  ensureLearningDir();
  
  const filepath = path.join(LEARNING_DIR, 'optimized-weights.json');
  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath);
  }
  
  console.log('✅ Weights reset to defaults');
  return DEFAULT_WEIGHTS;
}

/**
 * Get learning system status
 */
export function getLearningStatus() {
  const weights = loadOptimizedWeights();
  const history = loadLearningHistory();
  const lastOptimization = history.length > 0 ? history[history.length - 1] : null;
  
  return {
    currentWeights: weights,
    isOptimized: Object.keys(weights).some(k => weights[k] !== DEFAULT_WEIGHTS[k]),
    defaultWeights: DEFAULT_WEIGHTS,
    lastOptimization: lastOptimization ? {
      date: lastOptimization.timestamp,
      trades: lastOptimization.totalTrades,
      winRate: lastOptimization.overallWinRate,
      applied: lastOptimization.applied
    } : null,
    totalOptimizationRuns: history.length
  };
}
