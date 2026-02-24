/**
 * Unit tests for Opus4.5 Signal Algorithm
 * Run: node --test server/opus45Signal.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { 
  checkMandatoryCriteria, 
  getMandatoryThresholds,
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
      },
      maSlope: { isRising: true, slopePct14d: 5, slopePct5d: 1 }
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

describe('Opus4.5 threshold overrides', () => {
  it('merges overrides into defaults', () => {
    const merged = getMandatoryThresholds({ minRelativeStrength: 60 });
    assert.strictEqual(merged.minRelativeStrength, 60);
  });

  it('respects threshold overrides in mandatory check', () => {
    const params = {
      bars: [],
      relativeStrength: 65,
      contractions: 2,
      patternConfidence: 50,
      maAlignment: { aligned: true, ma200Rising: true },
      stats52w: { pctFromHigh: 10, pctAboveLow: 30 },
      entryPoint: { at10MA: true, at20MA: false },
      maSlope: { isRising: true, isRising14d: true, isRising5d: true, slopePct14d: 2, slopePct5d: 0.5 },
      thresholdsOverride: { minRelativeStrength: 60 },
    };
    const result = checkMandatoryCriteria(params);
    assert.strictEqual(result.passed, true);
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
// TEST: NEW FACTORS — Industry Trend + Short-Term Price Action
// ============================================================================

describe('calculateConfidenceScore — industry trend factor', () => {
  it('adds points when industry 3-month return is strongly positive', () => {
    const base = {
      contractions: 3,
      volumeDryUp: true,
      patternConfidence: 60,
      entryPoint: { at10MA: true },
      volumeConfirmation: { confirmed: true },
      relativeStrength: 85,
      industryRank: 15,
    };

    const withTrend = { ...base, industryReturn3Mo: 15 };
    const withoutTrend = { ...base, industryReturn3Mo: -5 };

    const scoreTrend = calculateConfidenceScore(withTrend, DEFAULT_WEIGHTS);
    const scoreNoTrend = calculateConfidenceScore(withoutTrend, DEFAULT_WEIGHTS);

    assert.ok(
      scoreTrend.confidence > scoreNoTrend.confidence,
      `Industry trending up (${scoreTrend.confidence}) should score higher than down (${scoreNoTrend.confidence})`
    );
  });

  it('gives partial credit for moderate industry trend', () => {
    const base = {
      contractions: 3,
      volumeDryUp: true,
      patternConfidence: 60,
      entryPoint: { at10MA: true },
      volumeConfirmation: { confirmed: true },
      relativeStrength: 85,
    };

    const moderate = { ...base, industryReturn3Mo: 6 };
    const none = { ...base };

    const scoreMod = calculateConfidenceScore(moderate, DEFAULT_WEIGHTS);
    const scoreNone = calculateConfidenceScore(none, DEFAULT_WEIGHTS);

    assert.ok(scoreMod.confidence >= scoreNone.confidence);
  });
});

describe('calculateConfidenceScore — recent price action factor', () => {
  it('adds points for strong recent 5-day return', () => {
    const base = {
      contractions: 3,
      volumeDryUp: true,
      patternConfidence: 60,
      entryPoint: { at10MA: true },
      volumeConfirmation: { confirmed: true },
      relativeStrength: 85,
    };

    const strong = { ...base, recentReturn5d: 4 };
    const weak = { ...base, recentReturn5d: -3 };

    const scoreStrong = calculateConfidenceScore(strong, DEFAULT_WEIGHTS);
    const scoreWeak = calculateConfidenceScore(weak, DEFAULT_WEIGHTS);

    assert.ok(
      scoreStrong.confidence > scoreWeak.confidence,
      `Strong recent action (${scoreStrong.confidence}) should score higher than weak (${scoreWeak.confidence})`
    );
  });

  it('ignores the factor when not provided', () => {
    const base = {
      contractions: 3,
      volumeDryUp: true,
      patternConfidence: 60,
      entryPoint: { at10MA: true },
      volumeConfirmation: { confirmed: true },
      relativeStrength: 85,
    };

    const withAction = { ...base, recentReturn5d: 3 };
    const without = { ...base };

    const s1 = calculateConfidenceScore(withAction, DEFAULT_WEIGHTS);
    const s2 = calculateConfidenceScore(without, DEFAULT_WEIGHTS);

    assert.ok(s1.confidence >= s2.confidence);
  });
});

// ============================================================================
// TEST: EXIT SIGNALS
// ============================================================================

describe('checkExitSignal', () => {
  it('triggers stop loss when price drops 7%+', () => {
    const position = {
      ticker: 'TEST',
      entryPrice: 100,
      entryDate: Date.now() - 10 * 24 * 60 * 60 * 1000
    };

    // Generate bars ending at 92 (8% down from 100)
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
    // Last bar at 92 (8% below entry)
    bars[bars.length - 1].c = 92;

    const result = checkExitSignal(position, bars);
    assert.strictEqual(result.exitSignal, true);
    assert.strictEqual(result.exitType, 'STOP_LOSS');
  });

  it('triggers exit when 3 consecutive closes below 10 MA', () => {
    const position = {
      ticker: 'TEST',
      entryPrice: 100,
      highSinceEntry: 105
    };

    // Build bars: 15 bars at 105 (establishes 10 MA ~105), then 5 declining bars
    // Need at least 3 of the last bars below the 10 MA for the 3-day rule
    const bars = [];
    for (let i = 0; i < 15; i++) {
      bars.push({
        t: Date.now() - (20 - i) * 24 * 60 * 60 * 1000,
        o: 105, h: 105.5, l: 104.5, c: 105, v: 100000
      });
    }
    // 5 declining bars all below 10 MA (~105 → the last 3 will satisfy the 3-day rule)
    for (let i = 0; i < 5; i++) {
      const price = 105 - (i + 1) * 0.8;  // 104.2, 103.4, 102.6, 101.8, 101
      bars.push({
        t: Date.now() - (5 - i) * 24 * 60 * 60 * 1000,
        o: price + 0.5, h: price + 0.8, l: price - 0.2, c: price, v: 100000
      });
    }

    // Entry price 100, last close 101 → within 7% stop (no stop loss)
    // 10 MA drifts down but still ~103-104, and last 3 closes are below it
    const result = checkExitSignal(position, bars);
    assert.strictEqual(result.exitSignal, true);
    assert.strictEqual(result.exitType, 'BELOW_10MA_3DAY');
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

  it('allows seed mode when strict mandatory criteria fail', () => {
    const bars = generateStage2Bars(252);
    const vcpResult = {
      ticker: 'SEED',
      relativeStrength: 80,
      contractions: 0,
      patternConfidence: 10,
      volumeDryUp: false,
      pattern: 'VCP',
    };

    const strictSignal = generateOpus45Signal(vcpResult, bars, null, null, DEFAULT_WEIGHTS, null, false);
    assert.strictEqual(strictSignal.signal, false);

    const seedSignal = generateOpus45Signal(vcpResult, bars, null, null, DEFAULT_WEIGHTS, null, true);
    assert.strictEqual(seedSignal.signal, true);
    assert.strictEqual(seedSignal.seedMode, true);
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
      'relativeStrengthBonus',
      'pctFromHighIdeal',
      'pctFromHighGood'
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
    assert.strictEqual(EXIT_THRESHOLDS.stopLossPercent, 7);
    assert.strictEqual(EXIT_THRESHOLDS.below10MADays, 3);  // 3 consecutive closes below 10 MA
  });
});

console.log('Run tests with: node --test server/opus45Signal.test.js');
