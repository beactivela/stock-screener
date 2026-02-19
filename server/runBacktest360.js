#!/usr/bin/env node
/**
 * 360-Day Adaptive Strategy Backtest Runner
 * 
 * Runs a comprehensive backtest of the Minervini VCP + CANSLIM + Momentum
 * strategy over the last 360 days with $100K starting capital.
 * 
 * Usage:
 *   node server/runBacktest360.js
 *   node server/runBacktest360.js --learn    # Also run learning loop
 *   node server/runBacktest360.js --top=100  # Test top 100 tickers only
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  runAdaptiveBacktest,
  analyzeAndLearn,
  applyLearning,
  saveLearning,
  loadLearnedParams,
  DEFAULT_PARAMS
} from './adaptiveStrategy.js';
import { loadTickers } from './db/tickers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  lookbackDays: 360,
  startingCapital: 100000,
  maxTickers: null, // null = all, or number for limit
  runLearning: false
};

// Parse command line arguments
for (const arg of process.argv.slice(2)) {
  if (arg === '--learn') {
    CONFIG.runLearning = true;
  } else if (arg.startsWith('--top=')) {
    CONFIG.maxTickers = parseInt(arg.split('=')[1], 10);
  } else if (arg.startsWith('--days=')) {
    CONFIG.lookbackDays = parseInt(arg.split('=')[1], 10);
  }
}

// ============================================================================
// LOAD TICKERS
// ============================================================================

async function loadTickersFromSource() {
  const tickers = await loadTickers();
  if (!tickers.length) {
    console.error('❌ No tickers in DB. Run populate-tickers.js first.');
    process.exit(1);
  }
  console.log(`📋 Loaded ${tickers.length} tickers from DB`);
  return tickers;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  ADAPTIVE MOMENTUM STRATEGY - 360 DAY BACKTEST');
  console.log('  Minervini VCP + CANSLIM + Momentum');
  console.log('═'.repeat(60) + '\n');
  
  // Load tickers
  let tickers = await loadTickersFromSource();
  
  // Limit if requested
  if (CONFIG.maxTickers) {
    tickers = tickers.slice(0, CONFIG.maxTickers);
    console.log(`📊 Limited to top ${CONFIG.maxTickers} tickers\n`);
  }
  
  // Load learned parameters (or defaults)
  const params = await loadLearnedParams();
  const isLearned = JSON.stringify(params) !== JSON.stringify(DEFAULT_PARAMS);
  
  if (isLearned) {
    console.log('🧠 Using previously learned parameters\n');
  } else {
    console.log('📐 Using default parameters\n');
  }
  
  // Run backtest
  const startTime = Date.now();
  
  const results = await runAdaptiveBacktest({
    tickers,
    lookbackDays: CONFIG.lookbackDays,
    startingCapital: CONFIG.startingCapital,
    params,
    verbose: true
  });
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`⏱️  Backtest completed in ${elapsed}s\n`);
  
  // Print detailed results
  printDetailedResults(results);
  
  // Run learning loop if requested
  if (CONFIG.runLearning && results.trades.length >= 30) {
    console.log('\n' + '─'.repeat(60));
    console.log('  🧠 RUNNING LEARNING LOOP');
    console.log('─'.repeat(60) + '\n');
    
    const learning = analyzeAndLearn(results.trades, params);
    
    console.log('Factor Analysis:');
    for (const [factor, data] of Object.entries(learning.factorAnalysis || {})) {
      console.log(`   ${factor}: ${data.count} trades, ${data.winRate}% win rate, ${data.avgReturn}% avg return`);
    }
    
    console.log('\nExit Reason Analysis:');
    for (const [reason, data] of Object.entries(learning.byExitReason || {})) {
      console.log(`   ${reason}: ${data.count} trades, ${data.winRate}% win rate, ${data.avgReturn}% avg return`);
    }
    
    if (learning.hasAdjustments) {
      console.log('\nSuggested Adjustments:');
      for (const adj of learning.adjustments) {
        console.log(`   ${adj.param}: ${adj.change > 0 ? '+' : ''}${adj.change}`);
        console.log(`      → ${adj.reason}`);
      }
      
      // Apply and save
      const newParams = applyLearning(params, learning);
      await saveLearning(newParams, results.summary);
      console.log('\n✅ Applied and saved parameter adjustments');
    } else {
      console.log(`\n⚠️ ${learning.reason || 'No adjustments needed'}`);
    }
  }
  
  // Save full results
  const resultsPath = path.join(DATA_DIR, 'adaptive-strategy', `backtest-360d-full.json`);
  fs.mkdirSync(path.dirname(resultsPath), { recursive: true });
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n📁 Full results saved to: ${resultsPath}\n`);
}

// ============================================================================
// DETAILED RESULTS PRINTING
// ============================================================================

function printDetailedResults(results) {
  const { summary, trades, equityCurve } = results;
  
  console.log('\n' + '─'.repeat(60));
  console.log('  DETAILED PERFORMANCE METRICS');
  console.log('─'.repeat(60) + '\n');
  
  // Performance table
  const metrics = [
    ['Starting Capital', `$${CONFIG.startingCapital.toLocaleString()}`],
    ['Ending Capital', `$${summary.endingCapital.toLocaleString()}`],
    ['Total Return', `${summary.totalReturnPct >= 0 ? '+' : ''}${summary.totalReturnPct}%`],
    ['', ''],
    ['Total Trades', summary.totalTrades],
    ['Winners', `${summary.winners} (${summary.winRate}%)`],
    ['Losers', summary.losers],
    ['', ''],
    ['Profit Factor', summary.profitFactor],
    ['Expectancy (R)', summary.expectancyR],
    ['Avg Hold Days', summary.avgHoldDays],
    ['', ''],
    ['Max Drawdown', `${summary.maxDrawdownPct}%`],
    ['Avg Win', `${summary.avgWinPct}%`],
    ['Avg Loss', `${summary.avgLossPct}%`],
    ['', ''],
    ['Gross Profit', `$${summary.grossProfit?.toLocaleString() || 0}`],
    ['Gross Loss', `$${summary.grossLoss?.toLocaleString() || 0}`],
  ];
  
  for (const [label, value] of metrics) {
    if (label === '') {
      console.log('');
    } else {
      console.log(`   ${label.padEnd(20)} ${value}`);
    }
  }
  
  // Top winning trades
  console.log('\n' + '─'.repeat(60));
  console.log('  TOP 10 WINNING TRADES');
  console.log('─'.repeat(60) + '\n');
  
  const topWinners = [...trades].sort((a, b) => b.returnPct - a.returnPct).slice(0, 10);
  console.log('   Ticker   Entry      Exit       Return   Days   MFE    Exit Reason');
  console.log('   ' + '─'.repeat(70));
  
  for (const t of topWinners) {
    console.log(
      `   ${t.ticker.padEnd(8)} ${t.entryDateStr}  ${t.exitDateStr}  ` +
      `${(t.returnPct >= 0 ? '+' : '') + t.returnPct.toFixed(1).padStart(6)}%  ` +
      `${String(t.daysHeld).padStart(4)}  ` +
      `${t.mfe.toFixed(1).padStart(5)}%  ` +
      `${t.exitReason}`
    );
  }
  
  // Worst trades
  console.log('\n' + '─'.repeat(60));
  console.log('  TOP 10 LOSING TRADES');
  console.log('─'.repeat(60) + '\n');
  
  const topLosers = [...trades].sort((a, b) => a.returnPct - b.returnPct).slice(0, 10);
  console.log('   Ticker   Entry      Exit       Return   Days   MAE    Exit Reason');
  console.log('   ' + '─'.repeat(70));
  
  for (const t of topLosers) {
    console.log(
      `   ${t.ticker.padEnd(8)} ${t.entryDateStr}  ${t.exitDateStr}  ` +
      `${(t.returnPct >= 0 ? '+' : '') + t.returnPct.toFixed(1).padStart(6)}%  ` +
      `${String(t.daysHeld).padStart(4)}  ` +
      `${t.mae.toFixed(1).padStart(5)}%  ` +
      `${t.exitReason}`
    );
  }
  
  // Monthly breakdown
  console.log('\n' + '─'.repeat(60));
  console.log('  MONTHLY BREAKDOWN');
  console.log('─'.repeat(60) + '\n');
  
  const byMonth = {};
  for (const t of trades) {
    const month = t.entryDateStr.slice(0, 7);
    if (!byMonth[month]) byMonth[month] = { trades: 0, wins: 0, pnl: 0, returns: [] };
    byMonth[month].trades++;
    if (t.outcome === 'WIN') byMonth[month].wins++;
    byMonth[month].pnl += t.pnl || 0;
    byMonth[month].returns.push(t.returnPct);
  }
  
  console.log('   Month     Trades   Win%    Avg Ret    P&L');
  console.log('   ' + '─'.repeat(50));
  
  for (const month of Object.keys(byMonth).sort()) {
    const m = byMonth[month];
    const winRate = Math.round(m.wins / m.trades * 100);
    const avgReturn = m.returns.reduce((a, b) => a + b, 0) / m.returns.length;
    console.log(
      `   ${month}    ${String(m.trades).padStart(4)}     ${String(winRate).padStart(3)}%    ` +
      `${(avgReturn >= 0 ? '+' : '') + avgReturn.toFixed(1).padStart(6)}%   ` +
      `$${m.pnl >= 0 ? '+' : ''}${Math.round(m.pnl).toLocaleString()}`
    );
  }
  
  // Exit reason breakdown
  console.log('\n' + '─'.repeat(60));
  console.log('  EXIT REASON BREAKDOWN');
  console.log('─'.repeat(60) + '\n');
  
  const byExit = {};
  for (const t of trades) {
    if (!byExit[t.exitReason]) byExit[t.exitReason] = { count: 0, wins: 0, returns: [] };
    byExit[t.exitReason].count++;
    if (t.outcome === 'WIN') byExit[t.exitReason].wins++;
    byExit[t.exitReason].returns.push(t.returnPct);
  }
  
  console.log('   Exit Reason      Count   Win%    Avg Return');
  console.log('   ' + '─'.repeat(50));
  
  for (const [reason, data] of Object.entries(byExit)) {
    const winRate = Math.round(data.wins / data.count * 100);
    const avgReturn = data.returns.reduce((a, b) => a + b, 0) / data.returns.length;
    console.log(
      `   ${reason.padEnd(16)} ${String(data.count).padStart(5)}   ${String(winRate).padStart(4)}%    ` +
      `${(avgReturn >= 0 ? '+' : '') + avgReturn.toFixed(1)}%`
    );
  }
  
  // Key insights
  console.log('\n' + '─'.repeat(60));
  console.log('  KEY INSIGHTS');
  console.log('─'.repeat(60) + '\n');
  
  // Win rate assessment
  if (summary.winRate >= 50) {
    console.log(`   ✅ Win Rate (${summary.winRate}%) is HEALTHY - above 50%`);
  } else if (summary.winRate >= 40) {
    console.log(`   ⚠️ Win Rate (${summary.winRate}%) is MODERATE - acceptable if R:R is good`);
  } else {
    console.log(`   ❌ Win Rate (${summary.winRate}%) is LOW - need better entry filters`);
  }
  
  // Profit factor assessment
  if (summary.profitFactor >= 2.0) {
    console.log(`   ✅ Profit Factor (${summary.profitFactor}) is EXCELLENT - very profitable`);
  } else if (summary.profitFactor >= 1.5) {
    console.log(`   ✅ Profit Factor (${summary.profitFactor}) is GOOD - solidly profitable`);
  } else if (summary.profitFactor >= 1.0) {
    console.log(`   ⚠️ Profit Factor (${summary.profitFactor}) is MARGINAL - barely profitable`);
  } else {
    console.log(`   ❌ Profit Factor (${summary.profitFactor}) is POOR - losing money`);
  }
  
  // Drawdown assessment
  if (summary.maxDrawdownPct <= 15) {
    console.log(`   ✅ Max Drawdown (${summary.maxDrawdownPct}%) is LOW - good risk management`);
  } else if (summary.maxDrawdownPct <= 25) {
    console.log(`   ⚠️ Max Drawdown (${summary.maxDrawdownPct}%) is MODERATE`);
  } else {
    console.log(`   ❌ Max Drawdown (${summary.maxDrawdownPct}%) is HIGH - risky`);
  }
  
  // Expectancy assessment
  if (summary.expectancyR >= 0.5) {
    console.log(`   ✅ Expectancy (${summary.expectancyR}R) is STRONG - expect good returns`);
  } else if (summary.expectancyR > 0) {
    console.log(`   ⚠️ Expectancy (${summary.expectancyR}R) is POSITIVE but could improve`);
  } else {
    console.log(`   ❌ Expectancy (${summary.expectancyR}R) is NEGATIVE - losing strategy`);
  }
  
  console.log('');
}

// Run
main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
