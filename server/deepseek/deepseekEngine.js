/**
 * Deepseek Buy Signal Engine
 * Enhanced Minervini VCP + CANSLIM with statistical feedback learning
 * Generates high-confidence buy signals with 3:1 risk-reward optimization
 * 
 * Key Features:
 * 1. Enhanced Minervini rules with statistical optimizations
 * 2. Dynamic weighting based on historical performance
 * 3. 3:1 risk-reward target optimization
 * 4. Trailing stop management (10 MA)
 * 5. Confidence scoring (0-100)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadCurrentRegime } from '../regimeHmm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEEPSEEK_DATA_DIR = path.join(__dirname, '..', '..', 'data', 'deepseek');

// Ensure data directory exists
function ensureDeepseekDataDir() {
  if (!fs.existsSync(DEEPSEEK_DATA_DIR)) {
    fs.mkdirSync(DEEPSEEK_DATA_DIR, { recursive: true });
  }
}

// Load learning weights
function loadLearningWeights() {
  const weightsPath = path.join(DEEPSEEK_DATA_DIR, 'learningWeights.json');
  
  if (!fs.existsSync(weightsPath)) {
    // Default weights based on Minervini principles + statistical optimization potential
    const defaultWeights = {
      // VCP Technical Factors (total weight: 45%)
      vcpContractions: 15,      // Progressive contractions weight
      volumeDryUp: 12,          // Volume drying up during pullbacks
      maSupport: 10,            // Support at 10/20/50 MA
      relativeStrength: 8,      // RS vs SPY (>80 ideal)
      
      // CANSLIM Fundamentals (total weight: 30%)
      earningsGrowth: 12,       // Quarterly EPS growth >25%
      annualEpsRoe: 10,         // Annual EPS >20% + ROE >15%
      institutionalQuality: 8,  // >70% institutional ownership
      
      // Industry & Market (total weight: 25%)
      industryRank: 10,         // Industry rank 1-20
      sectorRotation: 8,        // In favored sector
      marketRegime: 7,          // Bull market alignment
      
      // Statistical Enhancements (learned from feedback)
      optimalContractionDepth: 5,    // Best performing pullback depth
      volumeExpansionTiming: 5,      // Ideal up-day volume ratio
      rsiDivergence: 5,             // Hidden bullish divergence
      volatilityContraction: 5,      // ATR contraction pattern
    };
    
    saveLearningWeights(defaultWeights);
    return defaultWeights;
  }
  
  try {
    return JSON.parse(fs.readFileSync(weightsPath, 'utf8'));
  } catch (error) {
    console.error('Error loading learning weights:', error);
    return loadLearningWeights(); // Return default if error
  }
}

// Save learning weights
function saveLearningWeights(weights) {
  ensureDeepseekDataDir();
  const weightsPath = path.join(DEEPSEEK_DATA_DIR, 'learningWeights.json');
  fs.writeFileSync(weightsPath, JSON.stringify(weights, null, 2), 'utf8');
}

/**
 * Enhanced VCP Analysis with statistical optimizations
 * @param {Array} bars - Daily OHLCV bars
 * @param {Object} spyBars - SPY bars for RS calculation
 * @returns {Object} Enhanced VCP analysis
 */
