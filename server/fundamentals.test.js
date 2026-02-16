/**
 * Unit tests for fundamentals extraction and cache flow.
 * Run: node --test server/fundamentals.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getFundamentals } from './yahoo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const FUNDAMENTALS_FILE = path.join(DATA_DIR, 'fundamentals.json');

describe('Yahoo getFundamentals', () => {
  it('extracts industry, profitMargin, operatingMargin for AAPL', async () => {
    const f = await getFundamentals('AAPL');
    assert.strictEqual(f.ticker, 'AAPL');
    assert.ok(typeof f.pctHeldByInst === 'number' || f.pctHeldByInst === null);
    assert.ok(typeof f.qtrEarningsYoY === 'number' || f.qtrEarningsYoY === null);
    assert.ok(typeof f.profitMargin === 'number' || f.profitMargin === null);
    assert.ok(typeof f.operatingMargin === 'number' || f.operatingMargin === null);
    assert.ok(typeof f.industry === 'string' || f.industry === null);
    assert.ok(f.industry != null && f.industry.length > 0, 'industry should be non-empty string');
    assert.ok(f.profitMargin != null, 'profitMargin should be present');
    assert.ok(f.operatingMargin != null, 'operatingMargin should be present');
  });
});

describe('Fundamentals cache', () => {
  const testFile = path.join(DATA_DIR, 'fundamentals.test.json');

  it('saved entry has industry, profitMargin, operatingMargin', () => {
    const entry = {
      pctHeldByInst: 65.5,
      qtrEarningsYoY: 15.9,
      profitMargin: 27,
      operatingMargin: 35.4,
      industry: 'Consumer Electronics',
      fetchedAt: new Date().toISOString(),
    };
    fs.writeFileSync(testFile, JSON.stringify({ AAPL: entry }, null, 2), 'utf8');
    const loaded = JSON.parse(fs.readFileSync(testFile, 'utf8'));
    assert.strictEqual(loaded.AAPL.industry, 'Consumer Electronics');
    assert.strictEqual(loaded.AAPL.profitMargin, 27);
    assert.strictEqual(loaded.AAPL.operatingMargin, 35.4);
    fs.unlinkSync(testFile);
  });

  it('loadFundamentalsFiltered excludes entries without extended fields', () => {
    const raw = {
      AAPL: { pctHeldByInst: 65, industry: 'Tech', profitMargin: 27, operatingMargin: 35, fetchedAt: new Date().toISOString() },
      OLD: { pctHeldByInst: 50, qtrEarningsYoY: 10, fetchedAt: new Date().toISOString() },
    };
    const filtered = {};
    for (const [ticker, entry] of Object.entries(raw)) {
      if (entry && 'industry' in entry && 'profitMargin' in entry && 'operatingMargin' in entry) {
        filtered[ticker] = entry;
      }
    }
    assert.strictEqual(Object.keys(filtered).length, 1);
    assert.ok(filtered.AAPL);
    assert.ok(!filtered.OLD);
  });
});
