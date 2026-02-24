/**
 * Trade Journal Management
 * 
 * File-based storage for trade entries with:
 * - CRUD operations
 * - Auto-exit detection (checks if stop-loss or 10 MA exit triggered)
 * - Statistics calculation for learning feedback
 * 
 * Trades are stored in data/trades.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { checkExitSignal, DEFAULT_WEIGHTS } from './opus45Signal.js';
import { getBars } from './yahoo.js';
import { getSupabase, isSupabaseConfigured } from './supabase.js';
import { getBars as getBarsFromCache } from './db/bars.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const TRADES_FILE = path.join(DATA_DIR, 'trades.json');
const BARS_CACHE_DIR = path.join(DATA_DIR, 'bars');

// Ensure data directory exists
function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Initialize empty trades file with default structure
 */
function initTradesFile() {
  return {
    version: 1,
    trades: [],
    lastUpdated: new Date().toISOString(),
    stats: {
      totalTrades: 0,
      openTrades: 0,
      closedTrades: 0,
      winRate: null,
      avgReturn: null,
      avgWin: null,
      avgLoss: null,
      bestTrade: null,
      worstTrade: null,
      byConviction: {},
      byPattern: {},
      byExitType: {}
    }
  };
}

/**
 * Load trades from DB or file
 * @returns {Promise<Object>} Trades file content
 */