function enhancedVCPAnalysis(bars, spyBars = []) {
  if (!bars || bars.length < 50) return null;
  
  const closes = bars.map(b => b.c);
  const volumes = bars.map(b => b.v || b.volume || 0);
  const highs = bars.map(b => b.h);
  const lows = bars.map(b => b.l);
  
  // Calculate moving averages
  function sma(data, period) {
    const result = [];
    for (let i = 0; i < data.length; i++) {
      if (i < period - 1) {
        result.push(null);
        continue;
      }
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += data[j];
      result.push(sum / period);
    }
    return result;
  }
  
  const sma10 = sma(closes, 10);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma150 = sma(closes, 150);
  const sma200 = sma(closes, 200);
  
  const lastClose = closes[closes.length - 1];
  const lastSma10 = sma10[sma10.length - 1];
  const lastSma20 = sma20[sma20.length - 1];
  const lastSma50 = sma50[sma50.length - 1];
  const lastSma150 = sma150[sma150.length - 1];
  const lastSma200 = sma200[sma200.length - 1];
  
  // Find pullbacks (Minervini VCP pattern)
  function findPullbacksEnhanced(bars) {
    const lookback = Math.min(120, bars.length);
    const recent = bars.slice(-lookback);
    const pullbacks = [];
    let i = 0;
    
    while (i < recent.length - 1) {
      // Find local high
      const highIdx = i;
      const highPrice = recent[highIdx].c;
      const prevPrice = recent[highIdx - 1]?.c;
      const nextPrice = recent[highIdx + 1]?.c;
      
      if (prevPrice != null && nextPrice != null && 
          highPrice >= prevPrice && highPrice >= nextPrice) {
        
        // Find subsequent low
        let lowIdx = highIdx + 1;
        let lowPrice = recent[lowIdx]?.l || recent[lowIdx]?.c;
        
        for (let j = highIdx + 1; j < recent.length; j++) {
          const currentLow = recent[j].l || recent[j].c;
          if (currentLow < lowPrice) {
            lowPrice = currentLow;
            lowIdx = j;
          }
          
          // End pullback when price rises significantly from low
          if (recent[j].c > lowPrice * 1.015) break;
        }
        
        // Calculate pullback characteristics
        const pullbackPercent = ((highPrice - lowPrice) / highPrice) * 100;
        
        // Calculate volume during pullback
        let volumeSum = 0;
        let volumeCount = 0;
        for (let k = highIdx; k <= lowIdx; k++) {
          const vol = recent[k]?.v || recent[k]?.volume || 0;
          if (vol > 0) {
            volumeSum += vol;
            volumeCount++;
          }
        }
        const avgVolume = volumeCount > 0 ? volumeSum / volumeCount : 0;
        
        // Calculate up-day volume after pullback (if available)
        let upDayVolume = null;
        if (lowIdx + 3 < recent.length) {
          const upDays = [];
          for (let k = lowIdx + 1; k <= lowIdx + 3; k++) {
            if (recent[k].c > recent[k - 1].c) {
              upDays.push(recent[k].v || recent[k].volume || 0);
            }
          }
          if (upDays.length > 0) {
            upDayVolume = upDays.reduce((a, b) => a + b, 0) / upDays.length;
          }
        }
        
        pullbacks.push({
          highIdx,
          lowIdx,
          highPrice,
          lowPrice,
          pullbackPercent,
          avgVolume,
          upDayVolume,
          depthRank: null // Will be calculated later
        });
        
        i = lowIdx + 1;
      } else {
        i++;
      }
    }
    
    return pullbacks;
  }
  
  const pullbacks = findPullbacksEnhanced(bars);
  
  // Calculate volume metrics
  const volumeSma20 = volumes.length >= 20 ? 
    volumes.slice(-20).reduce((a, b) => a + b, 0) / 20 : 0;
  
  // Calculate Relative Strength vs SPY
  let relativeStrength = 50; // Neutral default
  
  if (spyBars.length >= 20 && bars.length >= 20) {
    const stockReturns = (lastClose / closes[closes.length - 20] - 1) * 100;
    const spyReturns = (spyBars[spyBars.length - 1].c / spyBars[spyBars.length - 20].c - 1) * 100;
    relativeStrength = stockReturns - spyReturns + 100; // Scale to 0-200, 100 = neutral
  }
  
  // Calculate RSI (14-day)
  function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    
    let gains = 0;
    let losses = 0;
    
    for (let i = 1; i <= period; i++) {
      const change = prices[prices.length - i] - prices[prices.length - i - 1];
      if (change > 0) gains += change;
      else losses += Math.abs(change);
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }
  
  const rsi = calculateRSI(closes);
  
  // Calculate Average True Range (ATR) for volatility
  function calculateATR(bars, period = 14) {
    if (bars.length < period + 1) return 0;
    
    const trueRanges = [];
    for (let i = 1; i < bars.length; i++) {
      const high = bars[i].h;
      const low = bars[i].l;
      const prevClose = bars[i - 1].c;
      
      const tr1 = high - low;
      const tr2 = Math.abs(high - prevClose);
      const tr3 = Math.abs(low - prevClose);
      
      trueRanges.push(Math.max(tr1, tr2, tr3));
    }
    
    // Simple moving average of true ranges
    const atrValues = sma(trueRanges, period);
    return atrValues[atrValues.length - 1] || 0;
  }
  
  const atr = calculateATR(bars);
  const atrPercent = (atr / lastClose) * 100;
  
  // Check for RSI divergence (hidden bullish)
  function checkRSIDivergence(prices, rsiPeriod = 14) {
    if (prices.length < rsiPeriod * 3) return false;
    
    // Calculate RSI for last 30 periods
    const rsiValues = [];
    for (let i = prices.length - 30; i < prices.length; i++) {
      if (i >= rsiPeriod) {
        const slice = prices.slice(i - rsiPeriod, i);
        rsiValues.push(calculateRSI(slice, rsiPeriod));
      }
    }
    
    // Check for hidden bullish divergence (price makes higher low, RSI makes lower low)
    if (rsiValues.length >= 10) {
      const recentPrices = prices.slice(-10);
      const recentRSI = rsiValues.slice(-10);
      
      // Find last two lows in price
      const priceLow1 = Math.min(...recentPrices.slice(0, 5));
      const priceLow2 = Math.min(...recentPrices.slice(5));
      const rsiLow1 = Math.min(...recentRSI.slice(0, 5));
      const rsiLow2 = Math.min(...recentRSI.slice(5));
      
      // Hidden bullish divergence: price makes higher low, RSI makes lower low
      return priceLow2 > priceLow1 && rsiLow2 < rsiLow1 && rsiLow2 < 40;
    }
    
    return false;
  }
  
  const hasRSIDivergence = checkRSIDivergence(closes);
  
  return {
    // Price and MA data
    lastClose,
    sma10: lastSma10,
    sma20: lastSma20,
    sma50: lastSma50,
    sma150: lastSma150,
    sma200: lastSma200,
    
    // VCP Pattern data
    pullbacks,
    pullbackCount: pullbacks.length,
    recentPullback: pullbacks[pullbacks.length - 1],
    
    // Volume analysis
    volumeSma20,
    recentVolume: volumes[volumes.length - 1] || 0,
    volumeRatio: volumeSma20 > 0 ? (volumes[volumes.length - 1] || 0) / volumeSma20 : 1,
    
    // Technical indicators
    relativeStrength,
    rsi,
    atr,
    atrPercent,
    hasRSIDivergence,
    
    // Stage analysis
    isStage2: lastClose > lastSma150 && lastClose > lastSma200,
    aboveAllMAs: lastClose > lastSma10 && lastClose > lastSma20 && lastClose > lastSma50,
    
    // Support levels
    nearSma10: lastSma10 > 0 ? Math.abs(lastClose - lastSma10) / lastSma10 < 0.02 : false,
    nearSma20: lastSma20 > 0 ? Math.abs(lastClose - lastSma20) / lastSma20 < 0.02 : false,
    nearSma50: lastSma50 > 0 ? Math.abs(lastClose - lastSma50) / lastSma50 < 0.02 : false,
  };
}

