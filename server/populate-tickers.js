/**
 * Populate data/tickers.txt with S&P 500 tickers.
 * Tries SPY ETF constituents API first; if not authorized (403), fetches from GitHub CSV.
 * Run: node server/populate-tickers.js [limit]
 * Example: node server/populate-tickers.js 500  (default: 500)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { getEtfConstituents } from './massive.js';
import { saveTickers } from './db/tickers.js';

const DATA_DIR = path.join(__dirname, '..', 'data');

const SP500_CSV_URL = 'https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv';

const limit = parseInt(process.argv[2] || '500', 10);

/** Fetch S&P 500 from GitHub CSV (free, no API key) */
async function fetchFromCsv() {
  const res = await fetch(SP500_CSV_URL);
  if (!res.ok) throw new Error(`CSV fetch failed: ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split('\n').slice(1); // skip header
  return lines.map((line) => line.split(',')[0].trim()).filter(Boolean);
}

async function populate() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  let tickers;
  try {
    console.log('Fetching S&P 500 constituents from SPY...');
    const constituents = await getEtfConstituents('SPY');
    tickers = constituents
      .map((r) => r.constituent_ticker)
      .filter(Boolean)
      .slice(0, limit);
  } catch (e) {
    if (e.message?.includes('403') || e.message?.includes('NOT_AUTHORIZED')) {
      console.warn('ETF API not available. Fetching S&P 500 from GitHub CSV...');
      tickers = (await fetchFromCsv()).slice(0, limit);
    } else {
      throw e;
    }
  }

  await saveTickers(tickers);
  console.log(`Wrote ${tickers.length} tickers to DB`);
  return tickers;
}

populate().catch((e) => {
  console.error(e);
  process.exit(1);
});
