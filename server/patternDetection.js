/**
 * Minervini Pattern Detection
 * Identifies which setup has formed: VCP, Flat Base, or Cup-with-Handle
 * Based on Mark Minervini's SEPA methodology
 */

/**
 * Calculate simple moving average
 */
function sma(closes, period) {
  if (!closes || closes.length < period) return null;
  let sum = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    sum += closes[i];
  }
  return sum / period;
}

/**
 * Find local highs and lows in price action
 * Returns array of { idx, price, type: 'high'|'low' }
 */
function findPivots(bars, lookback = 5) {
  const pivots = [];
  
  for (let i = lookback; i < bars.length - lookback; i++) {
    const current = bars[i].h;
    const currentLow = bars[i].l;
    
    // Check if this is a local high
    let isHigh = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j !== i && bars[j].h >= current) {
        isHigh = false;
        break;
      }
    }
    if (isHigh) {
      pivots.push({ idx: i, price: current, type: 'high', date: bars[i].t });
    }
    
    // Check if this is a local low
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j !== i && bars[j].l <= currentLow) {
        isLow = false;
        break;
      }
    }
    if (isLow) {
      pivots.push({ idx: i, price: currentLow, type: 'low', date: bars[i].t });
    }
  }
  
  return pivots.sort((a, b) => a.idx - b.idx);
}

/**
 * Detect Volatility Contraction Pattern (VCP)
 * Criteria:
 * - 3-4+ tightening pullbacks (each smaller than the last)
 * - 10-15 week (50-75 day) duration minimum
 * - Volume dries up on each pullback
 * - Price above 200-day MA
 */
function detectVCP(bars, contractions, volumeDryUp) {
  if (!bars || bars.length < 50) return { detected: false, confidence: 0, details: 'Not enough bars' };
  
  const closes = bars.map(b => b.c);
  const lastClose = closes[closes.length - 1];
  const sma200 = sma(closes, 200);
  
  // Check if we have contractions data
  if (!contractions || contractions < 2) {
    return { 
      detected: false, 
      confidence: 0, 
      details: 'Insufficient contractions (need 2+ tightening pullbacks)' 
    };
  }
  
  // VCP Scoring (0-100)
  let score = 0;
  const reasons = [];
  
  // 1. Contractions (0-35 points)
  if (contractions >= 4) {
    score += 35;
    reasons.push('4+ contractions (excellent)');
  } else if (contractions >= 3) {
    score += 25;
    reasons.push('3 contractions (strong)');
  } else if (contractions >= 2) {
    score += 15;
    reasons.push('2 contractions (good)');
  }
  
  // 2. Volume dry-up (0-25 points)
  if (volumeDryUp === true) {
    score += 25;
    reasons.push('Volume drying up on pullbacks');
  } else if (volumeDryUp === false) {
    score += 0;
    reasons.push('Volume not contracting (concern)');
  }
  
  // 3. Above 200-day MA (0-20 points)
  if (sma200 && lastClose > sma200) {
    score += 20;
    reasons.push('Above 200-day MA (Stage 2)');
  } else if (sma200) {
    reasons.push('Below 200-day MA (not Stage 2)');
  }
  
  // 4. Base duration check (0-20 points)
  // Look for consolidation period (at least 50 days)
  if (bars.length >= 75) {
    score += 20;
    reasons.push('Sufficient base duration (10+ weeks)');
  } else if (bars.length >= 50) {
    score += 10;
    reasons.push('Moderate base duration (7-10 weeks)');
  } else {
    reasons.push('Base too short (<7 weeks)');
  }
  
  const confidence = Math.min(100, score);
  const detected = confidence >= 60; // Need 60+ points for valid VCP
  
  return {
    detected,
    confidence,
    details: reasons.join('; '),
    pattern: 'VCP',
    contractions,
    volumeDryUp
  };
}

/**
 * Detect Flat Base
 * Criteria:
 * - Tight 5-20% range for 5+ weeks
 * - Forms after 30%+ move
 * - Within 15% of 52-week high
 * - Low volatility (no wild swings)
 */
