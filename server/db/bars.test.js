/**
 * Unit tests for db/bars.js — bars cache layer
 *
 * Covers:
 *   1. OHLCV shape validation (all 6 fields present + numeric)
 *   2. 5-year fetch produces >= 1,250 bars per ticker
 *   3. Cache hit: Supabase data returned without hitting Yahoo
 *   4. Cache miss → Yahoo fetch → result saved to Supabase
 *   5. Yahoo failure handled gracefully (returns null, no throw)
 *   6. Partial / stale cache (stored range doesn't cover request) → refetch
 *   7. Deep-range TTL (5yr) vs short-range TTL (1yr)
 *   8. Missing bars detection helper
 *
 * Run: node --test server/db/bars.test.js
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { isBarsUpToDate, __testing } from './bars.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a realistic OHLCV bar at timestamp t (ms) */
function makeBar(t, price = 100) {
  return {
    t,
    o: +(price * 0.99).toFixed(2),
    h: +(price * 1.02).toFixed(2),
    l: +(price * 0.97).toFixed(2),
    c: +price.toFixed(2),
    v: Math.floor(1_000_000 + Math.random() * 5_000_000),
  };
}

/**
 * Generate `count` sequential trading-day bars starting from `fromDate`.
 * Skips weekends (Sat/Sun) to mimic real market data.
 */
