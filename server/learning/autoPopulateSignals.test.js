/**
 * Unit tests for local signal storage fallback
 * Run: node --test server/learning/autoPopulateSignals.test.js
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { storeSignalsToFile, loadStoredSignalsFromFile } from './autoPopulate.js';

const sampleSignals = [
  { ticker: 'AAA', entryDate: '2025-01-01', returnPct: 5, signalFamily: 'opus45' },
  { ticker: 'BBB', entryDate: '2025-01-02', returnPct: -2, signalFamily: 'turtle' },
];

describe('autoPopulate local signal storage', () => {
  let tempDir = null;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-screener-signals-'));
  });

  it('stores and loads signals from file', () => {
    const stored = storeSignalsToFile(sampleSignals, { dataDir: tempDir });
    assert.strictEqual(stored.stored, true);

    const loaded = loadStoredSignalsFromFile(10, { dataDir: tempDir });
    assert.strictEqual(loaded.length, 2);
    assert.strictEqual(loaded[0].ticker, 'AAA');
    assert.strictEqual(loaded[1].signalFamily, 'turtle');
  });

  it('respects limit when loading', () => {
    storeSignalsToFile(sampleSignals, { dataDir: tempDir });
    const loaded = loadStoredSignalsFromFile(1, { dataDir: tempDir });
    assert.strictEqual(loaded.length, 1);
  });
});

console.log('Run tests with: node --test server/learning/autoPopulateSignals.test.js');
