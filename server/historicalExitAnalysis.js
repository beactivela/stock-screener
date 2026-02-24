/**
 * Historical Exit Analysis
 * 
 * Automatically fetches historical Opus signals and analyzes their outcomes.
 * Instead of waiting for manually logged trades, this proactively:
 * 1. Loads all past Opus buy signals
 * 2. Fetches historical price data from Yahoo Finance
 * 3. Simulates trades (entry at signal, exit at stop or 10 MA break)
 * 4. Categorizes outcomes (early stop, late stop, wins)
 * 5. Feeds results to exit learning for analysis
 * 
 * This provides immediate learning data without waiting for real trades.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getBars } from './yahoo.js';
import { getBars as getBarsFromCache } from './db/bars.js';
import { sma, nearMA } from './vcp.js';
import { checkExitSignal } from './opus45Signal.js';
import { loadOpus45Signals } from './db/opus45.js';
import { categorizeExits, analyzeMetricsByExitType, identifyRedFlags, analyzeConvictionAccuracy } from './exitLearning.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

/**
 * Simulate a trade from an Opus signal
 * Fetches price data and determines if it would have been a winner or loser
 * 
 * @param {Object} signal - Opus signal object
 * @param {Object} options - { daysToTrack: number }
 * @returns {Object|null} Trade simulation result
 */
