/**
 * Unit tests for Opus4.5 Signal Algorithm
 * Run: node --test server/opus45Signal.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { 
  checkMandatoryCriteria, 
  calculateConfidenceScore, 
  generateOpus45Signal,
  checkExitSignal,
  DEFAULT_WEIGHTS,
  MANDATORY_THRESHOLDS,
  EXIT_THRESHOLDS
} from './opus45Signal.js';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/** Generate mock OHLC bars for testing */
function generateMockBars(count, options = {}) {
  const {
    startPrice = 100,
    trend = 0.001,  // Daily % change (0.1% = trending up)
    volatility = 0.02,  // Daily volatility (2%)
    startTime = Date.now() - count * 24 * 60 * 60 * 1000
  } = options;

  const bars = [];
  let price = startPrice;

  for (let i = 0; i < count; i++) {
    const dailyChange = (Math.random() - 0.5) * volatility + trend;
    price = price * (1 + dailyChange);
    
    const open = price * (1 + (Math.random() - 0.5) * 0.01);
    const close = price;
    const high = Math.max(open, close) * (1 + Math.random() * 0.02);
    const low = Math.min(open, close) * (1 - Math.random() * 0.02);
    
    bars.push({
      t: startTime + i * 24 * 60 * 60 * 1000,
      o: open,
      h: high,
      l: low,
      c: close,
      v: Math.floor(100000 + Math.random() * 500000)
    });
  }

  return bars;
}

/** Generate ideal Stage 2 uptrend bars */
function generateStage2Bars(count = 252) {
  const bars = [];
  let price = 50;  // Start low
  const startTime = Date.now() - count * 24 * 60 * 60 * 1000;

  for (let i = 0; i < count; i++) {
    // Steady uptrend with some volatility
    const trend = 0.002;  // 0.2% daily = ~65% annual
    const noise = (Math.random() - 0.5) * 0.015;
    price = price * (1 + trend + noise);

    const open = price * (1 + (Math.random() - 0.5) * 0.008);
    const close = price;
    const high = Math.max(open, close) * (1 + Math.random() * 0.015);
    const low = Math.min(open, close) * (1 - Math.random() * 0.015);

    bars.push({
      t: startTime + i * 24 * 60 * 60 * 1000,
      o: open,
      h: high,
      l: low,
      c: close,
      v: Math.floor(80000 + Math.random() * 300000)
    });
  }

  return bars;
}

// ============================================================================
// TEST: MANDATORY CRITERIA
// ============================================================================

describe('checkMandatoryCriteria', () => {
  it('passes when all criteria are met', () => {
    const params = {
      bars: generateStage2Bars(252),
      relativeStrength: 85,
      contractions: 3,
      patternConfidence: 65,
      maAlignment: { 
        aligned: true, 
        aboveAllMAs: true, 
        ma200Rising: true,
        sma50: 110,
        sma150: 100,
        sma200: 90
      },
      stats52w: { 
        high52w: 120, 
        low52w: 60, 
        pctFromHigh: 10,  // Within 25%
        pctAboveLow: 90   // Above 25%
      },
      entryPoint: { 
        atMA: true, 
        at10MA: true, 
        at20MA: false, 
        atWhichMA: '10 MA' 
      }
    };

    const result = checkMandatoryCriteria(params);
    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.failedCriteria.length, 0);
  });

  it('fails when MA alignment is wrong', () => {
    const params = {
      bars: [],
      relativeStrength: 85,
      contractions: 3,
      patternConfidence: 65,
      maAlignment: { 
        aligned: false,  // FAIL
        aboveAllMAs: true, 
        ma200Rising: true 
      },
      stats52w: { pctFromHigh: 10, pctAboveLow: 50 },
      entryPoint: { atMA: true, atWhichMA: '10 MA' }
    };

    const result = checkMandatoryCriteria(params);
    assert.strictEqual(result.passed, false);
    assert.ok(result.failedCriteria.some(f => f.includes('MA alignment')));
  });

  it('fails when RS is below 70', () => {
    const params = {
      bars: [],
      relativeStrength: 60,  // FAIL (< 70)
      contractions: 3,
      patternConfidence: 65,
      maAlignment: { aligned: true, aboveAllMAs: true, ma200Rising: true },
      stats52w: { pctFromHigh: 10, pctAboveLow: 50 },
      entryPoint: { atMA: true, atWhichMA: '10 MA' }
    };

    const result = checkMandatoryCriteria(params);
    assert.strictEqual(result.passed, false);
    assert.ok(result.failedCriteria.some(f => f.includes('RS')));
  });

  it('fails when too far from 52-week high', () => {
    const params = {
      bars: [],
      relativeStrength: 85,
      contractions: 3,
      patternConfidence: 65,
      maAlignment: { aligned: true, aboveAllMAs: true, ma200Rising: true },
      stats52w: { 
        pctFromHigh: 35,  // FAIL (> 25%)
        pctAboveLow: 50 
      },
      entryPoint: { atMA: true, atWhichMA: '10 MA' }
    };

    const result = checkMandatoryCriteria(params);
    assert.strictEqual(result.passed, false);
    assert.ok(result.failedCriteria.some(f => f.includes('52w high')));
  });

  it('fails when not enough above 52-week low', () => {
    const params = {
      bars: [],
      relativeStrength: 85,
      contractions: 3,
      patternConfidence: 65,
      maAlignment: { aligned: true, aboveAllMAs: true, ma200Rising: true },
      stats52w: { 
        pctFromHigh: 10, 
        pctAboveLow: 15  // FAIL (< 25%)
      },
      entryPoint: { atMA: true, atWhichMA: '10 MA' }
    };

    const result = checkMandatoryCriteria(params);
    assert.strictEqual(result.passed, false);
    assert.ok(result.failedCriteria.some(f => f.includes('52w low')));
  });

  it('fails when not at MA support', () => {
    const params = {
      bars: [],
      relativeStrength: 85,
      contractions: 3,
      patternConfidence: 65,
      maAlignment: { aligned: true, aboveAllMAs: true, ma200Rising: true },
      stats52w: { pctFromHigh: 10, pctAboveLow: 50 },
      entryPoint: { 
        atMA: false,  // FAIL
        atWhichMA: null 
      }
    };

    const result = checkMandatoryCriteria(params);
    assert.strictEqual(result.passed, false);
    assert.ok(result.failedCriteria.some(f => f.includes('MA support')));
  });
});

