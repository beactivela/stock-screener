/**
 * Deepseek Learning Feedback Loop
 * Tracks trade outcomes and adjusts weights based on statistical performance
 * Optimizes for 3:1 risk-reward ratio and minimal drawdowns
 * 
 * Data Storage: JSON files in data/deepseek/
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEEPSEEK_DATA_DIR = path.join(__dirname, '..', '..', 'data', 'deepseek');

// Ensure data directory exists
function ensureDeepseekDataDir() {
  if (!fs.existsSync(DEEPSEEK_DATA_DIR)) {
    fs.mkdirSync(DEEPSEEK_DATA_DIR, { recursive: true });
  }
}

/**
 * Trade Record Structure
 */
class TradeRecord {
  constructor(ticker, entryData, signalData) {
    this.ticker = ticker;
    this.entryDate = new Date().toISOString().slice(0, 10);
    this.entryPrice = entryData.price;
    this.signalStrength = signalData.signalStrength;
    this.confidence = signalData.confidence;
    
    // Risk management
    this.stopLoss = signalData.stopLoss;
    this.target3R = signalData.target3R;
    this.initialRisk = entryData.price - signalData.stopLoss;
    this.initialRiskPercent = (this.initialRisk / entryData.price) * 100;
    
    // Component scores for weight adjustment
    this.componentScores = signalData.componentScores;
    
    // Outcome tracking (filled on exit)
    this.exitDate = null;
    this.exitPrice = null;
    this.exitReason = null;
    this.profitLoss = null;
    this.profitLossPercent = null;
    this.maxFavorableExcursion = null; // MFE - maximum profit reached
    this.maxAdverseExcursion = null;   // MAE - maximum loss reached
    this.peakDrawdown = null;          // Maximum drawdown from entry
    
    // Performance metrics
    this.rMultiple = null;             // Profit/Loss divided by initial risk
    this.winLoss = null;               // 'WIN', 'LOSS', 'BREAKEVEN'
    
    // Trade status
    this.status = 'OPEN';              // OPEN, CLOSED, CANCELLED
    this.lastUpdated = new Date().toISOString();
  }
}

/**
 * Load all trades from storage
 * @returns {Array} Array of trade records
 */
