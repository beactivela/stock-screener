#!/usr/bin/env node
/**
 * Verifies fundamentals fetch, cache, and display flow.
 * Run: node scripts/verify-fundamentals.js
 * Requires server to be running on port 3001, or set BASE_URL.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const DATA_DIR = path.join(process.cwd(), 'data');
const FUNDAMENTALS_FILE = path.join(DATA_DIR, 'fundamentals.json');

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function main() {
  console.log('Verifying fundamentals flow...\n');

  // 1. Check current cache state
  let cacheBefore = {};
  try {
    cacheBefore = await fetchJson(`${BASE_URL}/api/fundamentals`);
    console.log(`1. GET /api/fundamentals: ${Object.keys(cacheBefore).length} tickers in cache`);
    const sample = Object.values(cacheBefore)[0];
    if (sample) {
      const hasExtended = sample.industry != null && sample.profitMargin != null && sample.operatingMargin != null;
      console.log(`   Sample entry has industry/profitMargin/operatingMargin: ${hasExtended}`);
      if (sample.industry) console.log(`   Sample industry: "${sample.industry}"`);
    }
  } catch (e) {
    console.log('1. GET /api/fundamentals failed:', e.message);
    console.log('   Is the server running? Try: npm run server');
    process.exit(1);
  }

  // 2. Fetch one ticker with force
  console.log('\n2. POST /api/fundamentals/fetch (tickers: [AAPL], force: true)...');
  try {
    const res = await fetch(`${BASE_URL}/api/fundamentals/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers: ['AAPL'], force: true }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${res.status}: ${body}`);
    }
    const text = await res.text();
    const lines = text.split('\n\n').filter((l) => l.startsWith('data: '));
    const msgs = lines.map((l) => {
      try {
        return JSON.parse(l.slice(6).trim());
      } catch {
        return null;
      }
    });
    const tickerMsg = msgs.find((m) => m && m.ticker === 'AAPL' && !m.done);
    if (tickerMsg) {
      console.log(`   Received AAPL: industry="${tickerMsg.industry}", profitMargin=${tickerMsg.profitMargin}, operatingMargin=${tickerMsg.operatingMargin}`);
      if (!tickerMsg.industry && tickerMsg.profitMargin == null) {
        console.log('   WARNING: Extended fields missing in stream response');
      }
    }
  } catch (e) {
    console.log('   Fetch failed:', e.message);
    if (e.message.includes('429')) console.log('   Wait 5 seconds and retry (rate limit)');
  }

  // 3. Wait for save, then check cache
  await new Promise((r) => setTimeout(r, 500));
  console.log('\n3. GET /api/fundamentals after fetch...');
  const cacheAfter = await fetchJson(`${BASE_URL}/api/fundamentals`);
  const aapl = cacheAfter.AAPL;
  if (aapl) {
    console.log(`   AAPL in cache: industry="${aapl.industry}", profitMargin=${aapl.profitMargin}, operatingMargin=${aapl.operatingMargin}`);
    const ok = aapl.industry != null && (aapl.profitMargin != null || aapl.operatingMargin != null);
    console.log(`   Extended fields present: ${ok ? 'YES' : 'NO'}`);
    if (!ok) {
      console.log('   FAIL: Cache not updated with extended fields');
      process.exit(1);
    }
  } else {
    console.log('   AAPL not in cache');
  }

  // 4. Check file on disk
  if (fs.existsSync(FUNDAMENTALS_FILE)) {
    const fileData = JSON.parse(fs.readFileSync(FUNDAMENTALS_FILE, 'utf8'));
    const fileAapl = fileData.AAPL;
    if (fileAapl) {
      console.log('\n4. File data/fundamentals.json:');
      console.log(`   AAPL.industry: ${JSON.stringify(fileAapl.industry)}`);
      console.log(`   AAPL.profitMargin: ${JSON.stringify(fileAapl.profitMargin)}`);
      console.log(`   AAPL.operatingMargin: ${JSON.stringify(fileAapl.operatingMargin)}`);
    }
  }

  console.log('\n✓ Fundamentals flow verified');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
