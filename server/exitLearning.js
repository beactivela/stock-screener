/**
 * Exit Learning Agent
 * 
 * Analyzes why Opus4.5 buy signals stopped out vs went profitable.
 * Learns from both manual trade journal entries and automated backtest exits.
 * 
 * KEY QUESTIONS:
 * 1. What indicators predict early stop-outs (< 5 days)?
 * 2. What MA/volume patterns distinguish winners from losers?
 * 3. Which entry metrics (slope, RS, contractions) correlate with hold time?
 * 4. Are there setup patterns that consistently fail?
 * 
 * LEARNING APPROACH:
 * - Segment exits by outcome: early stop, late stop, profitable exit
 * - Compare entry metrics between segments
 * - Identify "red flags" that predict failure
 * - Generate actionable filters to improve signal quality
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAllTrades } from './trades.js';
import { getBars } from './yahoo.js';
import { sma, findPullbacks, nearMA } from './vcp.js';
import { analyzeFactorImportance } from './opus45Learning.js';
import { getSupabase, isSupabaseConfigured } from './supabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const EXIT_LEARNING_DIR = path.join(DATA_DIR, 'exit-learning');

// ============================================================================
// FILE MANAGEMENT
// ============================================================================

function ensureExitLearningDir() {
  if (!fs.existsSync(EXIT_LEARNING_DIR)) {
    fs.mkdirSync(EXIT_LEARNING_DIR, { recursive: true });
  }
}

/**
 * Save exit analysis report
 */
function saveExitAnalysis(analysis) {
  ensureExitLearningDir();
  const timestamp = new Date().toISOString().slice(0, 10);
  const filepath = path.join(EXIT_LEARNING_DIR, `exit-analysis-${timestamp}.json`);
  fs.writeFileSync(filepath, JSON.stringify(analysis, null, 2), 'utf8');
  console.log(`📊 Exit analysis saved: ${filepath}`);
  return filepath;
}

/**
 * Load exit learning history
 */
export function loadExitLearningHistory() {
  ensureExitLearningDir();
  const files = fs.readdirSync(EXIT_LEARNING_DIR)
    .filter(f => f.startsWith('exit-analysis-') && f.endsWith('.json'))
    .sort()
    .reverse();
  
  return files.slice(0, 10).map(f => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(EXIT_LEARNING_DIR, f), 'utf8'));
      return { filename: f, date: data.analysisDate, summary: data.summary };
    } catch (e) {
      return null;
    }
  }).filter(Boolean);
}

// ============================================================================
// EXIT PATTERN ANALYSIS
// ============================================================================

/**
 * Classify exits into categories based on outcome and timing
 * 
 * Categories:
 * - EARLY_STOP: Stopped out in < 5 days (likely bad entry or false signal)
 * - LATE_STOP: Stopped out after 5+ days (good entry, trend failed)
 * - SMALL_WIN: Exited 0-5% profit (marginal win, maybe should have held)
 * - GOOD_WIN: Exited 5-15% profit (target reached)
 * - BIG_WIN: Exited 15%+ profit (home run)
 * 
 * @param {Array} trades - Closed trades with exit data
 * @returns {Object} Categorized trades
 */
export function categorizeExits(trades) {
  const categories = {
    EARLY_STOP: [],
    LATE_STOP: [],
    SMALL_WIN: [],
    GOOD_WIN: [],
    BIG_WIN: []
  };
  
  for (const trade of trades) {
    const days = trade.holdingDays || 0;
    const returnPct = trade.returnPct || 0;
    
    if (returnPct <= 0) {
      // Losers - categorize by hold time
      if (days < 5) {
        categories.EARLY_STOP.push(trade);
      } else {
        categories.LATE_STOP.push(trade);
      }
    } else {
      // Winners - categorize by profit size
      if (returnPct < 5) {
        categories.SMALL_WIN.push(trade);
      } else if (returnPct < 15) {
        categories.GOOD_WIN.push(trade);
      } else {
        categories.BIG_WIN.push(trade);
      }
    }
  }
  
  return categories;
}

/**
 * Analyze entry metrics across exit categories
 * Finds which metrics differentiate good from bad exits
 * 
 * @param {Object} categories - Categorized trades
 * @returns {Object} Metric comparison across categories
 */