async function simulateTradeFromSignal(signal, options = {}) {
  const daysToTrack = options.daysToTrack || 30;
  
  try {
    // Parse signal date - handle both timestamp and ISO string formats
    let signalDate;
    if (signal.entryDate) {
      // Check if it's a timestamp (number) or ISO string
      signalDate = typeof signal.entryDate === 'number' 
        ? new Date(signal.entryDate) 
        : new Date(signal.entryDate);
    } else if (signal.signalDate) {
      signalDate = typeof signal.signalDate === 'number'
        ? new Date(signal.signalDate)
        : new Date(signal.signalDate);
    } else if (signal.date) {
      signalDate = typeof signal.date === 'number'
        ? new Date(signal.date)
        : new Date(signal.date);
    } else {
      // Use current date as fallback
      signalDate = new Date();
    }
    
    // Validate date
    if (isNaN(signalDate.getTime())) {
      return { error: 'invalid_date', ticker: signal.ticker };
    }
    
    // Fetch bars from 30 days before to 40 days after signal
    const fromDate = new Date(signalDate);
    fromDate.setDate(fromDate.getDate() - 30);
    
    const toDate = new Date(signalDate);
    toDate.setDate(toDate.getDate() + daysToTrack + 10);
    
    const fromStr = fromDate.toISOString().slice(0, 10);
    const toStr = toDate.toISOString().slice(0, 10);
    
    // Try cache first, then fetch from Yahoo
    let bars = await getBarsFromCache(signal.ticker, fromStr, toStr, '1d');
    if (!bars || bars.length < 30) {
      console.log(`  Fetching ${signal.ticker}...`);
      bars = await getBars(signal.ticker, fromStr, toStr);
      
      if (!bars || bars.length < 30) {
        console.log(`    ⚠️ ${signal.ticker}: insufficient bars (got ${bars?.length || 0})`);
        return { error: 'insufficient_bars', ticker: signal.ticker, barsCount: bars?.length || 0 };
      }
      
      // Add delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 250));
    }
    
    // Sort bars by date
    const sortedBars = [...bars].sort((a, b) => a.t - b.t);
    
    // Find entry bar (on or after signal date)
    const signalTs = signalDate.getTime();
    const entryIdx = sortedBars.findIndex(b => b.t >= signalTs);
    
    if (entryIdx === -1 || entryIdx < 20) {
      return { error: 'entry_not_found', ticker: signal.ticker };
    }
    
    const entryBar = sortedBars[entryIdx];
    const entryPrice = entryBar.c;
    const entryDateStr = new Date(entryBar.t).toISOString().slice(0, 10);
    
    // Calculate MAs at entry
    const closes = sortedBars.slice(0, entryIdx + 1).map(b => b.c);
    const ma10 = sma(closes, 10);
    const ma20 = sma(closes, 20);
    const ma50 = sma(closes, 50);
    
    const ma10AtEntry = ma10[ma10.length - 1];
    const ma20AtEntry = ma20[ma20.length - 1];
    const ma50AtEntry = ma50[ma50.length - 1];
    
    // Track post-entry behavior
    const stopLossPrice = entryPrice * 0.96; // 4% stop
    let exitPrice = null;
    let exitDate = null;
    let exitType = null;
    let exitReason = null;
    let holdingDays = 0;
    let maxGain = 0;
    let daysAbove10MA = 0;
    
    const postEntryBars = sortedBars.slice(entryIdx + 1, entryIdx + 1 + daysToTrack);
    const postEntryCloses = sortedBars.slice(entryIdx, entryIdx + 1 + daysToTrack).map(b => b.c);
    const postEntryMA10 = sma(postEntryCloses, 10);
    
    for (let i = 0; i < postEntryBars.length; i++) {
      const bar = postEntryBars[i];
      const dayReturn = ((bar.c - entryPrice) / entryPrice) * 100;
      holdingDays++;
      
      // Track max gain
      if (dayReturn > maxGain) {
        maxGain = dayReturn;
      }
      
      // Check if above 10 MA
      const ma10Value = postEntryMA10[i + 1]; // +1 because we included entry in the array
      if (ma10Value && bar.c > ma10Value) {
        daysAbove10MA++;
      }
      
      // Check stop loss
      if (bar.c <= stopLossPrice) {
        exitPrice = stopLossPrice;
        exitDate = new Date(bar.t).toISOString().slice(0, 10);
        exitType = 'stop_loss';
        exitReason = `Hit 4% stop loss on day ${holdingDays}`;
        break;
      }
      
      // Check 10 MA break (only after day 2 to avoid noise)
      if (holdingDays > 2 && ma10Value && bar.c < ma10Value) {
        exitPrice = bar.c;
        exitDate = new Date(bar.t).toISOString().slice(0, 10);
        exitType = 'below_10ma';
        exitReason = `Closed below 10 MA on day ${holdingDays}`;
        break;
      }
    }
    
    // If no exit triggered, use last bar as exit
    if (!exitPrice && postEntryBars.length > 0) {
      const lastBar = postEntryBars[postEntryBars.length - 1];
      exitPrice = lastBar.c;
      exitDate = new Date(lastBar.t).toISOString().slice(0, 10);
      exitType = 'time_limit';
      exitReason = `Held for ${holdingDays} days (time limit)`;
    }
    
    if (!exitPrice) {
      return { error: 'no_exit_data', ticker: signal.ticker };
    }
    
    // Calculate return
    const returnPct = ((exitPrice - entryPrice) / entryPrice) * 100;
    
    // Determine status
    let status;
    if (returnPct <= 0) {
      status = holdingDays < 5 ? 'stopped' : 'closed';
    } else {
      status = 'closed';
    }
    
    // Create simulated trade object
    const trade = {
      id: `sim-${signal.ticker}-${entryDateStr}`,
      ticker: signal.ticker,
      companyName: signal.companyName || null,
      entryDate: entryDateStr,
      entryPrice: Math.round(entryPrice * 100) / 100,
      entryMetrics: {
        sma10: ma10AtEntry,
        sma20: ma20AtEntry,
        sma50: ma50AtEntry,
        contractions: signal.contractions || 0,
        volumeDryUp: signal.volumeDryUp || false,
        pattern: signal.pattern || 'VCP',
        patternConfidence: signal.patternConfidence || null,
        relativeStrength: signal.relativeStrength || null,
        industryRank: signal.industryRank || null,
        opus45Confidence: signal.opus45Confidence || null,
        opus45Grade: signal.opus45Grade || null,
        vcpScore: signal.score || null,
        enhancedScore: signal.enhancedScore || null,
        pctFromHigh: signal.pctFromHigh || null,
        pctAboveLow: signal.pctAboveLow || null
      },
      conviction: signal.opus45Confidence >= 90 ? 5 : signal.opus45Confidence >= 80 ? 4 : 3,
      exitDate,
      exitPrice: Math.round(exitPrice * 100) / 100,
      exitType,
      exitNotes: exitReason,
      status,
      returnPct: Math.round(returnPct * 10) / 10,
      holdingDays,
      stopLossPrice,
      maxGainFirst5Days: Math.round(Math.min(maxGain, 
        postEntryBars.slice(0, 5).reduce((max, bar) => {
          const gain = ((bar.c - entryPrice) / entryPrice) * 100;
          return Math.max(max, gain);
        }, 0)
      ) * 10) / 10,
      daysAbove10MAFirst5: Math.min(daysAbove10MA, 5),
      signalDate: signal.signalDate || signal.date,
      signalType: signal.signalType || 'OPUS45',
      simulated: true
    };
    
    return trade;
    
  } catch (e) {
    console.error(`Error simulating trade for ${signal.ticker}:`, e.message);
    return { error: e.message, ticker: signal.ticker };
  }
}

