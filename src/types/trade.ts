/**
 * Trade Journal Types
 * 
 * These types define the structure for recording and analyzing trades.
 * The system captures:
 * - Entry data (price, date, technical indicators at time of entry)
 * - Exit data (auto-detected or manually entered)
 * - Conviction level (your confidence in the trade)
 * - All metrics used by Opus4.5 for learning purposes
 * 
 * The goal is to feed this data back into the Opus4.5 scoring system
 * to improve buy signal accuracy based on real trade outcomes.
 */

// Conviction level scale (1-5)
// This helps the learning system understand which signals you trusted most
export type ConvictionLevel = 1 | 2 | 3 | 4 | 5

// Trade status - where the trade is in its lifecycle
export type TradeStatus = 
  | 'open'      // Currently holding position
  | 'closed'    // Exited (either manually or auto-detected)
  | 'stopped'   // Exited via stop-loss

// How the trade was exited
export type ExitType = 
  | 'manual'        // User manually closed
  | 'stop_loss'     // 4% stop loss hit
  | 'below_10ma'    // Price closed below 10 MA
  | 'target_hit'    // Hit 52w high target
  | 'time_stop'     // Held too long without progress

/**
 * Technical indicators captured at time of entry
 * These are the same metrics used by Opus4.5 for scoring
 */
export interface EntryMetrics {
  // Moving Averages
  sma10: number | null
  sma20: number | null
  sma50: number | null
  sma150: number | null
  sma200: number | null
  
  // VCP pattern data
  contractions: number
  volumeDryUp: boolean
  pattern: string | null           // 'VCP', 'Cup-with-Handle', 'Flat Base', etc.
  patternConfidence: number | null
  
  // Relative Strength
  relativeStrength: number | null  // RS rank vs S&P 500
  
  // 52-week positioning
  pctFromHigh: number | null       // Distance from 52w high
  pctAboveLow: number | null       // Distance above 52w low
  high52w: number | null
  low52w: number | null
  
  // Industry context
  industryName: string | null
  industryRank: number | null
  
  // Opus4.5 scores at entry
  opus45Confidence: number | null
  opus45Grade: string | null       // 'A+', 'A', 'B+', etc.
  vcpScore: number | null
  enhancedScore: number | null
}

/**
 * A single trade record
 */
export interface Trade {
  // Unique identifier
  id: string
  
  // Basic trade info
  ticker: string
  companyName: string | null
  
  // Entry details
  entryDate: string              // ISO date string
  entryPrice: number
  entryMetrics: EntryMetrics
  conviction: ConvictionLevel    // 1-5 scale
  notes: string | null           // Why you took this trade
  
  // Exit details (null if trade is still open)
  exitDate: string | null
  exitPrice: number | null
  exitType: ExitType | null
  exitNotes: string | null
  
  // Computed values
  status: TradeStatus
  returnPct: number | null       // Percentage return (after exit)
  holdingDays: number | null     // Days held (after exit)
  
  // Auto-exit tracking
  stopLossPrice: number          // 4% below entry
  targetPrice: number            // 52w high or calculated target
  lastCheckedDate: string | null // When auto-exit was last checked
  
  // Metadata
  createdAt: string
  updatedAt: string
}

/**
 * Trade journal file structure
 * This is what gets saved to data/trades.json
 */
export interface TradesFile {
  version: number                // Schema version for migrations
  trades: Trade[]
  lastUpdated: string
  
  // Learning statistics (updated by analysis)
  stats: TradeStats
}

/**
 * Aggregated statistics from trade history
 * Used for learning feedback to Opus4.5
 */
export interface TradeStats {
  totalTrades: number
  openTrades: number
  closedTrades: number
  
  // Win/Loss metrics
  winRate: number | null         // % of profitable trades
  avgReturn: number | null       // Average return %
  avgWin: number | null          // Average winning trade %
  avgLoss: number | null         // Average losing trade %
  
  // Best/Worst
  bestTrade: { ticker: string; returnPct: number } | null
  worstTrade: { ticker: string; returnPct: number } | null
  
  // By conviction level (does higher conviction = better results?)
  byConviction: {
    [key: number]: {
      count: number
      winRate: number | null
      avgReturn: number | null
    }
  }
  
  // By pattern type (which patterns work best?)
  byPattern: {
    [key: string]: {
      count: number
      winRate: number | null
      avgReturn: number | null
    }
  }
  
  // By exit type (how do different exits perform?)
  byExitType: {
    [key: string]: {
      count: number
      avgReturn: number | null
    }
  }
}

/**
 * Form data for creating a new trade entry
 * This is what the UI captures before creating a full Trade record
 */
export interface TradeEntryForm {
  ticker: string
  entryDate: string
  entryPrice: number
  conviction: ConvictionLevel
  notes: string | null
}

/**
 * Learning feedback data
 * This is sent to the Opus4.5 weight adjustment system
 */
export interface LearningFeedback {
  // Group trades by outcome
  winners: Trade[]
  losers: Trade[]
  
  // Correlation analysis
  // Which entry metrics correlate with winning trades?
  metricCorrelations: {
    [metricName: string]: {
      winnerAvg: number | null
      loserAvg: number | null
      correlation: number        // -1 to 1, positive = good predictor
    }
  }
  
  // Suggested weight adjustments
  suggestedWeights: {
    [weightName: string]: {
      current: number
      suggested: number
      reason: string
    }
  }
}
