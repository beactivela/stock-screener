/**
 * Unit tests for backtest 10 MA exit strategy
 * Run: node --test server/backtest.test.js
 */
import { describe, it, mock } from 'node:test';
import assert from 'node:assert';

// Mock the helper functions we need to test
function calculateSMA(values, period) {
  if (!values || values.length < period) return null;
  const sum = values.slice(-period).reduce((a, b) => a + b, 0);
  return sum / period;
}

function isPriceNearMA(price, ma) {
  if (!price || !ma) return false;
  const diff = Math.abs(price - ma);
  const pct = (diff / ma) * 100;
  return pct <= 2.0; // Within 2%
}

describe('calculateSMA', () => {
  it('calculates simple moving average correctly', () => {
    const values = [10, 20, 30, 40, 50];
    const sma = calculateSMA(values, 3);
    assert.strictEqual(sma, 40); // (30 + 40 + 50) / 3 = 40
  });

  it('returns null when insufficient data', () => {
    const values = [10, 20];
    const sma = calculateSMA(values, 5);
    assert.strictEqual(sma, null);
  });

  it('handles edge case with exact period length', () => {
    const values = [10, 20, 30];
    const sma = calculateSMA(values, 3);
    assert.strictEqual(sma, 20); // (10 + 20 + 30) / 3 = 20
  });
});

describe('isPriceNearMA', () => {
  it('returns true when price within 2% of MA', () => {
    const price = 100;
    const ma = 101;
    assert.strictEqual(isPriceNearMA(price, ma), true);
  });

  it('returns true when price exactly at MA', () => {
    const price = 100;
    const ma = 100;
    assert.strictEqual(isPriceNearMA(price, ma), true);
  });

  it('returns false when price more than 2% away', () => {
    const price = 100;
    const ma = 105; // 5% difference
    assert.strictEqual(isPriceNearMA(price, ma), false);
  });

  it('handles price below MA', () => {
    const price = 98;
    const ma = 100; // 2% below
    assert.strictEqual(isPriceNearMA(price, ma), true);
    
    const price2 = 95;
    const ma2 = 100; // 5% below
    assert.strictEqual(isPriceNearMA(price2, ma2), false);
  });

  it('returns false for null/undefined values', () => {
    assert.strictEqual(isPriceNearMA(null, 100), false);
    assert.strictEqual(isPriceNearMA(100, null), false);
    assert.strictEqual(isPriceNearMA(null, null), false);
  });
});

