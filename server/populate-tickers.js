/**
 * Populate tickers from TradingView scanner (US stocks by market cap).
 * Run: node server/populate-tickers.js [limit]
 * Example: node server/populate-tickers.js 500  (default: 500)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { getTickerListFromScanner } from './tradingViewIndustry.js';
import { saveTickers } from './db/tickers.js';

const DATA_DIR = path.join(__dirname, '..', 'data');

const limit = parseInt(process.argv[2] || '500', 10);

async function populate() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  console.log(`Fetching up to ${limit} US stock tickers from TradingView scanner...`);
  const tickers = await getTickerListFromScanner(limit);

  await saveTickers(tickers);
  console.log(`Wrote ${tickers.length} tickers to DB`);
  return tickers;
}

populate().catch((e) => {
  console.error(e);
  process.exit(1);
});