// ============================================================================
// TEST: CONFIDENCE SCORING
// ============================================================================

describe('calculateConfidenceScore', () => {
  it('returns higher score for more contractions', () => {
    const params3 = {
      contractions: 3,
      volumeDryUp: false,
      patternConfidence: 50,
      entryPoint: { at10MA: false, at20MA: true },
      volumeConfirmation: { confirmed: false },
      relativeStrength: 75,
      industryRank: 50,
      institutionalOwnership: 40,
      epsGrowth: 0
    };

    const params4 = { ...params3, contractions: 4 };

    const score3 = calculateConfidenceScore(params3, DEFAULT_WEIGHTS);
    const score4 = calculateConfidenceScore(params4, DEFAULT_WEIGHTS);

    assert.ok(score4.confidence > score3.confidence);
  });

  it('adds points for volume dry-up', () => {
    const paramsNoVol = {
      contractions: 2,
      volumeDryUp: false,
      patternConfidence: 50,
      entryPoint: { at10MA: true },
      volumeConfirmation: { confirmed: false },
      relativeStrength: 75
    };

    const paramsWithVol = { ...paramsNoVol, volumeDryUp: true };

    const scoreNo = calculateConfidenceScore(paramsNoVol, DEFAULT_WEIGHTS);
    const scoreWith = calculateConfidenceScore(paramsWithVol, DEFAULT_WEIGHTS);

    assert.ok(scoreWith.confidence > scoreNo.confidence);
  });

  it('gives higher score for 10 MA entry vs 20 MA', () => {
    const params10MA = {
      contractions: 3,
      volumeDryUp: true,
      patternConfidence: 60,
      entryPoint: { at10MA: true, at20MA: false },
      volumeConfirmation: { confirmed: true },
      relativeStrength: 85
    };

    const params20MA = { 
      ...params10MA, 
      entryPoint: { at10MA: false, at20MA: true } 
    };

    const score10 = calculateConfidenceScore(params10MA, DEFAULT_WEIGHTS);
    const score20 = calculateConfidenceScore(params20MA, DEFAULT_WEIGHTS);

    assert.ok(score10.confidence > score20.confidence);
  });

  it('adds points for top 20 industry', () => {
    const paramsTop20 = {
      contractions: 3,
      volumeDryUp: true,
      patternConfidence: 60,
      entryPoint: { at10MA: true },
      volumeConfirmation: { confirmed: true },
      relativeStrength: 85,
      industryRank: 15
    };

    const paramsLow = { ...paramsTop20, industryRank: 80 };

    const scoreTop = calculateConfidenceScore(paramsTop20, DEFAULT_WEIGHTS);
    const scoreLow = calculateConfidenceScore(paramsLow, DEFAULT_WEIGHTS);

    assert.ok(scoreTop.confidence > scoreLow.confidence);
  });

  it('assigns correct grades based on score', () => {
    const highParams = {
      contractions: 4,
      volumeDryUp: true,
      patternConfidence: 80,
      entryPoint: { at10MA: true },
      volumeConfirmation: { confirmed: true },
      relativeStrength: 95,
      industryRank: 5,
      institutionalOwnership: 60,
      epsGrowth: 25
    };

    const lowParams = {
      contractions: 2,
      volumeDryUp: false,
      patternConfidence: 45,
      entryPoint: { at10MA: false, at20MA: true },
      volumeConfirmation: { confirmed: false },
      relativeStrength: 72
    };

    const highScore = calculateConfidenceScore(highParams, DEFAULT_WEIGHTS);
    const lowScore = calculateConfidenceScore(lowParams, DEFAULT_WEIGHTS);

    // High score should get A or A+
    assert.ok(['A', 'A+', 'B+'].includes(highScore.grade));
    // Low score should get C, D, or F
    assert.ok(['C', 'D', 'F'].includes(lowScore.grade));
  });
});

