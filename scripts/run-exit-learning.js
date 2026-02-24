#!/usr/bin/env node
/**
 * Run Exit Learning Analysis
 * 
 * Analyzes closed trades to learn what makes trades stop out vs succeed.
 * Generates a detailed report with red flags and recommendations.
 * 
 * Usage:
 *   npm run exit-learning              # Run basic analysis
 *   npm run exit-learning -- --full    # Include post-entry behavior analysis (slower)
 *   npm run exit-learning -- --case-study CMC 2026-02-17  # Analyze specific trade
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { runExitLearning, analyzeCaseStudy } from '../server/exitLearning.js';
import { runHistoricalExitLearning } from '../server/historicalExitAnalysis.js';

const args = process.argv.slice(2);

async function main() {
  // Check if running historical analysis mode
  if (args.includes('--historical') || args.includes('--history')) {
    console.log('\n📊 Running HISTORICAL Exit Learning');
    console.log('This analyzes past Opus signals by fetching Yahoo Finance data.\n');
    
    const maxIdx = args.indexOf('--max');
    const maxSignals = maxIdx !== -1 && args[maxIdx + 1] ? parseInt(args[maxIdx + 1]) : 50;
    
    const daysIdx = args.indexOf('--days');
    const daysToTrack = daysIdx !== -1 && args[daysIdx + 1] ? parseInt(args[daysIdx + 1]) : 30;
    
    const fromIdx = args.indexOf('--from');
    const fromDate = fromIdx !== -1 && args[fromIdx + 1] ? args[fromIdx + 1] : null;
    
    console.log(`Settings:`);
    console.log(`  Max signals: ${maxSignals}`);
    console.log(`  Days to track: ${daysToTrack}`);
    if (fromDate) console.log(`  From date: ${fromDate}`);
    console.log('');
    
    const analysis = await runHistoricalExitLearning({
      maxSignals,
      daysToTrack,
      fromDate,
      saveReport: true
    });
    
    if (analysis.error) {
      console.error(`\n❌ Error: ${analysis.error}`);
      console.error(`   ${analysis.message || ''}`);
      process.exit(1);
    }
    
    console.log('\n✅ Historical analysis complete! Check the detailed report above.\n');
    return;
  }
  
  // Check if running case study mode
  if (args.includes('--case-study')) {
    const caseStudyIdx = args.indexOf('--case-study');
    const ticker = args[caseStudyIdx + 1];
    const entryDate = args[caseStudyIdx + 2];
    
    if (!ticker || !entryDate) {
      console.error('\n❌ Usage: npm run exit-learning -- --case-study <TICKER> <DATE>');
      console.error('   Example: npm run exit-learning -- --case-study CMC 2026-02-17\n');
      process.exit(1);
    }
    
    console.log('\n🔍 Running Case Study Analysis...\n');
    const analysis = await analyzeCaseStudy(ticker, entryDate);
    
    if (analysis.error) {
      console.error(`\n❌ Error: ${analysis.error}\n`);
      process.exit(1);
    }
    
    console.log('\n✅ Case study complete! Check the detailed analysis above.\n');
    return;
  }
  
  // Regular exit learning analysis
  const includeBehaviorAnalysis = args.includes('--full');
  
  if (includeBehaviorAnalysis) {
    console.log('📊 Running FULL exit learning (includes post-entry behavior analysis)');
    console.log('⏱️  This will take a few minutes due to API calls...\n');
  } else {
    console.log('📊 Running BASIC exit learning from trade journal (fast)');
    console.log('💡 Tip: Run with --full for deeper analysis, or --historical to analyze past Opus signals\n');
  }
  
  try {
    const analysis = await runExitLearning({ includeBehaviorAnalysis });
    
    if (analysis.error) {
      console.error(`\n❌ ${analysis.error}`);
      console.error(`   ${analysis.message || ''}`);
      if (analysis.recommendation) {
        console.error(`\n💡 ${analysis.recommendation}`);
      }
      process.exit(1);
    }
    
    // Print summary table
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║            EXIT LEARNING SUMMARY                       ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');
    
    console.log(`Total Closed Trades: ${analysis.summary.totalTradesClosed}`);
    console.log(`Overall Win Rate: ${analysis.summary.overallWinRate}%`);
    console.log(`Early Stop Rate: ${analysis.summary.earlyStopRate}%`);
    console.log(`Avg Hold Time: ${analysis.summary.avgHoldTime} days`);
    
    // Print exit breakdown
    console.log('\n📊 Exit Breakdown:');
    console.log(`   Early Stops (<5d): ${analysis.categories.EARLY_STOP.length}`);
    console.log(`   Late Stops (5+d): ${analysis.categories.LATE_STOP.length}`);
    console.log(`   Small Wins (0-5%): ${analysis.categories.SMALL_WIN.length}`);
    console.log(`   Good Wins (5-15%): ${analysis.categories.GOOD_WIN.length}`);
    console.log(`   Big Wins (15%+): ${analysis.categories.BIG_WIN.length}`);
    
    // Print red flags
    if (analysis.redFlags && analysis.redFlags.length > 0) {
      console.log('\n🚩 Red Flags Identified:');
      analysis.redFlags.slice(0, 5).forEach((flag, i) => {
        console.log(`\n   ${i + 1}. ${flag.metric.toUpperCase()}`);
        console.log(`      Early Stop Avg: ${flag.earlyStopAvg}`);
        console.log(`      Good Win Avg: ${flag.goodWinAvg}`);
        console.log(`      Difference: ${flag.difference} (${flag.differencePct}% impact)`);
        console.log(`      ➜ ${flag.recommendation}`);
      });
    }
    
    // Print conviction analysis
    if (analysis.convictionAnalysis && Object.keys(analysis.convictionAnalysis).length > 0) {
      console.log('\n🎯 Conviction Analysis:');
      for (const [level, data] of Object.entries(analysis.convictionAnalysis).sort((a, b) => b[0] - a[0])) {
        console.log(`\n   Level ${level} (${data.count} trades)`);
        console.log(`      Win Rate: ${data.winRate}%`);
        console.log(`      Early Stop Rate: ${data.earlyStopRate}%`);
        console.log(`      Avg Return: ${data.avgReturn}%`);
        console.log(`      Avg Hold: ${data.avgHoldDays} days`);
      }
    }
    
    // Print behavior analysis if included
    if (analysis.behaviorAnalysis) {
      console.log('\n⏱️  Post-Entry Behavior (First 5 Days):');
      console.log('\n   WINNERS:');
      console.log(`      Days Above 10 MA: ${analysis.behaviorAnalysis.winners.avgDaysAbove10MA}`);
      console.log(`      Max Gain: ${analysis.behaviorAnalysis.winners.avgMaxGainFirst5Days}%`);
      console.log(`      Volatility: ${analysis.behaviorAnalysis.winners.avgVolatilityFirst5Days}%`);
      console.log(`      Sample Size: ${analysis.behaviorAnalysis.winners.sampleSize}`);
      
      console.log('\n   LOSERS:');
      console.log(`      Days Above 10 MA: ${analysis.behaviorAnalysis.losers.avgDaysAbove10MA}`);
      console.log(`      Max Gain: ${analysis.behaviorAnalysis.losers.avgMaxGainFirst5Days}%`);
      console.log(`      Volatility: ${analysis.behaviorAnalysis.losers.avgVolatilityFirst5Days}%`);
      console.log(`      Sample Size: ${analysis.behaviorAnalysis.losers.sampleSize}`);
    }
    
    // Print key learnings
    if (analysis.keyLearnings && analysis.keyLearnings.length > 0) {
      console.log('\n╔════════════════════════════════════════════════════════╗');
      console.log('║              KEY LEARNINGS                             ║');
      console.log('╚════════════════════════════════════════════════════════╝\n');
      
      analysis.keyLearnings.forEach((learning, i) => {
        console.log(`${i + 1}. ${learning}\n`);
      });
    }
    
    // Print recommendations
    if (analysis.recommendations && analysis.recommendations.length > 0) {
      console.log('\n╔════════════════════════════════════════════════════════╗');
      console.log('║            ACTIONABLE RECOMMENDATIONS                  ║');
      console.log('╚════════════════════════════════════════════════════════╝\n');
      
      analysis.recommendations.forEach((rec, i) => {
        console.log(`${i + 1}. ${rec}\n`);
      });
    }
    
    console.log('\n✅ Exit learning complete!');
    console.log('\n📄 Detailed report saved to: data/exit-learning/');
    console.log('\n💡 More options:');
    console.log('   Analyze specific trade:  npm run exit-learning -- --case-study <TICKER> <DATE>');
    console.log('   Analyze past signals:    npm run exit-learning -- --historical --max 50');
    console.log('   Get more history data:   npm run exit-learning -- --historical --max 100 --days 45\n');
    
  } catch (e) {
    console.error('\n❌ Error running exit learning:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
}

main();