export function analyzeMetricsByExitType(categories) {
  const metrics = [
    'contractions',
    'relativeStrength',
    'opus45Confidence',
    'vcpScore',
    'enhancedScore',
    'patternConfidence',
    'industryRank',
    'volumeDryUp'
  ];
  
  const analysis = {};
  
  for (const metric of metrics) {
    const byCategory = {};
    
    for (const [category, trades] of Object.entries(categories)) {
      const values = trades
        .map(t => t.entryMetrics?.[metric])
        .filter(v => v != null && v !== false && v !== true);
      
      if (values.length === 0) continue;
      
      const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
      const min = Math.min(...values);
      const max = Math.max(...values);
      const median = values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
      
      byCategory[category] = {
        count: values.length,
        avg: Math.round(avg * 10) / 10,
        min,
        max,
        median
      };
    }
    
    analysis[metric] = byCategory;
  }
  
  return analysis;
}

/**
 * Identify "red flags" - metrics that correlate with early stop-outs
 * 
 * @param {Object} metricAnalysis - Result from analyzeMetricsByExitType
 * @returns {Array} List of red flag conditions
 */
export function identifyRedFlags(metricAnalysis) {
  const redFlags = [];
  
  for (const [metric, byCategory] of Object.entries(metricAnalysis)) {
    const earlyStop = byCategory.EARLY_STOP;
    const goodWin = byCategory.GOOD_WIN || byCategory.BIG_WIN;
    
    if (!earlyStop || !goodWin) continue;
    
    // If early stops have significantly lower values than good wins
    const diff = goodWin.avg - earlyStop.avg;
    const diffPct = Math.abs(diff / earlyStop.avg) * 100;
    
    if (diffPct > 15) {
      // Meaningful difference
      redFlags.push({
        metric,
        earlyStopAvg: earlyStop.avg,
        goodWinAvg: goodWin.avg,
        difference: Math.round(diff * 10) / 10,
        differencePct: Math.round(diffPct),
        recommendation: diff > 0 
          ? `Avoid ${metric} below ${Math.round(earlyStop.avg * 1.1)}` 
          : `Prefer ${metric} below ${Math.round(earlyStop.avg * 0.9)}`
      });
    }
  }
  
  // Sort by impact (difference %)
  redFlags.sort((a, b) => b.differencePct - a.differencePct);
  
  return redFlags;
}

// ============================================================================
// POST-ENTRY BEHAVIOR ANALYSIS
// ============================================================================

/**
 * Analyze how price/MA behavior differs between winners and losers
 * in the first 5 days after entry
 * 
 * @param {Array} trades - Trades with historical bars available
 * @returns {Object} Behavioral patterns
 */