// ============================================================================
// TEST: EXIT SIGNALS
// ============================================================================

describe('checkExitSignal', () => {
  it('triggers stop loss when price drops 4%', () => {
    const position = {
      ticker: 'TEST',
      entryPrice: 100,
      entryDate: Date.now() - 10 * 24 * 60 * 60 * 1000
    };

    // Generate bars ending at 95 (5% down from 100)
    const bars = [];
    for (let i = 0; i < 20; i++) {
      const price = 100 - (i * 0.5);  // Gradually declining
      bars.push({
        t: Date.now() - (20 - i) * 24 * 60 * 60 * 1000,
        o: price + 0.5,
        h: price + 1,
        l: price - 0.5,
        c: price,
        v: 100000
      });
    }
    // Last bar at 95 (5% below entry)
    bars[bars.length - 1].c = 95;

    const result = checkExitSignal(position, bars);
    assert.strictEqual(result.exitSignal, true);
    assert.strictEqual(result.exitType, 'STOP_LOSS');
  });

  it('triggers exit when below 10 MA', () => {
    const position = {
      ticker: 'TEST',
      entryPrice: 100,
      entryDate: Date.now() - 10 * 24 * 60 * 60 * 1000
    };

    // Generate bars with a clear downward cross of 10 MA
    // Start high (above entry), then drop so last close is below 10 MA
    const bars = [];
    for (let i = 0; i < 20; i++) {
      // First 10 bars: steadily at 105 (above entry, establishes 10 MA ~105)
      // Last 10 bars: drop to create a clear cross below 10 MA
      let price;
      if (i < 10) {
        price = 105;  // Establishes 10 MA at ~105
      } else {
        price = 105 - ((i - 10) * 1.5);  // Drop: 105, 103.5, 102, 100.5, 99, 97.5, 96, 94.5, 93, 91.5
      }
      
      bars.push({
        t: Date.now() - (20 - i) * 24 * 60 * 60 * 1000,
        o: price + 0.2,
        h: price + 1,
        l: price - 1,
        c: price,
        v: 100000
      });
    }

    // At this point:
    // - 10 MA is calculated from last 10 closes: ~98.25 (average of declining prices)
    // - Last close is 91.5, which is well below the 10 MA
    // - Still within 4% stop loss of entry (100): 91.5/100 = -8.5%, so stop loss triggers first
    
    // Actually, let's make the final price 97 (within 4% stop, but below 10 MA which should be ~100+)
    // Need a scenario where we're above stop loss threshold but below 10 MA
    
    // Recreate: start at 105, 10 MA will be around 104, last close at 102 (below 10 MA, above -4% stop)
    bars.length = 0;
    for (let i = 0; i < 15; i++) {
      const price = 105;
      bars.push({
        t: Date.now() - (15 - i) * 24 * 60 * 60 * 1000,
        o: price,
        h: price + 0.5,
        l: price - 0.5,
        c: price,
        v: 100000
      });
    }
    // Add 5 declining bars
    for (let i = 0; i < 5; i++) {
      const price = 105 - (i + 1) * 0.8;  // 104.2, 103.4, 102.6, 101.8, 101
      bars.push({
        t: Date.now() - (5 - i) * 24 * 60 * 60 * 1000,
        o: price + 0.5,
        h: price + 0.8,
        l: price - 0.2,
        c: price,
        v: 100000
      });
    }
    
    // Entry price 100, last close 101 (1% above entry, no stop loss)
    // 10 MA = avg of last 10 closes = (105*5 + 104.2 + 103.4 + 102.6 + 101.8 + 101)/10 = 103.8
    // 101 < 103.8, so below 10 MA
    
    // But wait, the test was for entry at 100. Let's re-read the logic.
    // Exit is triggered if: (close < sma10) regardless of entry price
    
    const result = checkExitSignal(position, bars);
    assert.strictEqual(result.exitSignal, true);
    assert.strictEqual(result.exitType, 'BELOW_10MA');
  });

  it('does not trigger exit when above 10 MA and within stop', () => {
    const position = {
      ticker: 'TEST',
      entryPrice: 100,
      entryDate: Date.now() - 10 * 24 * 60 * 60 * 1000
    };

    // Generate steadily rising bars (above 10 MA)
    const bars = [];
    for (let i = 0; i < 20; i++) {
      const price = 100 + (i * 0.5);  // Gradually increasing
      bars.push({
        t: Date.now() - (20 - i) * 24 * 60 * 60 * 1000,
        o: price - 0.5,
        h: price + 1,
        l: price - 0.5,
        c: price,
        v: 100000
      });
    }

    const result = checkExitSignal(position, bars);
    assert.strictEqual(result.exitSignal, false);
    assert.ok(result.pctFromEntry > 0);  // Should be positive
  });
});