/**
 * Load historical Opus signals and simulate trades
 * 
 * @param {Object} options - { maxSignals: number, daysToTrack: number, fromDate: string }
 * @returns {Array} Array of simulated trades
 */
export async function loadAndSimulateHistoricalSignals(options = {}) {
  const maxSignals = options.maxSignals || 50;
  const daysToTrack = options.daysToTrack || 30;
  const fromDate = options.fromDate || null;
  
  console.log('\n📊 Loading historical Opus signals...');
  
  // Load signals from cache
  let signalsData = await loadOpus45Signals();
  
  // Fallback to file if Supabase fails
  if (!signalsData) {
    const signalsFile = path.join(DATA_DIR, 'opus45-signals.json');
    if (fs.existsSync(signalsFile)) {
      const raw = JSON.parse(fs.readFileSync(signalsFile, 'utf8'));
      signalsData = { signals: raw.signals || [] };
    }
  }
  
  if (!signalsData || !signalsData.signals || signalsData.signals.length === 0) {
    console.log('❌ No historical signals found');
    return [];
  }
  
  let signals = signalsData.signals;
  
  // Filter by date if specified
  if (fromDate) {
    const fromTs = new Date(fromDate).getTime();
    signals = signals.filter(s => {
      const signalDate = new Date(s.signalDate || s.date || s.computedAt);
      return signalDate.getTime() >= fromTs;
    });
  }
  
  // Sort by confidence (highest first) and take top N
  signals = signals
    .filter(s => s.signal === true || s.signalType) // Only actual signals
    .sort((a, b) => (b.opus45Confidence || 0) - (a.opus45Confidence || 0))
    .slice(0, maxSignals);
  
  console.log(`📈 Found ${signals.length} signals to analyze`);
  console.log('⏱️  Fetching historical data (this may take a few minutes)...\n');
  
  const simulatedTrades = [];
  const errors = [];
  
  for (let i = 0; i < signals.length; i++) {
    const signal = signals[i];
    
    if ((i + 1) % 10 === 0) {
      console.log(`  Progress: ${i + 1}/${signals.length}`);
    }
    
    const trade = await simulateTradeFromSignal(signal, { daysToTrack });
    
    if (trade.error) {
      errors.push({ ticker: signal.ticker, error: trade.error });
    } else {
      simulatedTrades.push(trade);
    }
  }
  
  console.log(`\n✅ Simulated ${simulatedTrades.length} trades`);
  if (errors.length > 0) {
    console.log(`⚠️  ${errors.length} signals skipped due to data issues`);
  }
  
  return simulatedTrades;
}

/**
 * Run complete historical exit learning analysis
 * Fetches historical signals, simulates trades, and analyzes outcomes
 * 
 * @param {Object} options - { maxSignals, daysToTrack, fromDate, saveReport }
 * @returns {Object} Complete analysis report
 */
