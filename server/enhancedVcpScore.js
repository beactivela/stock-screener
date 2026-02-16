/**
 * Enhanced VCP + CANSLIM + Industry Trends Scoring System
 * 
 * This system combines:
 * 1. Mark Minervini's VCP (Volatility Contraction Pattern) criteria
 * 2. William O'Neil's CANSLIM methodology from IBD
 * 3. Industry momentum and trend analysis
 * 
 * Scoring Range: 0-100 points
 * - VCP Technical: 40 points
 * - CANSLIM Fundamental: 35 points  
 * - Industry & Market Context: 25 points
 */

// VCP Technical Analysis (40 points total)
function calculateVCPTechnicalScore(data) {
  let score = 0;
  const {
    contractions,           // Array of pullback contractions
    volumeData,            // Volume analysis data
    movingAverages,        // 10, 20, 50, 150, 200 SMA
    priceAction,           // Price consolidation data
    relativeStrength       // RS vs SPY
  } = data;

  // 1. Progressive Contractions (12 points)
  if (contractions && contractions.length > 0) {
    const contractionCount = contractions.length;
    
    if (contractionCount >= 3) {
      score += 8; // Strong pattern (3+ contractions)
    } else if (contractionCount >= 2) {
      score += 5; // Good pattern (2 contractions)
    } else if (contractionCount >= 1) {
      score += 2; // Basic pattern (1 contraction)
    }
    
    // Check contraction progression (decreasing ranges)
    let progressiveScore = 0;
    for (let i = 1; i < contractions.length; i++) {
      if (contractions[i].range < contractions[i-1].range) {
        progressiveScore += 2;
      }
    }
    score += Math.min(progressiveScore, 4); // Max 4 points for progression
  }

  // 2. Volume Dry-up Analysis (8 points)
  if (volumeData) {
    const avgVolume = volumeData.recentAverage;
    const pullbackVolume = volumeData.pullbackAverage;
    
    if (pullbackVolume < avgVolume * 0.7) {
      score += 6; // Strong volume dry-up
    } else if (pullbackVolume < avgVolume * 0.9) {
      score += 4; // Moderate volume dry-up
    } else if (pullbackVolume < avgVolume) {
      score += 2; // Slight volume dry-up
    }
    
    // Volume expansion on up days (additional 2 points)
    if (volumeData.upDayVolume > avgVolume * 1.2) {
      score += 2;
    }
  }

  // 3. Moving Average Support (12 points)
  const { sma10, sma20, sma50, sma150, sma200 } = movingAverages;
  const currentPrice = priceAction.currentPrice;
  
  // Stage 2 check (above key MAs)
  if (currentPrice > sma200 && currentPrice > sma150) {
    score += 4; // Above long-term MAs
    
    // Support at key MAs during consolidation
    if (Math.abs(currentPrice - sma50) / sma50 < 0.02) {
      score += 4; // Support at 50-day MA
    } else if (Math.abs(currentPrice - sma20) / sma20 < 0.02) {
      score += 3; // Support at 20-day MA
    } else if (Math.abs(currentPrice - sma10) / sma10 < 0.02) {
      score += 2; // Support at 10-day MA
    }
  }
  
  // Price above key shorter-term MAs
  if (currentPrice > sma50 && currentPrice > sma20) {
    score += 4;
  }

  // 4. Relative Strength (8 points)
  if (relativeStrength) {
    if (relativeStrength > 80) {
      score += 8; // Excellent relative strength
    } else if (relativeStrength > 70) {
      score += 6; // Good relative strength
    } else if (relativeStrength > 60) {
      score += 4; // Above average
    } else if (relativeStrength > 50) {
      score += 2; // Market average
    }
  }

  return Math.min(score, 40); // Cap at 40 points
}