function detectFlatBase(bars) {
  if (!bars || bars.length < 25) return { detected: false, confidence: 0, details: 'Not enough bars' };
  
  // Look at last 5-10 weeks (25-50 days)
  const lookback = Math.min(50, bars.length);
  const recentBars = bars.slice(-lookback);
  
  const closes = recentBars.map(b => b.c);
  const highs = recentBars.map(b => b.h);
  const lows = recentBars.map(b => b.l);
  
  const maxHigh = Math.max(...highs);
  const minLow = Math.min(...lows);
  const range = ((maxHigh - minLow) / maxHigh) * 100; // % range
  
  const lastClose = closes[closes.length - 1];
  const allCloses = bars.map(b => b.c);
  const highestClose52w = Math.max(...allCloses.slice(-252)); // 52 weeks = ~252 trading days
  const distanceFromHigh = ((highestClose52w - lastClose) / highestClose52w) * 100;
  
  let score = 0;
  const reasons = [];
  
  // 1. Tight range check (0-40 points)
  if (range <= 8) {
    score += 40;
    reasons.push(`Very tight range (${range.toFixed(1)}%)`);
  } else if (range <= 12) {
    score += 30;
    reasons.push(`Tight range (${range.toFixed(1)}%)`);
  } else if (range <= 20) {
    score += 20;
    reasons.push(`Moderate range (${range.toFixed(1)}%)`);
  } else {
    reasons.push(`Range too wide (${range.toFixed(1)}%)`);
  }
  
  // 2. Duration check (0-20 points)
  if (lookback >= 50) {
    score += 20;
    reasons.push('Duration 10+ weeks (ideal)');
  } else if (lookback >= 35) {
    score += 15;
    reasons.push('Duration 7+ weeks (good)');
  } else if (lookback >= 25) {
    score += 10;
    reasons.push('Duration 5+ weeks (minimum)');
  }
  
  // 3. Near 52-week high (0-30 points)
  if (distanceFromHigh <= 5) {
    score += 30;
    reasons.push('Within 5% of 52-week high');
  } else if (distanceFromHigh <= 10) {
    score += 20;
    reasons.push('Within 10% of 52-week high');
  } else if (distanceFromHigh <= 15) {
    score += 10;
    reasons.push('Within 15% of 52-week high');
  } else {
    reasons.push(`${distanceFromHigh.toFixed(1)}% from 52-week high`);
  }
  
  // 4. Low volatility check (0-10 points)
  // Calculate average daily range
  const avgDailyRange = recentBars.reduce((sum, bar) => {
    return sum + ((bar.h - bar.l) / bar.c) * 100;
  }, 0) / recentBars.length;
  
  if (avgDailyRange < 2.0) {
    score += 10;
    reasons.push('Very low volatility');
  } else if (avgDailyRange < 3.0) {
    score += 5;
    reasons.push('Low volatility');
  }
  
  const confidence = Math.min(100, score);
  const detected = confidence >= 60 && range <= 20; // Need 60+ points and <20% range
  
  return {
    detected,
    confidence,
    details: reasons.join('; '),
    pattern: 'Flat Base',
    baseRange: range.toFixed(1) + '%',
    weeksInBase: Math.round(lookback / 5),
    distanceFromHigh: distanceFromHigh.toFixed(1) + '%'
  };
}

/**
 * Detect Cup-with-Handle
 * Criteria:
 * - U-shaped base (7-65 weeks)
 * - Depth 12-33% (deeper OK in bear markets)
 * - Handle forms (1-4 weeks) after right side
 * - Handle depth 8-12% max
 * - Rounded bottom (not V-shaped)
 */