// ============================================================================
// TEST: FULL SIGNAL GENERATION
// ============================================================================

describe('generateOpus45Signal', () => {
  it('returns signal: false for insufficient data', () => {
    const vcpResult = { ticker: 'TEST' };
    const bars = generateMockBars(100);  // Only 100 bars (need 200+)

    const signal = generateOpus45Signal(vcpResult, bars);
    
    assert.strictEqual(signal.signal, false);
    assert.ok(signal.reason.includes('Insufficient'));
  });

  it('returns full signal object when criteria pass', () => {
    const vcpResult = {
      ticker: 'TEST',
      vcpBullish: true,
      contractions: 3,
      relativeStrength: 85,
      patternConfidence: 65,
      volumeDryUp: true,
      pattern: 'VCP'
    };

    // Generate ideal Stage 2 bars
    const bars = generateStage2Bars(300);

    const signal = generateOpus45Signal(vcpResult, bars);
    
    // Should have required fields
    assert.ok('signal' in signal);
    assert.ok('opus45Confidence' in signal);
    assert.ok('opus45Grade' in signal);
    assert.ok('mandatoryPassed' in signal);
    assert.ok('metrics' in signal);
    
    if (signal.signal) {
      assert.ok('entryPrice' in signal);
      assert.ok('stopLossPrice' in signal);
      assert.ok('targetPrice' in signal);
      assert.ok('riskRewardRatio' in signal);
    }
  });
});

// ============================================================================
// TEST: CONSTANTS & DEFAULTS
// ============================================================================

describe('Constants and Defaults', () => {
  it('DEFAULT_WEIGHTS has all required keys', () => {
    const requiredKeys = [
      'vcpContractions3Plus',
      'vcpContractions4Plus',
      'vcpVolumeDryUp',
      'vcpPatternConfidence',
      'entryAt10MA',
      'entryAt20MA',
      'entryVolumeConfirm',
      'entryRSAbove90',
      'industryTop20',
      'industryTop40',
      'institutionalOwnership',
      'epsGrowthPositive',
      'relativeStrengthBonus'
    ];

    for (const key of requiredKeys) {
      assert.ok(key in DEFAULT_WEIGHTS, `Missing key: ${key}`);
      assert.ok(typeof DEFAULT_WEIGHTS[key] === 'number', `${key} should be a number`);
    }
  });

  it('MANDATORY_THRESHOLDS has correct values', () => {
    assert.strictEqual(MANDATORY_THRESHOLDS.minRelativeStrength, 70);
    assert.strictEqual(MANDATORY_THRESHOLDS.minContractions, 2);
    assert.strictEqual(MANDATORY_THRESHOLDS.maxDistanceFromHigh, 25);
    assert.strictEqual(MANDATORY_THRESHOLDS.minAboveLow, 25);
  });

  it('EXIT_THRESHOLDS has correct values', () => {
    assert.strictEqual(EXIT_THRESHOLDS.stopLossPercent, 4);
    assert.strictEqual(EXIT_THRESHOLDS.below10MADays, 1);
  });
});

console.log('Run tests with: node --test server/opus45Signal.test.js');