/**
 * Enhanced CANSLIM Analysis
 * @param {Object} fundamentals - Company fundamentals
 * @returns {Object} Enhanced CANSLIM analysis
 */
function enhancedCANSLIMAnalysis(fundamentals) {
  if (!fundamentals) return null;
  
  const {
    qtrEarningsYoY = 0,
    annualEarningsGrowth = 0,
    roe = 0,
    operatingMargins = 0,
    pctHeldByInst = 0,
    industry = '',
    marketCap = 0,
  } = fundamentals;
  
  // Earnings growth analysis
  const earningsScore = (() => {
    let score = 0;
    if (qtrEarningsYoY > 50) score += 12;
    else if (qtrEarningsYoY > 30) score += 9;
    else if (qtrEarningsYoY > 25) score += 6;
    else if (qtrEarningsYoY > 15) score += 3;
    
    // Check for earnings acceleration (if we had sequential data)
    // For now, just use annual growth
    if (annualEarningsGrowth > 25 && roe > 17) score += 10;
    else if (annualEarningsGrowth > 20 || roe > 15) score += 7;
    else if (annualEarningsGrowth > 15 || roe > 12) score += 4;
    
    return score;
  })();
  
  // Institutional quality
  const institutionalScore = (() => {
    let score = 0;
    if (pctHeldByInst >= 70) score += 8;
    else if (pctHeldByInst >= 50) score += 5;
    else if (pctHeldByInst >= 30) score += 2;
    
    // Large cap tends to have more institutional ownership
    if (marketCap > 10000) score += 2; // $10B+ market cap
    
    return score;
  })();
  
  // Profitability
  const profitabilityScore = (() => {
    let score = 0;
    if (operatingMargins > 20) score += 7;
    else if (operatingMargins > 15) score += 5;
    else if (operatingMargins > 10) score += 3;
    else if (operatingMargins > 5) score += 1;
    
    if (roe > 20) score += 3;
    else if (roe > 15) score += 2;
    else if (roe > 10) score += 1;
    
    return score;
  })();
  
  return {
    earningsScore,
    institutionalScore,
    profitabilityScore,
    totalCANSLIMScore: earningsScore + institutionalScore + profitabilityScore,
    
    // Raw metrics for learning system
    qtrEarningsYoY,
    annualEarningsGrowth,
    roe,
    operatingMargins,
    pctHeldByInst,
    marketCap,
    industry,
  };
}