async function analyzePostEntryBehavior(trades) {
  const winners = trades.filter(t => (t.returnPct || 0) > 0);
  const losers = trades.filter(t => (t.returnPct || 0) <= 0);
  
  const patterns = {
    winners: {
      avgDaysAbove10MA: 0,
      avgMaxGainFirst5Days: 0,
      avgVolatilityFirst5Days: 0,
      sampleSize: 0
    },
    losers: {
      avgDaysAbove10MA: 0,
      avgMaxGainFirst5Days: 0,
      avgVolatilityFirst5Days: 0,
      sampleSize: 0
    }
  };
  
  // Analyze winners
  for (const trade of winners.slice(0, 20)) { // Limit to avoid API rate limits
    try {
      const behavior = await analyzeTradePostEntry(trade);
      if (behavior) {
        patterns.winners.avgDaysAbove10MA += behavior.daysAbove10MA;
        patterns.winners.avgMaxGainFirst5Days += behavior.maxGainFirst5Days;
        patterns.winners.avgVolatilityFirst5Days += behavior.volatilityFirst5Days;
        patterns.winners.sampleSize++;
      }
    } catch (e) {
      console.warn(`Error analyzing winner ${trade.ticker}:`, e.message);
    }
  }
  
  // Analyze losers
  for (const trade of losers.slice(0, 20)) {
    try {
      const behavior = await analyzeTradePostEntry(trade);
      if (behavior) {
        patterns.losers.avgDaysAbove10MA += behavior.daysAbove10MA;
        patterns.losers.avgMaxGainFirst5Days += behavior.maxGainFirst5Days;
        patterns.losers.avgVolatilityFirst5Days += behavior.volatilityFirst5Days;
        patterns.losers.sampleSize++;
      }
    } catch (e) {
      console.warn(`Error analyzing loser ${trade.ticker}:`, e.message);
    }
  }
  
  // Calculate averages
  if (patterns.winners.sampleSize > 0) {
    patterns.winners.avgDaysAbove10MA = Math.round(patterns.winners.avgDaysAbove10MA / patterns.winners.sampleSize * 10) / 10;
    patterns.winners.avgMaxGainFirst5Days = Math.round(patterns.winners.avgMaxGainFirst5Days / patterns.winners.sampleSize * 10) / 10;
    patterns.winners.avgVolatilityFirst5Days = Math.round(patterns.winners.avgVolatilityFirst5Days / patterns.winners.sampleSize * 10) / 10;
  }
  
  if (patterns.losers.sampleSize > 0) {
    patterns.losers.avgDaysAbove10MA = Math.round(patterns.losers.avgDaysAbove10MA / patterns.losers.sampleSize * 10) / 10;
    patterns.losers.avgMaxGainFirst5Days = Math.round(patterns.losers.avgMaxGainFirst5Days / patterns.losers.sampleSize * 10) / 10;
    patterns.losers.avgVolatilityFirst5Days = Math.round(patterns.losers.avgVolatilityFirst5Days / patterns.losers.sampleSize * 10) / 10;
  }
  
  return patterns;
}

/**
 * Analyze individual trade's post-entry behavior
 * 
 * @param {Object} trade - Trade object
 * @returns {Object|null} Behavior metrics or null
 */
async function analyzeTradePostEntry(trade) {
  if (!trade.entryDate || !trade.ticker) return null;
  
  try {
    // Get bars from entry date + 10 days
    const entryDate = new Date(trade.entryDate);
    const fromDate = new Date(entryDate);
    fromDate.setDate(fromDate.getDate() - 30); // Get 30 days before for MA calculation
    
    const toDate = new Date(entryDate);
    toDate.setDate(toDate.getDate() + 15); // Get 15 days after entry
    
    const bars = await getBars(
      trade.ticker,
      fromDate.toISOString().slice(0, 10),
      toDate.toISOString().slice(0, 10)
    );
    
    if (!bars || bars.length < 40) return null;
    
    // Sort bars by date
    const sortedBars = [...bars].sort((a, b) => a.t - b.t);
    
    // Find entry bar
    const entryTs = entryDate.getTime();
    const entryIdx = sortedBars.findIndex(b => b.t >= entryTs);
    
    if (entryIdx === -1 || entryIdx + 5 >= sortedBars.length) return null;
    
    // Calculate 10 MA
    const closes = sortedBars.map(b => b.c);
    const ma10 = sma(closes, 10);
    
    // Analyze first 5 days after entry
    let daysAbove10MA = 0;
    let maxGainFirst5Days = 0;
    const entryPrice = trade.entryPrice;
    
    const first5DayCloses = [];
    
    for (let i = 0; i < 5 && (entryIdx + i) < sortedBars.length; i++) {
      const idx = entryIdx + i;
      const close = sortedBars[idx].c;
      const ma = ma10[idx];
      
      first5DayCloses.push(close);
      
      // Check if above 10 MA
      if (ma && close > ma) {
        daysAbove10MA++;
      }
      
      // Track max gain
      const gain = ((close - entryPrice) / entryPrice) * 100;
      if (gain > maxGainFirst5Days) {
        maxGainFirst5Days = gain;
      }
    }
    
    // Calculate volatility (standard deviation of returns)
    const returns = [];
    for (let i = 1; i < first5DayCloses.length; i++) {
      returns.push(((first5DayCloses[i] - first5DayCloses[i-1]) / first5DayCloses[i-1]) * 100);
    }
    
    const avgReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const volatility = Math.sqrt(variance);
    
    return {
      daysAbove10MA,
      maxGainFirst5Days: Math.round(maxGainFirst5Days * 10) / 10,
      volatilityFirst5Days: Math.round(volatility * 10) / 10
    };
    
  } catch (e) {
    console.warn(`Error in analyzeTradePostEntry for ${trade.ticker}:`, e.message);
    return null;
  }
}

