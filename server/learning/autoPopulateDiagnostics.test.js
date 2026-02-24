/**
 * Unit tests for diagnostics summary formatting
 * Run: node --test server/learning/autoPopulateDiagnostics.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';

import { formatDiagnosticsSummary } from './autoPopulate.js';

describe('formatDiagnosticsSummary', () => {
  it('formats turtle diagnostics summary lines', () => {
    const diagnostics = {
      tickersScanned: 10,
      barsMissing: 2,
      barsTooShort: 3,
      turtle: {
        checks: 100,
        breakouts20: 12,
        breakouts55: 4,
        noBreakout: 84,
        signals: 16,
      },
    };
    const lines = formatDiagnosticsSummary(diagnostics);
    assert.ok(Array.isArray(lines));
    assert.ok(lines.join('\n').includes('Tickers scanned: 10'));
    assert.ok(lines.join('\n').includes('Turtle checks: 100'));
    assert.ok(lines.join('\n').includes('Breakouts 20d: 12'));
    assert.ok(lines.join('\n').includes('Breakouts 55d: 4'));
    assert.ok(lines.join('\n').includes('Turtle signals: 16'));
  });

  it('returns empty array when diagnostics missing', () => {
    const lines = formatDiagnosticsSummary(null);
    assert.deepStrictEqual(lines, []);
  });
});

console.log('Run tests with: node --test server/learning/autoPopulateDiagnostics.test.js');