export async function runHistoricalExitLearning(options = {}) {
  console.log('\n🧠 Running Historical Exit Learning...');
  console.log('This will fetch data from Yahoo Finance and may take several minutes.\n');
  
  const startTime = Date.now();
  
  // Load and simulate historical trades
  const simulatedTrades = await loadAndSimulateHistoricalSignals(options);
  
  if (simulatedTrades.length < 5) {
    return {
      error: 'INSUFFICIENT_DATA',
      message: `Only ${simulatedTrades.length} valid signals found. Need at least 5.`,
      simulatedTrades
    };
  }
  
  console.log('\n📊 Analyzing exit patterns...\n');
  
  // Categorize exits
  const categories = categorizeExits(simulatedTrades);
  
  console.log('📋 Exit Categories:');
  console.log(`   Early Stops (<5d): ${categories.EARLY_STOP.length}`);
  console.log(`   Late Stops (5+d): ${categories.LATE_STOP.length}`);
  console.log(`   Small Wins (0-5%): ${categories.SMALL_WIN.length}`);
  console.log(`   Good Wins (5-15%): ${categories.GOOD_WIN.length}`);
  console.log(`   Big Wins (15%+): ${categories.BIG_WIN.length}`);
  
  // Analyze metrics
  const metricAnalysis = analyzeMetricsByExitType(categories);
  
  // Identify red flags
  const redFlags = identifyRedFlags(metricAnalysis);
  console.log(`\n🚩 Red Flags Identified: ${redFlags.length}`);
  
  // Conviction analysis
  const convictionAnalysis = analyzeConvictionAccuracy(simulatedTrades);
  
  // Calculate overall stats
  const totalTrades = simulatedTrades.length;
  const winners = simulatedTrades.filter(t => t.returnPct > 0);
  const losers = simulatedTrades.filter(t => t.returnPct <= 0);
  const earlyStops = simulatedTrades.filter(t => t.returnPct <= 0 && t.holdingDays < 5);
  
  const overallWinRate = Math.round((winners.length / totalTrades) * 100);
  const avgReturn = Math.round(simulatedTrades.reduce((s, t) => s + t.returnPct, 0) / totalTrades * 10) / 10;
  const avgWin = winners.length > 0 ? Math.round(winners.reduce((s, t) => s + t.returnPct, 0) / winners.length * 10) / 10 : 0;
  const avgLoss = losers.length > 0 ? Math.round(losers.reduce((s, t) => s + t.returnPct, 0) / losers.length * 10) / 10 : 0;
  const earlyStopRate = Math.round((earlyStops.length / totalTrades) * 100);
  const avgHoldDays = Math.round(simulatedTrades.reduce((s, t) => s + t.holdingDays, 0) / totalTrades * 10) / 10;
  
  // Generate key learnings
  const keyLearnings = generateHistoricalLearnings(categories, redFlags, overallWinRate, earlyStopRate);
  
  // Generate recommendations
  const recommendations = generateHistoricalRecommendations(redFlags, categories, overallWinRate);
  
  const elapsedTime = Math.round((Date.now() - startTime) / 1000);
  
  const analysis = {
    analysisType: 'HISTORICAL',
    analysisDate: new Date().toISOString(),
    elapsedSeconds: elapsedTime,
    summary: {
      totalSignalsAnalyzed: totalTrades,
      overallWinRate,
      earlyStopRate,
      avgReturn,
      avgWin,
      avgLoss,
      avgHoldDays,
      winners: winners.length,
      losers: losers.length
    },
    categories,
    metricAnalysis,
    redFlags,
    convictionAnalysis,
    keyLearnings,
    recommendations,
    simulatedTrades: options.includeTradeDetails ? simulatedTrades : simulatedTrades.slice(0, 10) // Sample only
  };
  
  // Save report
  if (options.saveReport !== false) {
    const reportDir = path.join(DATA_DIR, 'exit-learning');
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().slice(0, 10);
    const reportFile = path.join(reportDir, `historical-analysis-${timestamp}.json`);
    fs.writeFileSync(reportFile, JSON.stringify(analysis, null, 2), 'utf8');
    console.log(`\n📄 Report saved: ${reportFile}`);
  }
  
  console.log(`\n✅ Historical exit learning complete! (${elapsedTime}s)`);
  
  return analysis;
}