export async function loadTrades() {
  if (!isSupabaseConfigured()) throw new Error('Supabase required. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.');
  const supabase = getSupabase();
  const { data: rows, error } = await supabase.from('trades').select('*').order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  const trades = (rows || []).map((r) => ({
      id: r.id,
      ticker: r.ticker,
      companyName: r.company_name,
      entryDate: r.entry_date,
      entryPrice: r.entry_price,
      entryMetrics: r.entry_metrics,
      conviction: r.conviction,
      notes: r.notes,
      exitDate: r.exit_date,
      exitPrice: r.exit_price,
      exitType: r.exit_type,
      exitNotes: r.exit_notes,
      status: r.status,
      returnPct: r.return_pct,
      holdingDays: r.holding_days,
      stopLossPrice: r.stop_loss_price,
      targetPrice: r.target_price,
      lastCheckedDate: r.last_checked_date,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  const { data: statsRow } = await supabase.from('trade_stats').select('*').order('last_updated', { ascending: false }).limit(1).single();
  const stats = statsRow?.stats_json || recalcStatsFromTrades(trades);
  return { version: 1, trades, lastUpdated: new Date().toISOString(), stats };
}

function recalcStatsFromTrades(trades) {
  const closed = trades.filter((t) => t.status !== 'open');
  const winners = closed.filter((t) => t.returnPct != null && t.returnPct > 0);
  const losers = closed.filter((t) => t.returnPct != null && t.returnPct <= 0);
  return {
    totalTrades: trades.length,
    openTrades: trades.filter((t) => t.status === 'open').length,
    closedTrades: closed.length,
    winRate: closed.length > 0 ? Math.round((winners.length / closed.length) * 1000) / 10 : null,
    avgReturn: closed.length > 0 ? closed.reduce((s, t) => s + (t.returnPct || 0), 0) / closed.length : null,
    avgWin: winners.length > 0 ? winners.reduce((s, t) => s + (t.returnPct || 0), 0) / winners.length : null,
    avgLoss: losers.length > 0 ? losers.reduce((s, t) => s + (t.returnPct || 0), 0) / losers.length : null,
    bestTrade: winners.length ? winners.reduce((a, b) => ((a.returnPct || 0) > (b.returnPct || 0) ? a : b)) : null,
    worstTrade: losers.length ? losers.reduce((a, b) => ((a.returnPct || 0) < (b.returnPct || 0) ? a : b)) : null,
    byConviction: {},
    byPattern: {},
    byExitType: {},
  };
}

/**
 * Save trades to DB or file
 * @param {Object} data - Trades file content
 */
export async function saveTrades(data) {
  data.lastUpdated = new Date().toISOString();
  if (!isSupabaseConfigured()) throw new Error('Supabase required. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.');
  const supabase = getSupabase();
  const rows = (data.trades || []).map((t) => ({
      id: t.id,
      ticker: t.ticker,
      company_name: t.companyName ?? null,
      entry_date: t.entryDate ?? null,
      entry_price: t.entryPrice,
      entry_metrics: t.entryMetrics ?? null,
      conviction: t.conviction ?? null,
      notes: t.notes ?? null,
      exit_date: t.exitDate ?? null,
      exit_price: t.exitPrice ?? null,
      exit_type: t.exitType ?? null,
      exit_notes: t.exitNotes ?? null,
      status: t.status ?? 'open',
      return_pct: t.returnPct ?? null,
      holding_days: t.holdingDays ?? null,
      stop_loss_price: t.stopLossPrice ?? null,
      target_price: t.targetPrice ?? null,
      last_checked_date: t.lastCheckedDate ?? null,
      created_at: t.createdAt ?? null,
      updated_at: t.updatedAt ?? new Date().toISOString(),
  }));
  if (rows.length > 0) {
    const { error } = await supabase.from('trades').upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(error.message);
  }
  const stats = data.stats || recalcStatsFromTrades(data.trades || []);
  await supabase.from('trade_stats').insert({
    total_trades: stats.totalTrades ?? 0,
    open_trades: stats.openTrades ?? 0,
    closed_trades: stats.closedTrades ?? 0,
    win_rate: stats.winRate ?? null,
    avg_return: stats.avgReturn ?? null,
    avg_win: stats.avgWin ?? null,
    avg_loss: stats.avgLoss ?? null,
    stats_json: stats,
    last_updated: data.lastUpdated,
  });
}

/**
 * Get all trades
 * @returns {Promise<Array>} Array of trades
 */
export async function getAllTrades() {
  const data = await loadTrades();
  return data.trades;
}

/**
 * Get trades by status
 * @param {string} status - 'open', 'closed', or 'stopped'
 * @returns {Promise<Array>} Filtered trades
 */
export async function getTradesByStatus(status) {
  const trades = await getAllTrades();
  return trades.filter(t => t.status === status);
}

/**
 * Get a single trade by ID
 * @param {string} id - Trade ID
 * @returns {Promise<Object|null>} Trade or null
 */
export async function getTradeById(id) {
  const trades = await getAllTrades();
  return trades.find(t => t.id === id) || null;
}

/**
 * Create a new trade
 * 
 * LEARNING SYSTEM INTEGRATION:
 * When a trade is created, we capture a full context snapshot
 * at entry for later analysis. This includes all MAs, VCP data,
 * market condition, etc. See server/learning/tradeContext.js.
 * 
 * @param {Object} tradeData - Trade entry form data
 * @param {Object} entryMetrics - Technical indicators at entry
 * @param {Object} learningContext - Additional context for learning (optional)
 * @returns {Promise<Object>} Created trade
 */
export async function createTrade(tradeData, entryMetrics, learningContext = {}) {
  const data = await loadTrades();
  
  const trade = {
    // Generate unique ID
    id: uuidv4(),
    
    // Basic trade info
    ticker: tradeData.ticker.toUpperCase(),
    companyName: tradeData.companyName || null,
    
    // Entry details
    entryDate: tradeData.entryDate || new Date().toISOString().slice(0, 10),
    entryPrice: Number(tradeData.entryPrice),
    entryMetrics: entryMetrics || {},
    conviction: Number(tradeData.conviction) || 3,
    notes: tradeData.notes || null,
    
    // Exit details (null until closed)
    exitDate: null,
    exitPrice: null,
    exitType: null,
    exitNotes: null,
    
    // Status
    status: 'open',
    returnPct: null,
    holdingDays: null,
    
    // Auto-exit tracking
    // Stop loss = 4% below entry
    stopLossPrice: Math.round(tradeData.entryPrice * 0.96 * 100) / 100,
    // Target = 52w high if available, else 15% above entry
    targetPrice: entryMetrics?.high52w || Math.round(tradeData.entryPrice * 1.15 * 100) / 100,
    lastCheckedDate: null,
    
    // Metadata
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  data.trades.push(trade);
  recalculateStats(data);
  await saveTrades(data);
  
  console.log(`📝 Trade created: ${trade.ticker} @ $${trade.entryPrice}`);
  
  // LEARNING: Capture full context snapshot at entry
  // This enables post-mortem analysis of losing trades
  try {
    const { createTradeContextSnapshot } = await import('./learning/tradeContext.js');
    await createTradeContextSnapshot({
      tradeId: trade.id,
      ticker: trade.ticker,
      entryPrice: trade.entryPrice,
      entryDate: trade.entryDate,
      bars: learningContext.bars || null,
      vcpResult: learningContext.vcpResult || entryMetrics,
      opus45Signal: learningContext.opus45Signal || null,
      fundamentals: learningContext.fundamentals || null,
      industryData: learningContext.industryData || null,
      entryReason: trade.notes,
      conviction: trade.conviction
    });
    console.log(`📸 Context snapshot captured for ${trade.ticker}`);
  } catch (e) {
    console.warn(`Could not capture context snapshot: ${e.message}`);
  }
  
  return trade;
}

/**
 * Update an existing trade
 * 
 * LEARNING SYSTEM INTEGRATION:
 * When a trade is closed with a loss, we trigger the loss analyzer
 * to classify the failure and update learning data.
 * 
 * @param {string} id - Trade ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object|null>} Updated trade or null
 */
export async function updateTrade(id, updates) {
  const data = await loadTrades();
  const idx = data.trades.findIndex(t => t.id === id);
  
  if (idx === -1) return null;
  
  // Check if this is transitioning from open to closed
  const wasOpen = data.trades[idx].status === 'open';
  
  // Apply updates
  const trade = data.trades[idx];
  Object.assign(trade, updates, { updatedAt: new Date().toISOString() });
  
  // Recalculate computed fields if trade is closed
  if (trade.exitPrice && trade.exitDate) {
    trade.returnPct = Math.round(((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 1000) / 10;
    trade.holdingDays = Math.ceil(
      (new Date(trade.exitDate).getTime() - new Date(trade.entryDate).getTime()) / (1000 * 60 * 60 * 24)
    );
    
    // Set status based on return
    if (trade.exitType === 'stop_loss') {
      trade.status = 'stopped';
    } else {
      trade.status = 'closed';
    }
  }
  
  data.trades[idx] = trade;
  recalculateStats(data);
  await saveTrades(data);
  
  console.log(`📝 Trade updated: ${trade.ticker}`);
  
  // LEARNING: If trade just closed with a loss, trigger analysis
  const justClosed = wasOpen && trade.status !== 'open';
  const isLoss = trade.returnPct != null && trade.returnPct < 0;
  
  if (justClosed && isLoss) {
    try {
      const { onTradeClosed } = await import('./learning/index.js');
      const analysis = await onTradeClosed(trade);
      console.log(`📊 Loss analyzed: ${trade.ticker} -> ${analysis.classification || 'PENDING'}`);
    } catch (e) {
      console.warn(`Could not analyze loss: ${e.message}`);
    }
  }
  
  return trade;
}

/**
 * Close a trade (manual exit)
 * @param {string} id - Trade ID
 * @param {number} exitPrice - Exit price
 * @param {string} exitDate - Exit date (ISO string)
 * @param {string} exitNotes - Optional notes
 * @returns {Promise<Object|null>} Updated trade or null
 */
export async function closeTrade(id, exitPrice, exitDate, exitNotes = null) {
  return updateTrade(id, {
    exitPrice: Number(exitPrice),
    exitDate: exitDate || new Date().toISOString().slice(0, 10),
    exitType: 'manual',
    exitNotes,
    status: 'closed'
  });
}

/**
 * Delete a trade
 * @param {string} id - Trade ID
 * @returns {Promise<boolean>} True if deleted
 */
export async function deleteTrade(id) {
  const data = await loadTrades();
  const idx = data.trades.findIndex(t => t.id === id);
  
  if (idx === -1) return false;
  
  const deleted = data.trades.splice(idx, 1)[0];
  if (isSupabaseConfigured()) {
    const supabase = getSupabase();
    await supabase.from('trades').delete().eq('id', id);
    const stats = recalcStatsFromTrades(data.trades);
    await supabase.from('trade_stats').insert({
      total_trades: stats.totalTrades ?? 0,
      open_trades: stats.openTrades ?? 0,
      closed_trades: stats.closedTrades ?? 0,
      win_rate: stats.winRate ?? null,
      avg_return: stats.avgReturn ?? null,
      stats_json: stats,
      last_updated: new Date().toISOString(),
    });
  } else {
    recalculateStats(data);
    await saveTrades(data);
  }
  
  console.log(`🗑️ Trade deleted: ${deleted.ticker}`);
  
  return true;
}

/**
 * Check all open trades for auto-exit signals
 * This is called periodically or on-demand to update trade statuses
 * 
 * @returns {Object} Results of auto-exit checks
 */
export async function checkAutoExits() {
  const data = await loadTrades();
  const openTrades = data.trades.filter(t => t.status === 'open');
  
  if (openTrades.length === 0) {
    return { checked: 0, closed: 0, details: [] };
  }
  
  console.log(`🔍 Checking ${openTrades.length} open trades for auto-exit signals...`);
  
  const results = {
    checked: openTrades.length,
    closed: 0,
    details: []
  };
  
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 30);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = today.toISOString().slice(0, 10);
  
  for (const trade of openTrades) {
    try {
      // Get recent bars for the ticker
      let bars = null;
      
      // Try DB cache first, then fetch from API
      bars = await getBarsFromCache(trade.ticker, fromStr, toStr, '1d');
      if (!bars || bars.length < 15) {
        bars = await getBars(trade.ticker, fromStr, toStr);
      }
      
      if (!bars || bars.length < 15) {
        results.details.push({
          ticker: trade.ticker,
          status: 'insufficient_data',
          message: 'Not enough bar data'
        });
        continue;
      }
      
      // Sort bars by time
      const sortedBars = [...bars].sort((a, b) => a.t - b.t);
      
      // Check exit signal using Opus4.5 logic
      const exitCheck = checkExitSignal(
        { entryPrice: trade.entryPrice, entryDate: trade.entryDate, ticker: trade.ticker },
        sortedBars
      );
      
      // Update last checked date
      const tradeIdx = data.trades.findIndex(t => t.id === trade.id);
      if (tradeIdx !== -1) {
        data.trades[tradeIdx].lastCheckedDate = new Date().toISOString();
      }
      
      if (exitCheck.exitSignal) {
        // Auto-close the trade
        const exitDate = exitCheck.exitDate
          ? new Date(exitCheck.exitDate).toISOString().slice(0, 10)
          : toStr;
        
        if (tradeIdx !== -1) {
          data.trades[tradeIdx].exitPrice = exitCheck.exitPrice;
          data.trades[tradeIdx].exitDate = exitDate;
          data.trades[tradeIdx].exitType = exitCheck.exitType === 'STOP_LOSS' ? 'stop_loss' : 'below_10ma';
          data.trades[tradeIdx].exitNotes = `Auto-closed: ${exitCheck.exitReason}`;
          data.trades[tradeIdx].status = exitCheck.exitType === 'STOP_LOSS' ? 'stopped' : 'closed';
          data.trades[tradeIdx].returnPct = exitCheck.pctFromEntry;
          data.trades[tradeIdx].holdingDays = Math.ceil(
            (new Date(exitDate).getTime() - new Date(trade.entryDate).getTime()) / (1000 * 60 * 60 * 24)
          );
          data.trades[tradeIdx].updatedAt = new Date().toISOString();
        }
        
        results.closed++;
        results.details.push({
          ticker: trade.ticker,
          status: 'closed',
          exitType: exitCheck.exitType,
          exitPrice: exitCheck.exitPrice,
          returnPct: exitCheck.pctFromEntry,
          reason: exitCheck.exitReason
        });
        
        console.log(`🚨 Auto-exit triggered for ${trade.ticker}: ${exitCheck.exitReason}`);
      } else {
        results.details.push({
          ticker: trade.ticker,
          status: 'holding',
          currentPrice: exitCheck.currentPrice,
          returnPct: exitCheck.pctFromEntry,
          above10MA: exitCheck.above10MA,
          aboveStop: exitCheck.aboveStop
        });
      }
    } catch (e) {
      results.details.push({
        ticker: trade.ticker,
        status: 'error',
        message: e.message
      });
    }
  }
  
  // Save updated trades
  recalculateStats(data);
  await saveTrades(data);
  
  console.log(`✅ Auto-exit check complete: ${results.closed}/${results.checked} trades closed`);
  
  return results;
}

/**
 * Recalculate trade statistics
 * @param {Object} data - Trades file content
 */
function recalculateStats(data) {
  const trades = data.trades;
  const closedTrades = trades.filter(t => t.status !== 'open');
  const winners = closedTrades.filter(t => t.returnPct != null && t.returnPct > 0);
  const losers = closedTrades.filter(t => t.returnPct != null && t.returnPct <= 0);
  
  data.stats = {
    totalTrades: trades.length,
    openTrades: trades.filter(t => t.status === 'open').length,
    closedTrades: closedTrades.length,
    
    winRate: closedTrades.length > 0
      ? Math.round((winners.length / closedTrades.length) * 1000) / 10
      : null,
    
    avgReturn: closedTrades.length > 0
      ? Math.round(closedTrades.reduce((sum, t) => sum + (t.returnPct || 0), 0) / closedTrades.length * 10) / 10
      : null,
    
    avgWin: winners.length > 0
      ? Math.round(winners.reduce((sum, t) => sum + (t.returnPct || 0), 0) / winners.length * 10) / 10
      : null,
    
    avgLoss: losers.length > 0
      ? Math.round(losers.reduce((sum, t) => sum + (t.returnPct || 0), 0) / losers.length * 10) / 10
      : null,
    
    bestTrade: winners.length > 0
      ? (() => {
          const best = winners.reduce((a, b) => (a.returnPct || 0) > (b.returnPct || 0) ? a : b);
          return { ticker: best.ticker, returnPct: best.returnPct };
        })()
      : null,
    
    worstTrade: losers.length > 0
      ? (() => {
          const worst = losers.reduce((a, b) => (a.returnPct || 0) < (b.returnPct || 0) ? a : b);
          return { ticker: worst.ticker, returnPct: worst.returnPct };
        })()
      : null,
    
    // Group by conviction
    byConviction: [1, 2, 3, 4, 5].reduce((acc, level) => {
      const group = closedTrades.filter(t => t.conviction === level);
      const groupWinners = group.filter(t => t.returnPct != null && t.returnPct > 0);
      acc[level] = {
        count: group.length,
        winRate: group.length > 0
          ? Math.round((groupWinners.length / group.length) * 1000) / 10
          : null,
        avgReturn: group.length > 0
          ? Math.round(group.reduce((sum, t) => sum + (t.returnPct || 0), 0) / group.length * 10) / 10
          : null
      };
      return acc;
    }, {}),
    
    // Group by pattern
    byPattern: closedTrades.reduce((acc, trade) => {
      const pattern = trade.entryMetrics?.pattern || 'Unknown';
      if (!acc[pattern]) {
        acc[pattern] = { count: 0, wins: 0, totalReturn: 0 };
      }
      acc[pattern].count++;
      if (trade.returnPct != null && trade.returnPct > 0) acc[pattern].wins++;
      acc[pattern].totalReturn += trade.returnPct || 0;
      return acc;
    }, {}),
    
    // Group by exit type
    byExitType: closedTrades.reduce((acc, trade) => {
      const exitType = trade.exitType || 'unknown';
      if (!acc[exitType]) {
        acc[exitType] = { count: 0, totalReturn: 0 };
      }
      acc[exitType].count++;
      acc[exitType].totalReturn += trade.returnPct || 0;
      return acc;
    }, {})
  };
  
  // Finalize pattern stats
  for (const pattern in data.stats.byPattern) {
    const p = data.stats.byPattern[pattern];
    p.winRate = p.count > 0 ? Math.round((p.wins / p.count) * 1000) / 10 : null;
    p.avgReturn = p.count > 0 ? Math.round(p.totalReturn / p.count * 10) / 10 : null;
    delete p.wins;
    delete p.totalReturn;
  }
  
  // Finalize exit type stats
  for (const exitType in data.stats.byExitType) {
    const e = data.stats.byExitType[exitType];
    e.avgReturn = e.count > 0 ? Math.round(e.totalReturn / e.count * 10) / 10 : null;
    delete e.totalReturn;
  }
}

/**
 * Generate learning feedback from trade history
 * This analyzes which entry metrics correlate with successful trades
 * 
 * @returns {Object} Learning feedback data
 */
export async function generateLearningFeedback() {
  const data = await loadTrades();
  const closedTrades = data.trades.filter(t => t.status !== 'open' && t.returnPct != null);
  
  if (closedTrades.length < 5) {
    return {
      error: 'Need at least 5 closed trades for learning analysis',
      tradesAvailable: closedTrades.length
    };
  }
  
  const winners = closedTrades.filter(t => t.returnPct > 0);
  const losers = closedTrades.filter(t => t.returnPct <= 0);
  
  // Analyze metric correlations
  const metrics = [
    'contractions',
    'relativeStrength',
    'opus45Confidence',
    'vcpScore',
    'enhancedScore',
    'pctFromHigh',
    'pctAboveLow',
    'industryRank'
  ];
  
  const metricCorrelations = {};
  
  for (const metric of metrics) {
    const winnerValues = winners
      .map(t => t.entryMetrics?.[metric])
      .filter(v => v != null);
    const loserValues = losers
      .map(t => t.entryMetrics?.[metric])
      .filter(v => v != null);
    
    const winnerAvg = winnerValues.length > 0
      ? winnerValues.reduce((a, b) => a + b, 0) / winnerValues.length
      : null;
    const loserAvg = loserValues.length > 0
      ? loserValues.reduce((a, b) => a + b, 0) / loserValues.length
      : null;
    
    // Simple correlation: positive if winners have higher values
    let correlation = 0;
    if (winnerAvg != null && loserAvg != null && loserAvg !== 0) {
      // For pctFromHigh and industryRank, lower is better (invert correlation)
      if (metric === 'pctFromHigh' || metric === 'industryRank') {
        correlation = (loserAvg - winnerAvg) / Math.abs(loserAvg);
      } else {
        correlation = (winnerAvg - loserAvg) / Math.abs(loserAvg);
      }
      correlation = Math.max(-1, Math.min(1, correlation));
    }
    
    metricCorrelations[metric] = {
      winnerAvg: winnerAvg != null ? Math.round(winnerAvg * 10) / 10 : null,
      loserAvg: loserAvg != null ? Math.round(loserAvg * 10) / 10 : null,
      correlation: Math.round(correlation * 100) / 100
    };
  }
  
  // Generate suggested weight adjustments based on correlations
  const suggestedWeights = {};
  
  // Map entry metrics to Opus4.5 weight keys
  const metricToWeight = {
    contractions: ['vcpContractions3Plus', 'vcpContractions4Plus'],
    relativeStrength: ['entryRSAbove90', 'relativeStrengthBonus'],
    industryRank: ['industryTop20', 'industryTop40'],
    volumeDryUp: ['vcpVolumeDryUp']
  };
  
  for (const [metric, weights] of Object.entries(metricToWeight)) {
    const corr = metricCorrelations[metric]?.correlation || 0;
    
    for (const weightKey of weights) {
      const currentWeight = DEFAULT_WEIGHTS[weightKey] || 0;
      
      // Suggest adjustment: +/- 20% based on correlation strength
      const adjustment = Math.round(currentWeight * corr * 0.2);
      const suggested = Math.max(0, currentWeight + adjustment);
      
      if (Math.abs(adjustment) >= 1) {
        suggestedWeights[weightKey] = {
          current: currentWeight,
          suggested,
          reason: corr > 0
            ? `${metric} correlates with winners (+${Math.round(corr * 100)}%)`
            : `${metric} correlates with losers (${Math.round(corr * 100)}%)`
        };
      }
    }
  }
  
  // Conviction analysis
  const convictionCorrelation = {};
  for (let level = 1; level <= 5; level++) {
    const convTrades = closedTrades.filter(t => t.conviction === level);
    if (convTrades.length > 0) {
      const avgReturn = convTrades.reduce((sum, t) => sum + (t.returnPct || 0), 0) / convTrades.length;
      convictionCorrelation[level] = {
        count: convTrades.length,
        avgReturn: Math.round(avgReturn * 10) / 10,
        winRate: Math.round(convTrades.filter(t => t.returnPct > 0).length / convTrades.length * 100)
      };
    }
  }
  
  return {
    totalClosed: closedTrades.length,
    winners: winners.length,
    losers: losers.length,
    winRate: Math.round(winners.length / closedTrades.length * 100),
    metricCorrelations,
    convictionCorrelation,
    suggestedWeights,
    recommendation: generateRecommendation(metricCorrelations, suggestedWeights)
  };
}

/**
 * Generate human-readable recommendation from analysis
 */
function generateRecommendation(correlations, weights) {
  const recommendations = [];
  
  // Find strongest positive correlations
  const sorted = Object.entries(correlations)
    .filter(([_, v]) => v.correlation != null)
    .sort((a, b) => b[1].correlation - a[1].correlation);
  
  if (sorted.length > 0 && sorted[0][1].correlation > 0.2) {
    recommendations.push(
      `Focus on ${sorted[0][0]}: Winners averaged ${sorted[0][1].winnerAvg} vs losers at ${sorted[0][1].loserAvg}`
    );
  }
  
  // Find strongest negative correlations (avoid these)
  if (sorted.length > 0 && sorted[sorted.length - 1][1].correlation < -0.2) {
    const worst = sorted[sorted.length - 1];
    recommendations.push(
      `Avoid high ${worst[0]}: Losers averaged ${worst[1].loserAvg} vs winners at ${worst[1].winnerAvg}`
    );
  }
  
  // Weight adjustment summary
  const weightChanges = Object.entries(weights).filter(([_, v]) => v.suggested !== v.current);
  if (weightChanges.length > 0) {
    recommendations.push(
      `Suggested weight adjustments: ${weightChanges.map(([k, v]) => `${k}: ${v.current}→${v.suggested}`).join(', ')}`
    );
  }
  
  return recommendations.length > 0
    ? recommendations.join('\n')
    : 'Not enough data to make recommendations. Keep trading and logging!';
}

/**
 * Get trade statistics
 * @returns {Object} Trade statistics
 */
export async function getTradeStats() {
  const data = await loadTrades();
  return data.stats;
}