// ============================================================================
// CONVICTION ANALYSIS
// ============================================================================

/**
 * Analyze if user conviction ratings correlate with outcomes
 * 
 * @param {Array} trades - Closed trades
 * @returns {Object} Conviction vs outcome analysis
 */
export function analyzeConvictionAccuracy(trades) {
  const byConviction = {};
  
  for (let level = 1; level <= 5; level++) {
    const tradesAtLevel = trades.filter(t => t.conviction === level);
    
    if (tradesAtLevel.length === 0) continue;
    
    const winners = tradesAtLevel.filter(t => (t.returnPct || 0) > 0);
    const earlyStops = tradesAtLevel.filter(t => (t.returnPct || 0) <= 0 && (t.holdingDays || 0) < 5);
    
    const avgReturn = tradesAtLevel.reduce((s, t) => s + (t.returnPct || 0), 0) / tradesAtLevel.length;
    const avgHoldDays = tradesAtLevel.reduce((s, t) => s + (t.holdingDays || 0), 0) / tradesAtLevel.length;
    
    byConviction[level] = {
      count: tradesAtLevel.length,
      winRate: Math.round((winners.length / tradesAtLevel.length) * 100),
      earlyStopRate: Math.round((earlyStops.length / tradesAtLevel.length) * 100),
      avgReturn: Math.round(avgReturn * 10) / 10,
      avgHoldDays: Math.round(avgHoldDays * 10) / 10
    };
  }
  
  return byConviction;
}

// ============================================================================
// MAIN EXIT LEARNING PIPELINE
// ============================================================================

/**
 * Run complete exit learning analysis
 * 
 * @param {Object} options - { includeBehaviorAnalysis: boolean }
 * @returns {Object} Complete exit learning report
 */
export async function runExitLearning(options = {}) {
  console.log('\n🧠 Running Exit Learning Analysis...\n');
  
  // Load all trades
  const allTrades = await getAllTrades();
  const closedTrades = allTrades.filter(t => t.status !== 'open' && t.returnPct != null);
  
  if (closedTrades.length < 5) {
    return {
      error: 'INSUFFICIENT_DATA',
      message: `Need at least 5 closed trades, got ${closedTrades.length}`,
      recommendation: 'Continue trading and logging exits to build learning dataset'
    };
  }
  
  console.log(`📊 Analyzing ${closedTrades.length} closed trades...`);
  
  // Step 1: Categorize exits
  const categories = categorizeExits(closedTrades);
  console.log(`\n📋 Exit Categories:`);
  console.log(`   Early Stops (<5d): ${categories.EARLY_STOP.length}`);
  console.log(`   Late Stops (5+d): ${categories.LATE_STOP.length}`);
  console.log(`   Small Wins (0-5%): ${categories.SMALL_WIN.length}`);
  console.log(`   Good Wins (5-15%): ${categories.GOOD_WIN.length}`);
  console.log(`   Big Wins (15%+): ${categories.BIG_WIN.length}`);
  
  // Step 2: Analyze metrics by exit type
  const metricAnalysis = analyzeMetricsByExitType(categories);
  console.log(`\n📈 Metric Analysis Complete`);
  
  // Step 3: Identify red flags
  const redFlags = identifyRedFlags(metricAnalysis);
  console.log(`\n🚩 Red Flags Identified: ${redFlags.length}`);
  if (redFlags.length > 0) {
    redFlags.slice(0, 3).forEach(flag => {
      console.log(`   - ${flag.recommendation} (${flag.differencePct}% impact)`);
    });
  }
  
  // Step 4: Conviction analysis
  const convictionAnalysis = analyzeConvictionAccuracy(closedTrades);
  console.log(`\n🎯 Conviction Analysis Complete`);
  
  // Step 5: Post-entry behavior (optional - slower due to API calls)
  let behaviorAnalysis = null;
  if (options.includeBehaviorAnalysis && closedTrades.length >= 10) {
    console.log(`\n⏱️  Analyzing post-entry behavior (this may take a minute)...`);
    behaviorAnalysis = await analyzePostEntryBehavior(closedTrades);
    console.log(`   ✓ Behavior analysis complete`);
  }
  
  // Step 6: Generate summary and recommendations
  const summary = {
    analysisDate: new Date().toISOString(),
    totalTradesClosed: closedTrades.length,
    overallWinRate: Math.round((categories.SMALL_WIN.length + categories.GOOD_WIN.length + categories.BIG_WIN.length) / closedTrades.length * 100),
    earlyStopRate: Math.round(categories.EARLY_STOP.length / closedTrades.length * 100),
    avgHoldTime: Math.round(closedTrades.reduce((s, t) => s + (t.holdingDays || 0), 0) / closedTrades.length * 10) / 10
  };
  
  const keyLearnings = generateKeyLearnings(categories, redFlags, convictionAnalysis, behaviorAnalysis);
  const recommendations = generateExitRecommendations(redFlags, behaviorAnalysis, categories);
  
  const analysis = {
    summary,
    categories,
    metricAnalysis,
    redFlags,
    convictionAnalysis,
    behaviorAnalysis,
    keyLearnings,
    recommendations
  };
  
  // Save to file
  const filepath = saveExitAnalysis(analysis);
  
  console.log(`\n✅ Exit learning complete!`);
  console.log(`\n🔑 Key Learnings:`);
  keyLearnings.forEach((learning, i) => {
    console.log(`   ${i + 1}. ${learning}`);
  });
  
  console.log(`\n💡 Recommendations:`);
  recommendations.forEach((rec, i) => {
    console.log(`   ${i + 1}. ${rec}`);
  });
  
  return analysis;
}