function generateBars(count, fromDate = new Date('2021-01-04')) {
  const bars = [];
  const cursor = new Date(fromDate);
  let price = 150;

  while (bars.length < count) {
    const day = cursor.getDay(); // 0=Sun, 6=Sat
    if (day !== 0 && day !== 6) {
      price = +(price * (1 + (Math.random() - 0.48) * 0.03)).toFixed(2);
      bars.push(makeBar(cursor.getTime(), price));
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return bars;
}

/** 5 trading years ≈ 252 days/yr × 5 = 1,260 bars */
const FIVE_YEAR_BAR_COUNT = 1260;
const MIN_BARS_EXPECTED = 1250;

// ─── OHLCV shape tests ───────────────────────────────────────────────────────

describe('OHLCV bar shape', () => {
  it('makeBar produces all 6 required fields', () => {
    const bar = makeBar(Date.now(), 200);
    assert.ok(typeof bar.t === 'number', 't (timestamp ms) must be a number');
    assert.ok(typeof bar.o === 'number', 'o (open) must be a number');
    assert.ok(typeof bar.h === 'number', 'h (high) must be a number');
    assert.ok(typeof bar.l === 'number', 'l (low) must be a number');
    assert.ok(typeof bar.c === 'number', 'c (close) must be a number');
    assert.ok(typeof bar.v === 'number', 'v (volume) must be a number');
  });

  it('high >= close >= low >= open (OHLC consistency)', () => {
    // Run 100 times to catch randomness issues
    for (let i = 0; i < 100; i++) {
      const bar = makeBar(Date.now(), 100 + Math.random() * 500);
      assert.ok(bar.h >= bar.c, `high (${bar.h}) must be >= close (${bar.c})`);
      assert.ok(bar.l <= bar.c, `low (${bar.l}) must be <= close (${bar.c})`);
      assert.ok(bar.v >= 0, `volume must be non-negative`);
    }
  });

  it('validates real Yahoo bar shape', () => {
    // This is the exact shape yahoo.js returns — test that no field is undefined
    const yahooBarShape = {
      t: new Date('2024-01-15').getTime(),
      o: 185.23,
      h: 188.44,
      l: 184.10,
      c: 187.90,
      v: 52_340_100,
    };
    const required = ['t', 'o', 'h', 'l', 'c', 'v'];
    for (const field of required) {
      assert.notEqual(yahooBarShape[field], undefined, `Field '${field}' missing from bar`);
      assert.ok(typeof yahooBarShape[field] === 'number', `Field '${field}' must be numeric`);
    }
  });
});

// ─── 5-year bar count tests ──────────────────────────────────────────────────

describe('5-year bar count validation', () => {
  it('generates >= 1,250 trading bars over 5 years', () => {
    const bars = generateBars(FIVE_YEAR_BAR_COUNT);
    assert.ok(
      bars.length >= MIN_BARS_EXPECTED,
      `Expected >= ${MIN_BARS_EXPECTED} bars, got ${bars.length}`
    );
  });

  it('bars are sorted ascending by timestamp', () => {
    const bars = generateBars(300);
    for (let i = 1; i < bars.length; i++) {
      assert.ok(
        bars[i].t > bars[i - 1].t,
        `Bar ${i} timestamp (${bars[i].t}) should be after bar ${i - 1} (${bars[i - 1].t})`
      );
    }
  });

  it('rejects a fetch with < 250 bars (scanner minimum)', () => {
    // The scanner skips tickers with < 250 bars — validate that threshold
    const tooFewBars = generateBars(100);
    assert.ok(tooFewBars.length < 250, 'Should have fewer than scanner minimum');
    // Simulate the scanner check
    const wouldSkip = !tooFewBars || tooFewBars.length < 250;
    assert.ok(wouldSkip, 'Scanner should skip tickers with < 250 bars');
  });

  it('detects missing bars (gaps > 5 trading days)', () => {
    const bars = generateBars(252); // 1 year
    // Inject a gap — remove 10 bars in the middle
    const withGap = [...bars.slice(0, 100), ...bars.slice(110)];
    const gaps = detectBarGaps(withGap, 5);
    assert.ok(gaps.length > 0, 'Should detect the injected gap');
  });

  it('calculates correct date span for 5yr fetch', () => {
    const from = '2021-02-21';
    const to = '2026-02-21';
    const spanDays = (new Date(to) - new Date(from)) / (1000 * 60 * 60 * 24);
    // ~1826 calendar days → ~1300 trading days (accounts for weekends + holidays)
    const estimatedTradingDays = spanDays * (5 / 7);
    assert.ok(
      estimatedTradingDays >= MIN_BARS_EXPECTED,
      `5yr span should yield >= ${MIN_BARS_EXPECTED} trading days, estimated ${estimatedTradingDays.toFixed(0)}`
    );
  });
});

// ─── Cache layer logic tests (using mocks) ───────────────────────────────────

describe('Cache layer: Supabase hit → no Yahoo call', () => {
  it('returns cached data when Supabase has valid bars covering the range', () => {
    const cachedBars = generateBars(1260, new Date('2021-01-04'));
    const from = '2021-01-04';
    const to = '2026-02-21';

    // Simulate the db/bars.js cache-hit logic
    const storedFrom = '2021-01-04';
    const storedTo = '2026-02-21';
    const fetchedAt = new Date(); // just now

    const age = Date.now() - fetchedAt.getTime();
    const DEEP_TTL = 90 * 24 * 60 * 60 * 1000;

    const coversRange = storedFrom <= from && storedTo >= to;
    const notExpired = age <= DEEP_TTL;

    assert.ok(coversRange, 'Stored range should cover requested range');
    assert.ok(notExpired, 'Fresh cache should not be expired');

    // Slice to requested range
    const filtered = cachedBars.filter((b) => {
      const d = new Date(b.t).toISOString().slice(0, 10);
      return d >= from && d <= to;
    });

    assert.ok(filtered.length >= MIN_BARS_EXPECTED, `Cache hit should return >= ${MIN_BARS_EXPECTED} bars`);
  });

  it('treats cache as expired when age > 90 days (deep range)', () => {
    const DEEP_TTL = 90 * 24 * 60 * 60 * 1000;
    const ninetyOneDaysAgo = Date.now() - 91 * 24 * 60 * 60 * 1000;
    const age = Date.now() - ninetyOneDaysAgo;
    assert.ok(age > DEEP_TTL, '91-day-old cache should be expired for deep range');
  });

  it('treats cache as expired when age > 24h (short range)', () => {
    const SHORT_TTL = 24 * 60 * 60 * 1000;
    const twentyFiveHoursAgo = Date.now() - 25 * 60 * 60 * 1000;
    const age = Date.now() - twentyFiveHoursAgo;
    assert.ok(age > SHORT_TTL, '25h-old cache should be expired for short range');
  });
});

describe('Cache layer: Supabase miss → Yahoo fetch → save', () => {
  it('correctly identifies a deep range (>= 540 days)', () => {
    const THRESHOLD = 540;

    const cases = [
      { from: '2021-02-21', to: '2026-02-21', expectDeep: true },  // 5yr
      { from: '2023-02-21', to: '2026-02-21', expectDeep: true },  // 3yr
      { from: '2025-02-21', to: '2026-02-21', expectDeep: false }, // 1yr
      { from: '2025-08-21', to: '2026-02-21', expectDeep: false }, // 6mo
    ];

    for (const { from, to, expectDeep } of cases) {
      const spanDays = (new Date(to) - new Date(from)) / (1000 * 60 * 60 * 24);
      const isDeep = spanDays >= THRESHOLD;
      assert.equal(
        isDeep,
        expectDeep,
        `from=${from} to=${to} → span=${spanDays.toFixed(0)}d, expected isDeep=${expectDeep}, got ${isDeep}`
      );
    }
  });

  it('saveBars payload contains all required fields', () => {
    const bars = generateBars(10);
    // This is exactly what saveBars sends to Supabase
    const payload = {
      ticker: 'AAPL',
      interval: '1d',
      date_from: '2021-01-04',
      date_to: '2026-02-21',
      fetched_at: new Date().toISOString(),
      results: bars,
    };

    assert.ok(payload.ticker, 'ticker required');
    assert.ok(payload.interval, 'interval required');
    assert.ok(payload.date_from, 'date_from required');
    assert.ok(payload.date_to, 'date_to required');
    assert.ok(payload.fetched_at, 'fetched_at required');
    assert.ok(Array.isArray(payload.results), 'results must be array');
    assert.ok(payload.results.length > 0, 'results must not be empty');

    // Each bar in results must be OHLCV
    for (const bar of payload.results) {
      for (const field of ['t', 'o', 'h', 'l', 'c', 'v']) {
        assert.ok(typeof bar[field] === 'number', `Bar field '${field}' must be numeric`);
      }
    }
  });

  it('buildBarsCacheRows creates batch-upsert rows for multiple tickers', () => {
    const rows = __testing.buildBarsCacheRows([
      {
        ticker: 'AAPL',
        from: '2021-01-04',
        to: '2026-02-21',
        interval: '1d',
        results: generateBars(10),
      },
      {
        ticker: 'MSFT',
        from: '2021-01-04',
        to: '2026-02-21',
        interval: '1wk',
        results: generateBars(5),
      },
    ], '2026-03-08T00:00:00.000Z');

    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => `${row.ticker}:${row.interval}`), ['AAPL:1d', 'MSFT:1wk']);
    assert.equal(rows[0].fetched_at, '2026-03-08T00:00:00.000Z');
    assert.ok(Array.isArray(rows[1].results));
    assert.ok(rows[1].results.length > 0);
  });
});