/**
 * Industry & Market Analysis
 * @param {Object} industryData - Industry performance data
 * @param {Object} marketData - Market regime data
 * @returns {Object} Industry and market analysis
 */
function industryMarketAnalysis(industryData, marketData = {}) {
  if (!industryData) return null;
  
  const {
    rank = 999,
    return1Y = 0,
    return6Mo = 0,
    return3Mo = 0,
    totalCount = 136,
  } = industryData;
  
  // Industry rank scoring
  const rankScore = (() => {
    if (rank <= 5) return 10;
    if (rank <= 10) return 8;
    if (rank <= 20) return 6;
    if (rank <= 40) return 4;
    if (rank <= 60) return 2;
    return 0;
  })();
  
  // Momentum scoring
  const momentumScore = (() => {
    let score = 0;
    if (return1Y > 20) score += 5;
    else if (return1Y > 10) score += 3;
    else if (return1Y > 0) score += 1;
    
    if (return6Mo > return1Y / 2) score += 3; // Acceleration
    if (return3Mo > return6Mo) score += 2; // Further acceleration
    
    return score;
  })();
  
  // Sector rotation (simplified - would need sector data)
  const sectorScore = marketData.isFavoredSector ? 7 : 0;
  
  return {
    rankScore,
    momentumScore,
    sectorScore,
    totalIndustryScore: rankScore + momentumScore + sectorScore,
    
    // Raw data
    industryRank: rank,
    industryReturn1Y: return1Y,
    industryReturn6Mo: return6Mo,
    industryReturn3Mo: return3Mo,
    industryPercentile: Math.round(((totalCount - rank) / totalCount) * 100),
  };
}

/**
 * Generate Deepseek Buy Signal
 * @param {Object} vcpAnalysis - Enhanced VCP analysis
 * @param {Object} canslimAnalysis - Enhanced CANSLIM analysis  
 * @param {Object} industryAnalysis - Industry/market analysis
 * @param {Object} weights - Learning weights
 * @returns {Object} Deepseek signal with confidence and R:R
 */