/**
 * Generate key learnings from analysis
 */
function generateKeyLearnings(categories, redFlags, convictionAnalysis, behaviorAnalysis) {
  const learnings = [];
  
  // Early stop analysis
  const earlyStopRate = categories.EARLY_STOP.length / (categories.EARLY_STOP.length + categories.LATE_STOP.length + categories.SMALL_WIN.length + categories.GOOD_WIN.length + categories.BIG_WIN.length);
  if (earlyStopRate > 0.3) {
    learnings.push(`High early stop-out rate (${Math.round(earlyStopRate * 100)}%) - need tighter entry filters`);
  }
  
  // Red flag analysis
  if (redFlags.length > 0) {
    const topFlag = redFlags[0];
    learnings.push(`${topFlag.metric} is a key predictor: early stops avg ${topFlag.earlyStopAvg} vs winners ${topFlag.goodWinAvg}`);
  }
  
  // Conviction analysis
  const convictionLevels = Object.keys(convictionAnalysis);
  if (convictionLevels.length > 2) {
    const highConviction = convictionAnalysis[5] || convictionAnalysis[4];
    const lowConviction = convictionAnalysis[1] || convictionAnalysis[2];
    
    if (highConviction && lowConviction && highConviction.winRate > lowConviction.winRate + 20) {
      learnings.push(`High conviction trades significantly outperform (${highConviction.winRate}% vs ${lowConviction.winRate}% win rate)`);
    } else if (highConviction && lowConviction && highConviction.winRate < lowConviction.winRate) {
      learnings.push(`⚠️ Low conviction trades outperforming high conviction - review selection criteria`);
    }
  }
  
  // Behavior analysis
  if (behaviorAnalysis && behaviorAnalysis.winners.sampleSize > 5 && behaviorAnalysis.losers.sampleSize > 5) {
    const winnerDays = behaviorAnalysis.winners.avgDaysAbove10MA;
    const loserDays = behaviorAnalysis.losers.avgDaysAbove10MA;
    
    if (winnerDays > loserDays + 1) {
      learnings.push(`Winners stay above 10 MA longer in first 5 days (${winnerDays} vs ${loserDays} days)`);
    }
    
    const winnerGain = behaviorAnalysis.winners.avgMaxGainFirst5Days;
    const loserGain = behaviorAnalysis.losers.avgMaxGainFirst5Days;
    
    if (winnerGain > loserGain + 2) {
      learnings.push(`Winners show immediate momentum: ${winnerGain}% max gain in first 5 days vs ${loserGain}% for losers`);
    }
  }
  
  // Win size distribution
  const bigWins = categories.BIG_WIN.length;
  const goodWins = categories.GOOD_WIN.length;
  const smallWins = categories.SMALL_WIN.length;
  
  if (bigWins > goodWins + smallWins) {
    learnings.push(`Home runs dominate (${bigWins} big wins) - current strategy favors letting winners run`);
  } else if (smallWins > goodWins + bigWins) {
    learnings.push(`Many small wins (${smallWins}) - consider holding longer or tightening entry for bigger moves`);
  }
  
  return learnings;
}