export function loadAllTrades() {
  ensureDeepseekDataDir();
  const tradesPath = path.join(DEEPSEEK_DATA_DIR, 'trades.json');
  
  if (!fs.existsSync(tradesPath)) {
    return [];
  }
  
  try {
    const data = JSON.parse(fs.readFileSync(tradesPath, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('Error loading trades:', error);
    return [];
  }
}

/**
 * Save trades to storage
 * @param {Array} trades - Array of trade records
 */
function saveAllTrades(trades) {
  ensureDeepseekDataDir();
  const tradesPath = path.join(DEEPSEEK_DATA_DIR, 'trades.json');
  fs.writeFileSync(tradesPath, JSON.stringify(trades, null, 2), 'utf8');
}

/**
 * Record a new trade entry
 * @param {string} ticker - Stock ticker
 * @param {Object} entryData - Entry data {price, date, etc.}
 * @param {Object} signalData - Signal data from deepseekEngine
 * @returns {string} Trade ID
 */
export function recordTradeEntry(ticker, entryData, signalData) {
  const trades = loadAllTrades();
  const trade = new TradeRecord(ticker, entryData, signalData);
  
  // Generate unique ID
  const tradeId = `${ticker}_${trade.entryDate.replace(/-/g, '')}_${Date.now()}`;
  trade.id = tradeId;
  
  trades.push(trade);
  saveAllTrades(trades);
  
  return tradeId;
}

/**
 * Update trade exit information
 * @param {string} tradeId - Trade ID
 * @param {Object} exitData - {price, date, reason, currentPriceHistory}
 */
export function recordTradeExit(tradeId, exitData) {
  const trades = loadAllTrades();
  const tradeIndex = trades.findIndex(t => t.id === tradeId);
  
  if (tradeIndex === -1) {
    console.error(`Trade ${tradeId} not found`);
    return false;
  }
  
  const trade = trades[tradeIndex];
  
  // Update exit data
  trade.exitDate = exitData.date || new Date().toISOString().slice(0, 10);
  trade.exitPrice = exitData.price;
  trade.exitReason = exitData.reason || 'MANUAL';
  trade.status = 'CLOSED';
  trade.lastUpdated = new Date().toISOString();
  
  // Calculate profit/loss
  trade.profitLoss = trade.exitPrice - trade.entryPrice;
  trade.profitLossPercent = (trade.profitLoss / trade.entryPrice) * 100;
  
  // Calculate R-multiple (profit/loss divided by initial risk)
  if (trade.initialRisk !== 0) {
    trade.rMultiple = trade.profitLoss / trade.initialRisk;
  }
  
  // Determine win/loss
  if (trade.profitLoss > 0) {
    trade.winLoss = 'WIN';
  } else if (trade.profitLoss < 0) {
    trade.winLoss = 'LOSS';
  } else {
    trade.winLoss = 'BREAKEVEN';
  }
  
  // Calculate MFE, MAE, and peak drawdown from price history
  if (exitData.priceHistory && exitData.priceHistory.length > 0) {
    calculateTradeExcursions(trade, exitData.priceHistory);
  }
  
  trades[tradeIndex] = trade;
  saveAllTrades(trades);
  
  // Trigger learning update after exit
  updateLearningWeights();
  
  return true;
}

/**
 * Calculate MFE, MAE, and peak drawdown from price history
 */
function calculateTradeExcursions(trade, priceHistory) {
  let maxPrice = trade.entryPrice;
  let minPrice = trade.entryPrice;
  let peakDrawdown = 0;
  
  // Ensure priceHistory is sorted by date (ascending)
  const sortedPrices = [...priceHistory].sort((a, b) => 
    new Date(a.date) - new Date(b.date)
  );
  
  for (const pricePoint of sortedPrices) {
    const price = pricePoint.price;
    
    // Update max and min prices
    if (price > maxPrice) maxPrice = price;
    if (price < minPrice) minPrice = price;
    
    // Calculate current drawdown from max
    const currentDrawdown = ((maxPrice - price) / maxPrice) * 100;
    if (currentDrawdown > peakDrawdown) {
      peakDrawdown = currentDrawdown;
    }
  }
  
  // Calculate MFE (maximum favorable excursion)
  trade.maxFavorableExcursion = ((maxPrice - trade.entryPrice) / trade.entryPrice) * 100;
  
  // Calculate MAE (maximum adverse excursion)
  trade.maxAdverseExcursion = ((minPrice - trade.entryPrice) / trade.entryPrice) * 100;
  
  // Peak drawdown
  trade.peakDrawdown = peakDrawdown;
}

/**
 * Update learning weights based on trade performance
 */
function updateLearningWeights() {
  const trades = loadAllTrades();
  const closedTrades = trades.filter(t => t.status === 'CLOSED');
  
  if (closedTrades.length < 10) {
    console.log(`Need at least 10 closed trades for weight adjustment. Current: ${closedTrades.length}`);
    return;
  }
  
  // Load current weights
  const weightsPath = path.join(DEEPSEEK_DATA_DIR, 'learningWeights.json');
  if (!fs.existsSync(weightsPath)) {
    console.error('Learning weights not found');
    return;
  }
  
  const currentWeights = JSON.parse(fs.readFileSync(weightsPath, 'utf8'));
  const newWeights = { ...currentWeights };
  
  // Analyze performance by component score ranges
  const performanceAnalysis = analyzeTradePerformance(closedTrades);
  
  // Adjust weights based on performance analysis
  for (const [component, analysis] of Object.entries(performanceAnalysis)) {
    if (!currentWeights[component]) continue;
    
    const currentWeight = currentWeights[component];
    let adjustment = 0;
    
    // Adjust based on win rate correlation
    if (analysis.winRate > 0.6) { // Strong positive correlation
      adjustment = 0.1; // Increase weight by 10%
    } else if (analysis.winRate < 0.4) { // Negative correlation
      adjustment = -0.1; // Decrease weight by 10%
    }
    
    // Adjust based on profit factor correlation
    if (analysis.profitFactor > 2.0) {
      adjustment += 0.05;
    } else if (analysis.profitFactor < 1.0) {
      adjustment -= 0.05;
    }
    
    // Adjust based on drawdown correlation (negative is good)
    if (analysis.avgDrawdown < 5) { // Low drawdowns with this factor
      adjustment += 0.05;
    } else if (analysis.avgDrawdown > 10) { // High drawdowns
      adjustment -= 0.05;
    }
    
    // Adjust based on R-multiple correlation
    if (analysis.avgRMultiple > 2.0) { // High positive R-multiples
      adjustment += 0.08;
    } else if (analysis.avgRMultiple < 0) { // Negative R-multiples
      adjustment -= 0.08;
    }
    
    // Apply adjustment with bounds
    const newWeight = currentWeight * (1 + adjustment);
    const minWeight = currentWeight * 0.5; // Don't reduce below 50%
    const maxWeight = currentWeight * 1.5; // Don't increase above 150%
    
    newWeights[component] = Math.max(minWeight, Math.min(maxWeight, newWeight));
  }
  
  // Normalize weights to maintain total relative proportions
  normalizeWeights(newWeights);
  
  // Save updated weights
  fs.writeFileSync(weightsPath, JSON.stringify(newWeights, null, 2), 'utf8');
  
  console.log('Learning weights updated based on', closedTrades.length, 'trades');
  logWeightChanges(currentWeights, newWeights);
}

/**
 * Analyze trade performance by component score ranges
 */
function analyzeTradePerformance(trades) {
  const analysis = {};
  
  // Define component thresholds for analysis
  const componentThresholds = {
    vcp: [20, 35, 45], // Low, Medium, High
    canslim: [10, 20, 30],
    industry: [5, 15, 25],
  };
  
  // Initialize analysis structure
  for (const component of Object.keys(componentThresholds)) {
    analysis[component] = {
      lowScoreTrades: [],
      mediumScoreTrades: [],
      highScoreTrades: [],
      winRate: 0,
      profitFactor: 0,
      avgRMultiple: 0,
      avgDrawdown: 0,
    };
  }
  
  // Categorize trades by component scores
  for (const trade of trades) {
    if (!trade.componentScores) continue;
    
    for (const [component, thresholds] of Object.entries(componentThresholds)) {
      const score = trade.componentScores[component]?.score || 0;
      const max = trade.componentScores[component]?.maxPossible || 1;
      const normalizedScore = (score / max) * 100;
      
      if (normalizedScore < thresholds[0]) {
        analysis[component].lowScoreTrades.push(trade);
      } else if (normalizedScore < thresholds[1]) {
        analysis[component].mediumScoreTrades.push(trade);
      } else {
        analysis[component].highScoreTrades.push(trade);
      }
    }
  }
  
  // Calculate performance metrics for each component
  for (const [component, compAnalysis] of Object.entries(analysis)) {
    const highScoreTrades = compAnalysis.highScoreTrades;
    
    if (highScoreTrades.length === 0) continue;
    
    // Calculate win rate
    const wins = highScoreTrades.filter(t => t.winLoss === 'WIN').length;
    compAnalysis.winRate = wins / highScoreTrades.length;
    
    // Calculate profit factor (total wins / total losses)
    const totalWins = highScoreTrades
      .filter(t => t.winLoss === 'WIN')
      .reduce((sum, t) => sum + Math.abs(t.profitLoss), 0);
    
    const totalLosses = highScoreTrades
      .filter(t => t.winLoss === 'LOSS')
      .reduce((sum, t) => sum + Math.abs(t.profitLoss), 0);
    
    compAnalysis.profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins;
    
    // Calculate average R-multiple
    const validRTrades = highScoreTrades.filter(t => t.rMultiple != null);
    if (validRTrades.length > 0) {
      compAnalysis.avgRMultiple = validRTrades.reduce((sum, t) => sum + t.rMultiple, 0) / validRTrades.length;
    }
    
    // Calculate average peak drawdown
    const validDrawdownTrades = highScoreTrades.filter(t => t.peakDrawdown != null);
    if (validDrawdownTrades.length > 0) {
      compAnalysis.avgDrawdown = validDrawdownTrades.reduce((sum, t) => sum + t.peakDrawdown, 0) / validDrawdownTrades.length;
    }
  }
  
  return analysis;
}

/**
 * Normalize weights to maintain relative proportions
 */
function normalizeWeights(weights) {
  const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);
  const normalizationFactor = 100 / totalWeight; // Normalize to sum ~100
  
  for (const key in weights) {
    weights[key] = Math.round(weights[key] * normalizationFactor * 10) / 10;
  }
}

/**
 * Log weight changes for transparency
 */
function logWeightChanges(oldWeights, newWeights) {
  const changes = [];
  
  for (const key in oldWeights) {
    if (newWeights[key] !== undefined) {
      const change = ((newWeights[key] - oldWeights[key]) / oldWeights[key] * 100).toFixed(1);
      if (Math.abs(change) > 1) {
        changes.push(`${key}: ${oldWeights[key].toFixed(1)} → ${newWeights[key].toFixed(1)} (${change}%)`);
      }
    }
  }
  
  if (changes.length > 0) {
    console.log('Significant weight changes:', changes);
  }
}

/**
 * Get performance statistics
 * @returns {Object} Performance metrics
 */
export function getPerformanceStats() {
  const trades = loadAllTrades();
  const closedTrades = trades.filter(t => t.status === 'CLOSED');
  
  if (closedTrades.length === 0) {
    return {
      totalTrades: 0,
      winRate: 0,
      profitFactor: 0,
      avgRMultiple: 0,
      totalProfitLoss: 0,
      bestTrade: null,
      worstTrade: null,
    };
  }
  
  // Calculate basic metrics
  const winTrades = closedTrades.filter(t => t.winLoss === 'WIN');
  const lossTrades = closedTrades.filter(t => t.winLoss === 'LOSS');
  
  const winRate = winTrades.length / closedTrades.length;
  
  const totalWins = winTrades.reduce((sum, t) => sum + (t.profitLoss || 0), 0);
  const totalLosses = lossTrades.reduce((sum, t) => sum + Math.abs(t.profitLoss || 0), 0);
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins;
  
  const totalProfitLoss = closedTrades.reduce((sum, t) => sum + (t.profitLoss || 0), 0);
  
  // Calculate average R-multiple
  const validRTrades = closedTrades.filter(t => t.rMultiple != null);
  const avgRMultiple = validRTrades.length > 0
    ? validRTrades.reduce((sum, t) => sum + t.rMultiple, 0) / validRTrades.length
    : 0;
  
  // Find best and worst trades
  const bestTrade = closedTrades.reduce((best, t) => 
    (t.profitLossPercent || 0) > (best?.profitLossPercent || 0) ? t : best, closedTrades[0]);
  
  const worstTrade = closedTrades.reduce((worst, t) => 
    (t.profitLossPercent || 0) < (worst?.profitLossPercent || 0) ? t : worst, closedTrades[0]);
  
  // Calculate Sharpe-like ratio (simplified)
  const returns = closedTrades.map(t => t.profitLossPercent || 0);
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const stdDev = Math.sqrt(
    returns.map(r => Math.pow(r - avgReturn, 2)).reduce((a, b) => a + b, 0) / returns.length
  );
  const sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;
  
  // Calculate 3:1 R:R achievement rate
  const achieved3R = closedTrades.filter(t => t.rMultiple != null && t.rMultiple >= 3).length;
  const threeToOneRate = closedTrades.length > 0 ? achieved3R / closedTrades.length : 0;
  
  return {
    totalTrades: closedTrades.length,
    winRate: Math.round(winRate * 1000) / 10,
    profitFactor: Math.round(profitFactor * 100) / 100,
    avgRMultiple: Math.round(avgRMultiple * 100) / 100,
    totalProfitLoss: Math.round(totalProfitLoss * 100) / 100,
    sharpeRatio: Math.round(sharpeRatio * 100) / 100,
    threeToOneRate: Math.round(threeToOneRate * 1000) / 10,
    bestTrade: bestTrade ? {
      ticker: bestTrade.ticker,
      profitPercent: Math.round(bestTrade.profitLossPercent * 100) / 100,
      rMultiple: Math.round(bestTrade.rMultiple * 100) / 100,
    } : null,
    worstTrade: worstTrade ? {
      ticker: worstTrade.ticker,
      profitPercent: Math.round(worstTrade.profitLossPercent * 100) / 100,
      rMultiple: Math.round(worstTrade.rMultiple * 100) / 100,
    } : null,
    openTrades: trades.filter(t => t.status === 'OPEN').length,
  };
}

/**
 * Get component effectiveness analysis
 * @returns {Object} Component performance analysis
 */
export function getComponentAnalysis() {
  const trades = loadAllTrades();
  const closedTrades = trades.filter(t => t.status === 'CLOSED');
  
  if (closedTrades.length < 5) {
    return { message: 'Need more closed trades for analysis' };
  }
  
  const analysis = analyzeTradePerformance(closedTrades);
  const simplified = {};
  
  for (const [component, compAnalysis] of Object.entries(analysis)) {
    simplified[component] = {
      effectiveness: compAnalysis.winRate > 0.6 ? 'HIGH' : 
                     compAnalysis.winRate > 0.5 ? 'MEDIUM' : 'LOW',
      winRate: Math.round(compAnalysis.winRate * 1000) / 10,
      profitFactor: Math.round(compAnalysis.profitFactor * 100) / 100,
      sampleSize: compAnalysis.highScoreTrades.length,
    };
  }
  
  return simplified;
}

/**
 * Simulate trade for backtesting
 * @param {Object} signalData - Signal data from engine
 * @param {Array} priceHistory - Future price history for simulation
 * @returns {Object} Simulated trade outcome
 */
export function simulateTrade(signalData, priceHistory) {
  const entryPrice = signalData.entryPrice;
  const stopLoss = signalData.stopLoss;
  const target3R = signalData.target3R;
  
  let exitPrice = null;
  let exitReason = 'TIMEOUT';
  let exitDay = null;
  
  // Simulate daily price movement
  for (let i = 0; i < Math.min(60, priceHistory.length); i++) { // Max 60 days
    const dayPrice = priceHistory[i].price;
    const dayDate = priceHistory[i].date;
    
    // Check stop loss
    if (dayPrice <= stopLoss) {
      exitPrice = stopLoss;
      exitReason = 'STOP_LOSS';
      exitDay = i + 1;
      break;
    }
    
    // Check profit target (3R)
    if (dayPrice >= target3R) {
      exitPrice = target3R;
      exitReason = 'PROFIT_TARGET';
      exitDay = i + 1;
      break;
    }
    
    // Check 10 MA trailing stop (simplified - would need actual MA calculation)
    if (i >= 10) {
      const recentPrices = priceHistory.slice(i - 9, i + 1).map(p => p.price);
      const ma10 = recentPrices.reduce((a, b) => a + b, 0) / 10;
      
      if (dayPrice < ma10 * 0.98) { // 2% below 10 MA
        exitPrice = dayPrice;
        exitReason = 'TRAILING_STOP';
        exitDay = i + 1;
        break;
      }
    }
  }
  
  // If no exit triggered, use final price
  if (!exitPrice && priceHistory.length > 0) {
    exitPrice = priceHistory[priceHistory.length - 1].price;
    exitReason = 'END_OF_PERIOD';
    exitDay = priceHistory.length;
  }
  
  return {
    exitPrice,
    exitReason,
    exitDay,
    profitLoss: exitPrice - entryPrice,
    profitLossPercent: ((exitPrice - entryPrice) / entryPrice) * 100,
  };
}

// Initialize on module load
ensureDeepseekDataDir();