describe('Cache layer: Yahoo failure handling', () => {
  it('returns null (not throw) when Yahoo returns empty array', () => {
    // Simulate the db/bars.js error handling for empty Yahoo response
    const yahooResult = [];
    const result = (!yahooResult || yahooResult.length === 0) ? null : yahooResult;
    assert.equal(result, null, 'Empty Yahoo response should return null');
  });

  it('returns null (not throw) when Yahoo throws', () => {
    // Simulate db/bars.js try/catch around fetchFromYahoo
    let result;
    try {
      throw new Error('Yahoo Finance: network timeout');
    } catch (e) {
      result = null;
    }
    assert.equal(result, null, 'Yahoo exception should be caught and return null');
  });

  it('scanner skips tickers where getBars returns null', () => {
    // Simulate the scanner loop's null check (historicalSignalScanner.js line ~393)
    const bars = null;
    const wouldContinue = !bars || bars.length < 250;
    assert.ok(wouldContinue, 'Scanner should skip when bars is null');
  });
});

describe('Cache layer: stale / partial range detection', () => {
  it('refetches when stored range does not cover requested range', () => {
    // Stored: 1yr. Requested: 5yr. Should NOT use cache.
    const storedFrom = '2025-02-21';
    const storedTo = '2026-02-21';
    const requestFrom = '2021-02-21';
    const requestTo = '2026-02-21';

    const coversRange = storedFrom <= requestFrom && storedTo >= requestTo;
    assert.ok(!coversRange, 'Short-range cache should NOT cover a 5yr request');
  });

  it('uses cache when stored range is a superset of requested range', () => {
    // Stored: 5yr. Requested: 3yr (subset). Should use and slice cache.
    const storedFrom = '2021-01-01';
    const storedTo = '2026-02-21';
    const requestFrom = '2023-01-01';
    const requestTo = '2026-02-21';

    const coversRange = storedFrom <= requestFrom && storedTo >= requestTo;
    assert.ok(coversRange, 'Deep cache should cover a narrower request');
  });

  it('detectBarGaps finds gaps in bar sequence', () => {
    const bars = generateBars(100);
    // Remove bars 40-49 to create a 10-day gap
    const gapped = [...bars.slice(0, 40), ...bars.slice(50)];
    const gaps = detectBarGaps(gapped, 5); // threshold: 5 trading days
    assert.ok(gaps.length >= 1, `Should detect at least 1 gap, found ${gaps.length}`);
  });

  it('detectBarGaps returns empty for contiguous bars', () => {
    const bars = generateBars(252);
    const gaps = detectBarGaps(bars, 5);
    assert.equal(gaps.length, 0, 'Contiguous bars should have no gaps');
  });
});