/**
 * Generate actionable recommendations
 */
function generateExitRecommendations(redFlags, behaviorAnalysis, categories) {
  const recommendations = [];
  
  // Red flag based recommendations
  if (redFlags.length > 0) {
    recommendations.push(`Add filter: ${redFlags[0].recommendation}`);
    
    if (redFlags.length > 1) {
      recommendations.push(`Consider filter: ${redFlags[1].recommendation}`);
    }
  }
  
  // Behavior based recommendations
  if (behaviorAnalysis && behaviorAnalysis.winners.sampleSize > 5) {
    const winnerDays = behaviorAnalysis.winners.avgDaysAbove10MA;
    
    if (winnerDays >= 4) {
      recommendations.push(`Consider exit rule: if price closes below 10 MA in first 3 days, exit immediately`);
    }
    
    const winnerGain = behaviorAnalysis.winners.avgMaxGainFirst5Days;
    if (winnerGain > 5) {
      recommendations.push(`Winners show ${winnerGain}% gain quickly - if no gain by day 3, review position`);
    }
  }
  
  // Early stop recommendations
  const earlyStopPct = categories.EARLY_STOP.length / (categories.EARLY_STOP.length + categories.LATE_STOP.length + categories.SMALL_WIN.length + categories.GOOD_WIN.length + categories.BIG_WIN.length);
  if (earlyStopPct > 0.3) {
    recommendations.push(`${Math.round(earlyStopPct * 100)}% of trades stop out early - tighten mandatory filters (RS, slope, pattern confidence)`);
  }
  
  // Exit timing recommendations
  const totalWins = categories.SMALL_WIN.length + categories.GOOD_WIN.length + categories.BIG_WIN.length;
  const totalLosses = categories.EARLY_STOP.length + categories.LATE_STOP.length;
  
  if (totalWins > 0 && totalLosses > 0) {
    const avgWinPct = (categories.SMALL_WIN.reduce((s, t) => s + t.returnPct, 0) + 
                       categories.GOOD_WIN.reduce((s, t) => s + t.returnPct, 0) + 
                       categories.BIG_WIN.reduce((s, t) => s + t.returnPct, 0)) / totalWins;
    const avgLossPct = (categories.EARLY_STOP.reduce((s, t) => s + (t.returnPct || 0), 0) + 
                        categories.LATE_STOP.reduce((s, t) => s + (t.returnPct || 0), 0)) / totalLosses;
    const winLossRatio = Math.abs(avgWinPct / avgLossPct);
    
    if (winLossRatio < 2) {
      recommendations.push(`Win/loss ratio is ${winLossRatio.toFixed(1)}:1 - aim for 3:1+ by cutting losses faster or holding winners longer`);
    }
  }
  
  return recommendations;
}

// ============================================================================
// CASE STUDY: ANALYZE SPECIFIC FAILED TRADE
// ============================================================================

/**
 * Deep dive into why a specific trade failed
 * Use this to analyze the CMC trade or any other failed signal
 * 
 * @param {string} ticker - Ticker symbol
 * @param {string} entryDate - Entry date (YYYY-MM-DD)
 * @param {Object} options - { includeChart: boolean }
 * @returns {Object} Detailed failure analysis
 */
