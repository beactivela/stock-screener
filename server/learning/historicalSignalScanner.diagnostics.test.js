/**
 * Unit tests for turtle diagnostics
 * Run: node --test server/learning/historicalSignalScanner.diagnostics.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';

import { scanTickerForSignals, createScanDiagnostics } from './historicalSignalScanner.js';

function buildBars(count = 260, start = 100, step = 0.5) {
  const bars = [];
  const startTime = Date.now() - count * 24 * 60 * 60 * 1000;
  let price = start;
  for (let i = 0; i < count; i++) {
    price += step;
    const open = price * 0.995;
    const close = price;
    const high = price * 1.01;
    const low = price * 0.99;
    bars.push({
      t: startTime + i * 24 * 60 * 60 * 1000,
      o: open,
      h: high,
      l: low,
      c: close,
      v: 1000000,
    });
  }
  return bars;
}

describe('turtle diagnostics', () => {
  it('counts turtle breakouts and signals', () => {
    const bars = buildBars(260);
    const spyBars = buildBars(260, 300, 0.2);
    const diagnostics = createScanDiagnostics();
    const signals = scanTickerForSignals('TURT', bars, spyBars, {
      signalFamilies: ['turtle'],
      diagnostics,
    });

    assert.ok(diagnostics.turtle.checks > 0);
    assert.ok(diagnostics.turtle.breakouts20 > 0 || diagnostics.turtle.breakouts55 > 0);
    assert.ok(diagnostics.turtle.signals > 0);
    assert.ok(signals.length > 0);
  });
});

console.log('Run tests with: node --test server/learning/historicalSignalScanner.diagnostics.test.js');