function detectCupWithHandle(bars) {
  if (!bars || bars.length < 50) return { detected: false, confidence: 0, details: 'Not enough bars' };
  
  // Need at least 10 weeks (50 days) for a valid cup
  const lookback = Math.min(252, bars.length); // Up to 1 year
  const recentBars = bars.slice(-lookback);
  
  const closes = recentBars.map(b => b.c);
  const highs = recentBars.map(b => b.h);
  
  // Find the left rim (highest point in first third)
  const leftThird = Math.floor(recentBars.length / 3);
  const leftRimIdx = highs.slice(0, leftThird).indexOf(Math.max(...highs.slice(0, leftThird)));
  const leftRimPrice = highs[leftRimIdx];
  
  // Find the bottom of cup (lowest point in middle section)
  const middleStart = Math.floor(recentBars.length * 0.2);
  const middleEnd = Math.floor(recentBars.length * 0.7);
  const bottomPrices = closes.slice(middleStart, middleEnd);
  const bottomPrice = Math.min(...bottomPrices);
  const bottomIdx = closes.indexOf(bottomPrice);
  
  // Find the right rim (highest point in last third)
  const rightThird = Math.floor(recentBars.length * 2 / 3);
  const rightRimIdx = rightThird + highs.slice(rightThird).indexOf(Math.max(...highs.slice(rightThird)));
  const rightRimPrice = highs[rightRimIdx];
  
  // Calculate cup depth
  const cupDepth = ((leftRimPrice - bottomPrice) / leftRimPrice) * 100;
  
  // Check for handle (last 5-20 days)
  const handleStart = Math.max(rightRimIdx, recentBars.length - 20);
  const handleBars = recentBars.slice(handleStart);
  const handleHighs = handleBars.map(b => b.h);
  const handleLows = handleBars.map(b => b.l);
  const handleHigh = Math.max(...handleHighs);
  const handleLow = Math.min(...handleLows);
  const handleDepth = ((handleHigh - handleLow) / handleHigh) * 100;
  
  let score = 0;
  const reasons = [];
  
  // 1. Cup depth check (0-30 points)
  if (cupDepth >= 12 && cupDepth <= 33) {
    score += 30;
    reasons.push(`Ideal cup depth (${cupDepth.toFixed(1)}%)`);
  } else if (cupDepth >= 8 && cupDepth <= 50) {
    score += 20;
    reasons.push(`Acceptable cup depth (${cupDepth.toFixed(1)}%)`);
  } else if (cupDepth < 8) {
    score += 5;
    reasons.push(`Cup too shallow (${cupDepth.toFixed(1)}%)`);
  } else {
    reasons.push(`Cup too deep (${cupDepth.toFixed(1)}%)`);
  }
  
  // 2. U-shape check (not V-shaped) (0-25 points)
  // Calculate how long price stayed in bottom 25% of cup
  const bottomThreshold = bottomPrice + (leftRimPrice - bottomPrice) * 0.25;
  const daysInBottom = closes.filter(c => c <= bottomThreshold).length;
  const pctInBottom = (daysInBottom / closes.length) * 100;
  
  if (pctInBottom >= 20) {
    score += 25;
    reasons.push('Rounded U-shape (not V-shaped)');
  } else if (pctInBottom >= 10) {
    score += 15;
    reasons.push('Moderate rounding');
  } else {
    reasons.push('Too V-shaped');
  }
  
  // 3. Handle presence and depth (0-30 points)
  if (handleBars.length >= 5 && handleBars.length <= 20) {
    if (handleDepth >= 4 && handleDepth <= 12) {
      score += 30;
      reasons.push(`Ideal handle (${handleDepth.toFixed(1)}% depth, ${handleBars.length}d)`);
    } else if (handleDepth < 4) {
      score += 20;
      reasons.push(`Shallow handle (${handleDepth.toFixed(1)}%)`);
    } else if (handleDepth <= 15) {
      score += 15;
      reasons.push(`Deep handle (${handleDepth.toFixed(1)}%)`);
    } else {
      reasons.push(`Handle too deep (${handleDepth.toFixed(1)}%)`);
    }
  } else {
    reasons.push('No clear handle formed');
  }
  
  // 4. Duration check (0-15 points)
  const weeksInCup = lookback / 5;
  if (weeksInCup >= 7 && weeksInCup <= 65) {
    score += 15;
    reasons.push(`Duration ${weeksInCup.toFixed(0)} weeks (ideal)`);
  } else if (weeksInCup < 7) {
    score += 5;
    reasons.push(`Too short (${weeksInCup.toFixed(0)} weeks)`);
  } else {
    score += 5;
    reasons.push(`Too long (${weeksInCup.toFixed(0)} weeks)`);
  }
  
  const confidence = Math.min(100, score);
  const detected = confidence >= 60 && cupDepth >= 8 && handleBars.length >= 5;
  
  return {
    detected,
    confidence,
    details: reasons.join('; '),
    pattern: 'Cup-with-Handle',
    cupDepth: cupDepth.toFixed(1) + '%',
    handleDepth: handleDepth.toFixed(1) + '%',
    handleLength: handleBars.length + ' days',
    weeksInCup: weeksInCup.toFixed(0)
  };
}