function generateDeepseekSignal(vcpAnalysis, canslimAnalysis, industryAnalysis, weights) {
  if (!vcpAnalysis) return null;
  
  // Calculate component scores with weights
  let totalScore = 0;
  let maxPossible = 0;
  const componentScores = {};
  
  // VCP Technical Score (45% weight)
  const vcpScore = calculateVCPTechnicalScore(vcpAnalysis, weights);
  totalScore += vcpScore.score * (weights.vcpContractions / 100);
  maxPossible += vcpScore.maxPossible * (weights.vcpContractions / 100);
  componentScores.vcp = vcpScore;
  
  // CANSLIM Score (30% weight)
  const canslimScore = canslimAnalysis ? canslimAnalysis.totalCANSLIMScore : 0;
  const canslimMax = 30; // Max CANSLIM score
  totalScore += canslimScore * (weights.earningsGrowth / 100);
  maxPossible += canslimMax * (weights.earningsGrowth / 100);
  componentScores.canslim = { score: canslimScore, maxPossible: canslimMax };
  
  // Industry Score (25% weight)
  const industryScore = industryAnalysis ? industryAnalysis.totalIndustryScore : 0;
  const industryMax = 25; // Max industry score
  totalScore += industryScore * (weights.industryRank / 100);
  maxPossible += industryMax * (weights.industryRank / 100);
  componentScores.industry = { score: industryScore, maxPossible: industryMax };
  
  // Calculate confidence (0-100)
  const confidence = maxPossible > 0 ? Math.min(100, Math.round((totalScore / maxPossible) * 100)) : 0;
  
  // Determine signal type
  let signal = 'HOLD';
  let signalStrength = 'NEUTRAL';
  
  if (confidence >= 80) {
    signal = 'BUY';
    signalStrength = 'STRONG';
  } else if (confidence >= 70) {
    signal = 'BUY';
    signalStrength = 'MODERATE';
  } else if (confidence >= 60) {
    signal = 'WATCH';
    signalStrength = 'WEAK';
  } else if (confidence < 50) {
    signal = 'AVOID';
    signalStrength = 'NEGATIVE';
  }
  
  // Calculate optimal risk-reward parameters
  const { stopLoss, target1R, target2R, target3R } = calculateRiskReward(vcpAnalysis);
  
  return {
    signal,
    signalStrength,
    confidence,
    componentScores,
    totalScore: Math.round(totalScore),
    maxPossible: Math.round(maxPossible),
    
    // Risk management
    stopLoss,
    target1R,
    target2R,
    target3R,
    riskRewardRatio: 3.0, // Target 3:1
    
    // Entry conditions
    entryPrice: vcpAnalysis.lastClose,
    entryTrigger: 'Breakout above recent high with volume > 150% avg',
    
    // Exit conditions
    exitCondition: 'Price crosses below 10 MA or target reached',
    trailingStop: '10 MA (move up as price rises)',
    
    // Metadata
    generatedAt: new Date().toISOString(),
    version: '1.0',
  };
}

/**
 * Calculate VCP Technical Score
 */
function calculateVCPTechnicalScore(vcpAnalysis, weights) {
  let score = 0;
  let maxPossible = 0;
  
  // Progressive contractions (0-15 points)
  if (vcpAnalysis.pullbackCount >= 3) {
    score += 10;
    
    // Check for progressive contraction
    const pullbacks = vcpAnalysis.pullbacks;
    let isProgressive = true;
    for (let i = 1; i < Math.min(3, pullbacks.length); i++) {
      if (pullbacks[i].pullbackPercent >= pullbacks[i - 1].pullbackPercent) {
        isProgressive = false;
        break;
      }
    }
    if (isProgressive) score += 5;
  } else if (vcpAnalysis.pullbackCount >= 2) {
    score += 6;
  } else if (vcpAnalysis.pullbackCount >= 1) {
    score += 3;
  }
  maxPossible += 15;
  
  // Volume dry-up (0-12 points)
  if (vcpAnalysis.recentPullback && vcpAnalysis.volumeSma20 > 0) {
    const volumeRatio = vcpAnalysis.recentPullback.avgVolume / vcpAnalysis.volumeSma20;
    
    if (volumeRatio < 0.7) score += 8;
    else if (volumeRatio < 0.9) score += 6;
    else if (volumeRatio < 1.0) score += 4;
    
    // Up-day volume expansion
    if (vcpAnalysis.recentPullback.upDayVolume && 
        vcpAnalysis.recentPullback.upDayVolume > vcpAnalysis.volumeSma20 * 1.2) {
      score += 4;
    }
  }
  maxPossible += 12;
  
  // MA Support (0-10 points)
  if (vcpAnalysis.nearSma50) score += 6;
  else if (vcpAnalysis.nearSma20) score += 4;
  else if (vcpAnalysis.nearSma10) score += 2;
  
  if (vcpAnalysis.aboveAllMAs) score += 4;
  maxPossible += 10;
  
  // Relative Strength (0-8 points)
  if (vcpAnalysis.relativeStrength > 110) score += 8;
  else if (vcpAnalysis.relativeStrength > 100) score += 6;
  else if (vcpAnalysis.relativeStrength > 90) score += 4;
  else if (vcpAnalysis.relativeStrength > 80) score += 2;
  maxPossible += 8;
  
  return { score, maxPossible };
}