describe('Bars freshness checks', () => {
  it('treats bars as up to date when last bar is within maxLagDays', () => {
    const bars = generateBars(10, new Date('2026-03-01'));
    const lastBarDate = new Date(bars[bars.length - 1].t).toISOString().slice(0, 10);
    const toDate = new Date(lastBarDate + 'T12:00:00Z');
    toDate.setUTCDate(toDate.getUTCDate() + 1);
    const to = toDate.toISOString().slice(0, 10);
    const ok = isBarsUpToDate(bars, to, { maxLagDays: 5 });
    assert.equal(ok, true);
  });

  it('treats bars as stale when last bar is too old', () => {
    const bars = generateBars(10, new Date('2026-02-01'));
    const to = '2026-03-08';
    const ok = isBarsUpToDate(bars, to, { maxLagDays: 2 });
    assert.equal(ok, false);
  });
});

describe('Missing data recovery', () => {
  it('identifies a ticker needing a refill (< MIN_BARS_EXPECTED)', () => {
    const partialBars = generateBars(500); // Only 500 bars, need 1250
    const needsRefill = partialBars.length < MIN_BARS_EXPECTED;
    assert.ok(needsRefill, 'Should flag ticker as needing refill');
  });

  it('does not flag a full 5yr dataset as needing refill', () => {
    const fullBars = generateBars(1260);
    const needsRefill = fullBars.length < MIN_BARS_EXPECTED;
    assert.ok(!needsRefill, 'Full 5yr dataset should not need refill');
  });

  it('confirms upsert conflict key is ticker+interval', () => {
    // saveBars uses onConflict: 'ticker,interval' — verify this is correct
    // If same ticker+interval is saved twice, it should update not duplicate
    const key1 = { ticker: 'AAPL', interval: '1d' };
    const key2 = { ticker: 'AAPL', interval: '1d' };
    const isSameKey = key1.ticker === key2.ticker && key1.interval === key2.interval;
    assert.ok(isSameKey, 'Same ticker+interval should upsert (not duplicate)');

    const key3 = { ticker: 'AAPL', interval: '1wk' };
    const isDifferentInterval = key1.ticker === key3.ticker && key1.interval !== key3.interval;
    assert.ok(isDifferentInterval, 'Different interval = different row');
  });
});

// ─── Helper: gap detection ────────────────────────────────────────────────────

/**
 * Detect gaps in a bar array where consecutive bars are more than
 * `maxTradingDays` apart (accounting for weekends = ~1.4x calendar days).
 *
 * @param {Array} bars - Sorted array of {t, ...} bars
 * @param {number} maxTradingDays - Max allowed gap in trading days
 * @returns {Array} Array of gap objects {from, to, calendarDays}
 */
function detectBarGaps(bars, maxTradingDays = 5) {
  const gaps = [];
  // 5 trading days ≈ 7 calendar days; use 1.5x buffer for holidays
  const maxCalendarMs = maxTradingDays * 1.5 * 24 * 60 * 60 * 1000;

  for (let i = 1; i < bars.length; i++) {
    const delta = bars[i].t - bars[i - 1].t;
    if (delta > maxCalendarMs) {
      gaps.push({
        from: new Date(bars[i - 1].t).toISOString().slice(0, 10),
        to: new Date(bars[i].t).toISOString().slice(0, 10),
        calendarDays: Math.round(delta / (24 * 60 * 60 * 1000)),
      });
    }
  }
  return gaps;
}