/**
 * Identify which pattern has formed
 * Returns the best matching pattern with confidence score
 * 
 * @param {Array} bars - Price bars (OHLC)
 * @param {number} contractions - Number of volatility contractions
 * @param {boolean} volumeDryUp - Whether volume is drying up
 * @returns {Object} { pattern, confidence, details, allPatterns }
 */
export function identifyPattern(bars, contractions = 0, volumeDryUp = false) {
  if (!bars || bars.length < 25) {
    return {
      pattern: 'None',
      confidence: 0,
      details: 'Insufficient data',
      allPatterns: {}
    };
  }
  
  // Test all three patterns
  const vcpResult = detectVCP(bars, contractions, volumeDryUp);
  const flatBaseResult = detectFlatBase(bars);
  const cupHandleResult = detectCupWithHandle(bars);
  
  // Collect all patterns with their confidence scores
  const allPatterns = {
    VCP: vcpResult,
    'Flat Base': flatBaseResult,
    'Cup-with-Handle': cupHandleResult
  };
  
  // Find the pattern with highest confidence (minimum 40% confidence to be considered)
  let bestPattern = null;
  let bestConfidence = 40; // Threshold
  
  if (vcpResult.confidence > bestConfidence) {
    bestPattern = vcpResult;
    bestConfidence = vcpResult.confidence;
  }
  
  if (flatBaseResult.confidence > bestConfidence) {
    bestPattern = flatBaseResult;
    bestConfidence = flatBaseResult.confidence;
  }
  
  if (cupHandleResult.confidence > bestConfidence) {
    bestPattern = cupHandleResult;
    bestConfidence = cupHandleResult.confidence;
  }
  
  // If multiple patterns are detected with similar confidence, prefer VCP
  if (bestPattern === null) {
    // Check if any pattern is close to threshold
    const patterns = [vcpResult, flatBaseResult, cupHandleResult]
      .filter(p => p.confidence >= 35)
      .sort((a, b) => b.confidence - a.confidence);
    
    if (patterns.length > 0) {
      bestPattern = patterns[0];
      bestConfidence = patterns[0].confidence;
    }
  }
  
  return {
    pattern: bestPattern ? bestPattern.pattern : 'None',
    confidence: bestConfidence,
    detected: bestPattern ? bestPattern.detected : false,
    details: bestPattern ? bestPattern.details : 'No clear pattern detected',
    allPatterns // Include all pattern analysis for debugging
  };
}

/**
 * Get a simple pattern label for display
 * Returns short form: "VCP", "Flat", "C&H", or "-"
 */
export function getPatternLabel(patternResult) {
  if (!patternResult || !patternResult.pattern || patternResult.pattern === 'None') {
    return '-';
  }
  
  const pattern = patternResult.pattern;
  if (pattern === 'Cup-with-Handle') return 'C&H';
  if (pattern === 'Flat Base') return 'Flat';
  if (pattern === 'VCP') return 'VCP';
  return '-';
}