/**
 * Calculate optimal risk-reward levels
 */
function calculateRiskReward(vcpAnalysis) {
  const entryPrice = vcpAnalysis.lastClose;
  const atr = vcpAnalysis.atr || 0;
  
  // Calculate stop loss (8% or below 10 MA, whichever is tighter)
  const stopLossPercent = 8; // Minervini-style max risk
  const stopLossByPercent = entryPrice * (1 - stopLossPercent / 100);
  
  // Alternative: below 10 MA
  const ma10Stop = vcpAnalysis.sma10 * 0.98; // 2% below 10 MA
  
  // Use the tighter stop
  const stopLoss = Math.max(stopLossByPercent, ma10Stop);
  
  // Calculate risk amount
  const riskAmount = entryPrice - stopLoss;
  
  // Calculate 3:1 reward targets
  const target1R = entryPrice + riskAmount; // 1:1
  const target2R = entryPrice + (riskAmount * 2); // 2:1
  const target3R = entryPrice + (riskAmount * 3); // 3:1 target
  
  return {
    stopLoss: Math.round(stopLoss * 100) / 100,
    target1R: Math.round(target1R * 100) / 100,
    target2R: Math.round(target2R * 100) / 100,
    target3R: Math.round(target3R * 100) / 100,
    riskPercent: ((riskAmount / entryPrice) * 100).toFixed(2),
    rewardPercent: ((riskAmount * 3 / entryPrice) * 100).toFixed(2),
  };
}

/**
 * Main Deepseek Engine Function
 * @param {Array} bars - Price bars
 * @param {Object} fundamentals - Company fundamentals
 * @param {Object} industryData - Industry data
 * @param {Object} marketData - Market regime data
 * @param {Array} spyBars - SPY bars for RS calculation
 * @returns {Object} Deepseek buy signal with all analysis
 */
export function generateDeepseekBuySignal(bars, fundamentals, industryData, marketData = {}, spyBars = []) {
  ensureDeepseekDataDir();
  
  // Load current learning weights
  const weights = loadLearningWeights();
  
  // Perform enhanced analysis
  const vcpAnalysis = enhancedVCPAnalysis(bars, spyBars);
  const canslimAnalysis = enhancedCANSLIMAnalysis(fundamentals);
  const industryAnalysis = industryMarketAnalysis(industryData, marketData);
  
  // Generate signal
  const signal = generateDeepseekSignal(vcpAnalysis, canslimAnalysis, industryAnalysis, weights);
  
  if (!signal) return null;
  
  // Prepare full analysis object
  const fullAnalysis = {
    signal,
    analysis: {
      vcp: vcpAnalysis,
      canslim: canslimAnalysis,
      industry: industryAnalysis,
    },
    weights,
    metadata: {
      barsCount: bars?.length || 0,
      analysisDate: new Date().toISOString().slice(0, 10),
      hasFundamentals: !!fundamentals,
      hasIndustryData: !!industryData,
    },
  };
  
  return fullAnalysis;
}

/**
 * Batch generate signals for multiple tickers
 * @param {Array} tickersData - Array of {ticker, bars, fundamentals, industryData}
 * @param {Array} spyBars - SPY bars for RS calculation
 * @returns {Object} Signals by ticker
 */
export function generateBatchSignals(tickersData, spyBars = []) {
  const signals = {};
  // HMM regime from SPY (data/regime/current_spy.json); bull => favored sector
  let marketData = {};
  try {
    const data = loadCurrentRegime();
    const regime = data.spy || data.qqq;
    if (regime) {
      marketData = {
        regime: regime.regime,
        regimeIndex: regime.regimeIndex,
        isFavoredSector: regime.regime === 'bull',
      };
    }
  } catch (_) {}
  for (const data of tickersData) {
    try {
      const signal = generateDeepseekBuySignal(
        data.bars,
        data.fundamentals,
        data.industryData,
        marketData,
        spyBars
      );
      
      if (signal) {
        signals[data.ticker] = signal;
      }
    } catch (error) {
      console.error(`Error generating signal for ${data.ticker}:`, error);
    }
  }
  
  return signals;
}

// Initialize on module load
ensureDeepseekDataDir();