export async function analyzeCaseStudy(ticker, entryDate, options = {}) {
  console.log(`\n🔍 Case Study: ${ticker} entered ${entryDate}\n`);
  
  try {
    // Get historical bars
    const entry = new Date(entryDate);
    const from = new Date(entry);
    from.setDate(from.getDate() - 60); // 60 days before entry
    
    const to = new Date(entry);
    to.setDate(to.getDate() + 30); // 30 days after entry
    
    const bars = await getBars(ticker, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10));
    
    if (!bars || bars.length < 60) {
      return { error: 'Insufficient bar data', ticker, entryDate };
    }
    
    // Sort bars
    const sortedBars = [...bars].sort((a, b) => a.t - b.t);
    
    // Find entry bar
    const entryTs = entry.getTime();
    const entryIdx = sortedBars.findIndex(b => b.t >= entryTs);
    
    if (entryIdx === -1) {
      return { error: 'Entry date not found in bars', ticker, entryDate };
    }
    
    const entryBar = sortedBars[entryIdx];
    const entryPrice = entryBar.c;
    
    // Calculate MAs
    const closes = sortedBars.map(b => b.c);
    const ma10 = sma(closes, 10);
    const ma20 = sma(closes, 20);
    const ma50 = sma(closes, 50);
    
    // Analyze entry conditions
    const entryAnalysis = {
      price: entryPrice,
      ma10: ma10[entryIdx],
      ma20: ma20[entryIdx],
      ma50: ma50[entryIdx],
      distanceFrom10MA: ma10[entryIdx] ? ((entryPrice - ma10[entryIdx]) / ma10[entryIdx] * 100) : null,
      distanceFrom20MA: ma20[entryIdx] ? ((entryPrice - ma20[entryIdx]) / ma20[entryIdx] * 100) : null,
      volume: entryBar.v,
      avgVolume20: sortedBars.slice(Math.max(0, entryIdx - 20), entryIdx).reduce((s, b) => s + b.v, 0) / Math.min(20, entryIdx),
      volumeRatio: null
    };
    
    entryAnalysis.volumeRatio = entryAnalysis.avgVolume20 > 0 
      ? entryBar.v / entryAnalysis.avgVolume20 
      : null;
    
    // Calculate 10 MA slope at entry
    if (entryIdx >= 14) {
      const ma10_14dAgo = ma10[entryIdx - 14];
      const slope14d = ma10_14dAgo ? ((ma10[entryIdx] - ma10_14dAgo) / ma10_14dAgo * 100) : null;
      entryAnalysis.ma10Slope14d = slope14d;
    }
    
    // Analyze what happened after entry
    const postEntryDays = [];
    for (let i = 1; i <= Math.min(10, sortedBars.length - entryIdx - 1); i++) {
      const idx = entryIdx + i;
      const bar = sortedBars[idx];
      const returnPct = ((bar.c - entryPrice) / entryPrice * 100);
      const above10MA = ma10[idx] && bar.c > ma10[idx];
      const above20MA = ma20[idx] && bar.c > ma20[idx];
      
      postEntryDays.push({
        day: i,
        date: new Date(bar.t).toISOString().slice(0, 10),
        close: bar.c,
        returnPct: Math.round(returnPct * 100) / 100,
        above10MA,
        above20MA,
        volume: bar.v,
        volumeRatio: entryAnalysis.avgVolume20 > 0 ? bar.v / entryAnalysis.avgVolume20 : null
      });
    }
    
    // Find pullbacks before entry
    const pullbacks = findPullbacks(sortedBars.slice(0, entryIdx + 1), 80);
    
    // Determine failure reason
    const failureReasons = [];
    
    // Check if stopped out
    const stopped = postEntryDays.find(d => d.returnPct <= -4);
    if (stopped) {
      failureReasons.push(`Hit 4% stop loss on day ${stopped.day} (${stopped.date})`);
    }
    
    // Check if broke below 10 MA quickly
    const broke10MA = postEntryDays.findIndex(d => !d.above10MA);
    if (broke10MA !== -1 && broke10MA < 5) {
      failureReasons.push(`Broke below 10 MA on day ${broke10MA + 1} - failed to hold support`);
    }
    
    // Check slope
    if (entryAnalysis.ma10Slope14d != null && entryAnalysis.ma10Slope14d < 5) {
      failureReasons.push(`Weak 10 MA slope at entry: ${entryAnalysis.ma10Slope14d.toFixed(1)}% (want 5%+)`);
    }
    
    // Check entry timing
    if (entryAnalysis.distanceFrom10MA != null && Math.abs(entryAnalysis.distanceFrom10MA) > 2.5) {
      failureReasons.push(`Entry too far from 10 MA: ${entryAnalysis.distanceFrom10MA.toFixed(1)}% away (want <2%)`);
    }
    
    // Check volume confirmation
    if (entryAnalysis.volumeRatio != null && entryAnalysis.volumeRatio < 1.0) {
      failureReasons.push(`Low volume at entry: ${(entryAnalysis.volumeRatio * 100).toFixed(0)}% of 20-day avg`);
    }
    
    // Check if it rallied after stop
    const maxGainAfter = Math.max(...postEntryDays.map(d => d.returnPct));
    if (stopped && maxGainAfter > 5) {
      failureReasons.push(`⚠️ Stopped out but then rallied ${maxGainAfter.toFixed(1)}% - possible whipsaw`);
    }
    
    const analysis = {
      ticker,
      entryDate,
      entryAnalysis,
      pullbacksBefore: pullbacks.length,
      postEntryBehavior: postEntryDays,
      failureReasons,
      verdict: failureReasons.length === 0 ? 'Setup was valid, just bad luck' : 'Setup had warning signs',
      lessonLearned: generateLessonLearned(entryAnalysis, failureReasons, postEntryDays)
    };
    
    console.log(`\n📊 Entry Conditions:`);
    console.log(`   Price: $${entryPrice.toFixed(2)}`);
    console.log(`   10 MA: $${entryAnalysis.ma10?.toFixed(2)} (${entryAnalysis.distanceFrom10MA?.toFixed(1)}% away)`);
    console.log(`   10 MA Slope (14d): ${entryAnalysis.ma10Slope14d?.toFixed(1)}%`);
    console.log(`   Volume: ${(entryAnalysis.volumeRatio * 100)?.toFixed(0)}% of avg`);
    
    console.log(`\n❌ Failure Reasons:`);
    failureReasons.forEach((reason, i) => {
      console.log(`   ${i + 1}. ${reason}`);
    });
    
    console.log(`\n💡 Lesson Learned:`);
    console.log(`   ${analysis.lessonLearned}`);
    
    // Save case study
    ensureExitLearningDir();
    const filepath = path.join(EXIT_LEARNING_DIR, `case-study-${ticker}-${entryDate}.json`);
    fs.writeFileSync(filepath, JSON.stringify(analysis, null, 2), 'utf8');
    console.log(`\n📄 Case study saved: ${filepath}`);
    
    return analysis;
    
  } catch (e) {
    console.error(`Error analyzing ${ticker}:`, e.message);
    return { error: e.message, ticker, entryDate };
  }
}