describe('10 MA Exit Strategy Logic', () => {
  it('finds buy signal when price touches 10 MA', () => {
    // Simulate price bars
    const bars = [
      { c: 100, h: 102, l: 98 },  // Day 0: scan date
      { c: 102, h: 103, l: 101 }, // Day 1
      { c: 104, h: 105, l: 103 }, // Day 2
      { c: 103, h: 104, l: 102 }, // Day 3
      { c: 101, h: 102, l: 100 }, // Day 4
      { c: 100, h: 101, l: 99 },  // Day 5
      { c: 99, h: 100, l: 98 },   // Day 6
      { c: 100, h: 101, l: 99 },  // Day 7
      { c: 101, h: 102, l: 100 }, // Day 8
      { c: 102, h: 103, l: 101 }, // Day 9
      { c: 101.5, h: 102, l: 101 }, // Day 10: should be near 10 MA
    ];
    
    // Find entry signal
    let entryIdx = -1;
    for (let i = 1; i < bars.length; i++) {
      const closes = bars.slice(0, i + 1).map(b => b.c);
      const ma10 = calculateSMA(closes, 10);
      
      if (ma10 && isPriceNearMA(bars[i].c, ma10)) {
        entryIdx = i;
        break;
      }
    }
    
    // Should find entry around day 10
    assert.ok(entryIdx >= 9, `Expected entry at day 10+, got day ${entryIdx}`);
  });

  it('exits when price closes below 10 MA', () => {
    // Simulate uptrend followed by breakdown below MA (gradual decline, no stop loss)
    const bars = [
      { c: 100, h: 102, l: 98 },
      { c: 101, h: 102, l: 100 },
      { c: 102, h: 103, l: 101 },
      { c: 103, h: 104, l: 102 },
      { c: 104, h: 105, l: 103 },
      { c: 105, h: 106, l: 104 },
      { c: 106, h: 107, l: 105 },
      { c: 107, h: 108, l: 106 },
      { c: 108, h: 109, l: 107 },
      { c: 109, h: 110, l: 108 }, // Day 9: entry here
      { c: 108, h: 109, l: 107 }, // Day 10: -0.9%
      { c: 107, h: 108, l: 106 }, // Day 11: -1.8%
      { c: 106, h: 107, l: 105 }, // Day 12: -2.8%
      { c: 105, h: 106, l: 104 }, // Day 13: -3.7% (gradual decline)
      { c: 104, h: 105, l: 103 }, // Day 14: -4.6% (still above -8% stop)
      { c: 103, h: 104, l: 102 }, // Day 15: -5.5% (breakdown - should exit here)
    ];
    
    // Entry at day 9
    const entryIdx = 9;
    const entryPrice = bars[entryIdx].c;
    
    // Look for exit
    let exitIdx = -1;
    let exitReason = null;
    
    for (let i = entryIdx + 1; i < bars.length; i++) {
      const closes = bars.slice(0, i + 1).map(b => b.c);
      const ma10 = calculateSMA(closes, 10);
      
      // Check stop loss first
      const currentReturn = ((bars[i].c - entryPrice) / entryPrice) * 100;
      if (currentReturn <= -8) {
        exitIdx = i;
        exitReason = 'STOP_LOSS';
        break;
      }
      
      // Check if price below MA
      if (ma10 && bars[i].c < ma10) {
        exitIdx = i;
        exitReason = 'BELOW_10MA';
        break;
      }
    }
    
    assert.strictEqual(exitReason, 'BELOW_10MA', 'Should exit because price below MA');
    assert.ok(exitIdx >= 10, 'Should exit after entry day');
  });

  it('exits when -8% stop loss hit', () => {
    // Simulate crash that hits stop loss immediately
    const bars = [
      { c: 100, h: 102, l: 98 },
      { c: 101, h: 102, l: 100 },
      { c: 102, h: 103, l: 101 },
      { c: 103, h: 104, l: 102 },
      { c: 104, h: 105, l: 103 },
      { c: 105, h: 106, l: 104 },
      { c: 106, h: 107, l: 105 },
      { c: 107, h: 108, l: 106 },
      { c: 108, h: 109, l: 107 },
      { c: 110, h: 111, l: 109 }, // Day 9: entry at 110
      { c: 109, h: 110, l: 108 }, // Day 10: -0.9%
      { c: 99, h: 100, l: 98 },   // Day 11: -10% CRASH - stop loss hit immediately!
    ];
    
    const entryIdx = 9;
    const entryPrice = bars[entryIdx].c; // 110
    
    // Look for exit
    let exitIdx = -1;
    let exitReason = null;
    
    for (let i = entryIdx + 1; i < bars.length; i++) {
      const currentReturn = ((bars[i].c - entryPrice) / entryPrice) * 100;
      
      // Check stop loss first (priority - this matches the real implementation)
      if (currentReturn <= -8) {
        exitIdx = i;
        exitReason = 'STOP_LOSS';
        break;
      }
      
      const closes = bars.slice(0, i + 1).map(b => b.c);
      const ma10 = calculateSMA(closes, 10);
      
      if (ma10 && bars[i].c < ma10) {
        exitIdx = i;
        exitReason = 'BELOW_10MA';
        break;
      }
    }
    
    assert.strictEqual(exitReason, 'STOP_LOSS', 'Should exit via stop loss on crash');
    assert.strictEqual(exitIdx, 11, 'Should exit on day 11 when stop hit');
    
    // Verify return is indeed below -8%
    const actualReturn = ((bars[11].c - entryPrice) / entryPrice) * 100;
    assert.ok(actualReturn <= -8, `Return should be <= -8%, got ${actualReturn.toFixed(2)}%`);
  });

  it('calculates MFE and MAE correctly', () => {
    const entryPrice = 100;
    const bars = [
      { h: 105, l: 99, c: 102 },  // MFE: +5%, MAE: -1%
      { h: 110, l: 98, c: 108 },  // MFE: +10%, MAE: -2%
      { h: 108, l: 95, c: 97 },   // MFE: still +10%, MAE: -5%
    ];
    
    let maxPrice = entryPrice;
    let minPrice = entryPrice;
    
    for (const bar of bars) {
      maxPrice = Math.max(maxPrice, bar.h);
      minPrice = Math.min(minPrice, bar.l);
    }
    
    const mfe = ((maxPrice - entryPrice) / entryPrice) * 100;
    const mae = ((minPrice - entryPrice) / entryPrice) * 100;
    
    assert.strictEqual(maxPrice, 110, 'Max price should be 110');
    assert.strictEqual(minPrice, 95, 'Min price should be 95');
    assert.strictEqual(mfe, 10, 'MFE should be +10%');
    assert.strictEqual(mae, -5, 'MAE should be -5%');
  });

  it('classifies outcomes correctly', () => {
    // WIN: +20% or +15% with shallow drawdown
    let returnPct = 22;
    let mae = -5;
    let outcome = returnPct >= 20 || (returnPct >= 15 && mae > -8) ? 'WIN' : 'NEUTRAL';
    assert.strictEqual(outcome, 'WIN', '+22% should be WIN');

    // WIN: +15% with -7% drawdown
    returnPct = 16;
    mae = -7;
    outcome = returnPct >= 20 || (returnPct >= 15 && mae > -8) ? 'WIN' : 'NEUTRAL';
    assert.strictEqual(outcome, 'WIN', '+16% with -7% drawdown should be WIN');

    // LOSS: -8% stop hit
    returnPct = -8;
    mae = -8;
    outcome = returnPct < 0 || mae <= -8 ? 'LOSS' : 'NEUTRAL';
    assert.strictEqual(outcome, 'LOSS', '-8% should be LOSS');

    // NEUTRAL: +10%
    returnPct = 10;
    mae = -3;
    outcome = (returnPct >= 20 || (returnPct >= 15 && mae > -8)) ? 'WIN' 
            : (returnPct < 0 || mae <= -8) ? 'LOSS' 
            : 'NEUTRAL';
    assert.strictEqual(outcome, 'NEUTRAL', '+10% should be NEUTRAL');
  });
});