/**
 * Generate key learnings from historical analysis
 */
function generateHistoricalLearnings(categories, redFlags, overallWinRate, earlyStopRate) {
  const learnings = [];
  
  // Win rate analysis
  if (overallWinRate < 50) {
    learnings.push(`⚠️ Overall win rate is ${overallWinRate}% - below breakeven. Current filters need tightening.`);
  } else if (overallWinRate >= 65) {
    learnings.push(`✅ Strong win rate of ${overallWinRate}% - current filters are working well.`);
  } else {
    learnings.push(`Overall win rate is ${overallWinRate}% - room for improvement with filter optimization.`);
  }
  
  // Early stop analysis
  if (earlyStopRate > 30) {
    learnings.push(`🚨 High early stop rate (${earlyStopRate}%) - many trades fail within 5 days. Entry filters need tightening.`);
  } else if (earlyStopRate < 15) {
    learnings.push(`✅ Low early stop rate (${earlyStopRate}%) - entry quality is good.`);
  }
  
  // Red flag analysis
  if (redFlags.length > 0) {
    const topFlag = redFlags[0];
    learnings.push(`Top predictor of failure: ${topFlag.metric} (${topFlag.differencePct}% impact). ${topFlag.recommendation}`);
    
    if (redFlags.length >= 3) {
      learnings.push(`Multiple red flags identified - ${redFlags.length} metrics show significant differences between winners and losers.`);
    }
  }
  
  // Big winners analysis
  const bigWins = categories.BIG_WIN.length;
  const totalWins = categories.SMALL_WIN.length + categories.GOOD_WIN.length + categories.BIG_WIN.length;
  if (bigWins > 0 && totalWins > 0) {
    const bigWinRate = Math.round((bigWins / totalWins) * 100);
    if (bigWinRate > 25) {
      learnings.push(`🏆 ${bigWinRate}% of winners are big wins (15%+) - strategy favors home runs.`);
    }
  }
  
  return learnings;
}

/**
 * Generate recommendations from historical analysis
 */
function generateHistoricalRecommendations(redFlags, categories, overallWinRate) {
  const recommendations = [];
  
  // Red flag based filters
  if (redFlags.length > 0) {
    recommendations.push(`🎯 PRIORITY: ${redFlags[0].recommendation}`);
    
    if (redFlags.length > 1) {
      recommendations.push(`SECONDARY: ${redFlags[1].recommendation}`);
    }
  }
  
  // Early stop recommendations
  const earlyStops = categories.EARLY_STOP.length;
  const totalTrades = earlyStops + categories.LATE_STOP.length + categories.SMALL_WIN.length + categories.GOOD_WIN.length + categories.BIG_WIN.length;
  const earlyStopRate = (earlyStops / totalTrades) * 100;
  
  if (earlyStopRate > 30) {
    recommendations.push(`Reduce early stops: Current rate is ${Math.round(earlyStopRate)}%. Tighten mandatory filters (RS, slope, volume).`);
  }
  
  // Win rate optimization
  if (overallWinRate < 55) {
    recommendations.push('Win rate below 55% - consider raising Opus confidence threshold from 70 to 80 for stronger signals only.');
  }
  
  // Sample size
  if (totalTrades < 30) {
    recommendations.push(`Analyze more signals: Current sample is ${totalTrades} trades. Run with --max 100 for more reliable patterns.`);
  }
  
  return recommendations;
}

export default {
  simulateTradeFromSignal,
  loadAndSimulateHistoricalSignals,
  runHistoricalExitLearning
};