/**
 * Generate lesson learned from case study
 */
function generateLessonLearned(entryAnalysis, failureReasons, postEntryDays) {
  if (failureReasons.length === 0) {
    return 'Setup met all criteria - this was simply adverse market conditions or bad luck. No filter would have prevented this.';
  }
  
  const lessons = [];
  
  // Slope issues
  if (failureReasons.some(r => r.includes('slope'))) {
    lessons.push('Require 10 MA slope ≥ 5% over 14 days - weak slopes lead to failed breakouts');
  }
  
  // MA distance issues
  if (failureReasons.some(r => r.includes('too far from'))) {
    lessons.push('Only take entries within 2% of 10 MA - extended entries are prone to immediate pullbacks');
  }
  
  // Volume issues
  if (failureReasons.some(r => r.includes('Low volume'))) {
    lessons.push('Require volume confirmation (>100% of 20-day avg) - low volume breakouts often fail');
  }
  
  // Quick failure
  if (failureReasons.some(r => r.includes('day 1') || r.includes('day 2'))) {
    lessons.push('If trade breaks below 10 MA in first 2 days, exit immediately - setup was flawed');
  }
  
  // Whipsaw
  if (failureReasons.some(r => r.includes('whipsaw'))) {
    lessons.push('Consider slightly wider stop (5-6%) if setup is otherwise perfect - avoid getting shaken out of valid setups');
  }
  
  return lessons.length > 0 ? lessons.join('. ') : 'Multiple warning signs present at entry.';
}

// ============================================================================
// EXPORT API
// ============================================================================

export default {
  runExitLearning,
  analyzeCaseStudy,
  loadExitLearningHistory,
  categorizeExits,
  analyzeMetricsByExitType,
  identifyRedFlags,
  analyzeConvictionAccuracy
};