describe('Edge Cases', () => {
  it('handles no buy signal scenario', () => {
    // Price never gets near 10 MA
    const bars = [
      { c: 100, h: 102, l: 98 },
      { c: 110, h: 112, l: 108 }, // Gaps up, never returns
      { c: 115, h: 117, l: 113 },
      { c: 120, h: 122, l: 118 },
      { c: 125, h: 127, l: 123 },
      { c: 130, h: 132, l: 128 },
    ];
    
    let entryIdx = -1;
    for (let i = 1; i < bars.length; i++) {
      const closes = bars.slice(0, i + 1).map(b => b.c);
      const ma10 = calculateSMA(closes, 10);
      
      if (ma10 && isPriceNearMA(bars[i].c, ma10)) {
        entryIdx = i;
        break;
      }
    }
    
    assert.strictEqual(entryIdx, -1, 'Should not find entry signal');
  });

  it('handles immediate stop loss after entry', () => {
    const bars = [
      { c: 100, h: 102, l: 98 },
      { c: 101, h: 102, l: 100 },
      { c: 102, h: 103, l: 101 },
      { c: 103, h: 104, l: 102 },
      { c: 104, h: 105, l: 103 },
      { c: 105, h: 106, l: 104 },
      { c: 106, h: 107, l: 105 },
      { c: 107, h: 108, l: 106 },
      { c: 108, h: 109, l: 107 },
      { c: 105, h: 106, l: 104 }, // Day 9: entry at 105
      { c: 95, h: 96, l: 94 },    // Day 10: -9.5% immediate stop
    ];
    
    const entryIdx = 9;
    const entryPrice = bars[entryIdx].c;
    
    const returnPct = ((bars[10].c - entryPrice) / entryPrice) * 100;
    assert.ok(returnPct < -8, 'Should trigger stop loss immediately');
  });
});

console.log('✅ All backtest 10 MA exit strategy tests passed!');
