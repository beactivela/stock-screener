/**
 * Verify table data (Close, 50 MA) against live bar data (Yahoo).
 * Uses same Yahoo + VCP logic as the app. Run: node scripts/verify-table-vs-yahoo.js
 *
 * Compares:
 * - lastClose (table "Close") vs live latest close in the same date range
 * - sma50 (table "50 MA" value) vs our 50-day SMA from bars
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const serverDir = path.join(__dirname, '..', 'server');
let getDailyBars, checkVCP;

const DATA_DIR = path.join(__dirname, '..', 'data');
const SCAN_FILE = path.join(DATA_DIR, 'scan-results.json');

async function run() {
  const yahoo = await import(path.join(serverDir, 'yahoo.js'));
  const vcp = await import(path.join(serverDir, 'vcp.js'));
  getDailyBars = yahoo.getDailyBars;
  checkVCP = vcp.checkVCP;
  main();
}

function main() {
  if (!fs.existsSync(SCAN_FILE)) {
    console.error('No scan-results.json. Run a scan first (Run scan now in UI or npm run scan).');
    process.exit(1);
  }

  const scan = JSON.parse(fs.readFileSync(SCAN_FILE, 'utf8'));
  const from = scan.from || '2025-08-19';
  const to = scan.to || new Date().toISOString().slice(0, 10);
  const results = scan.results || [];

  // Sample: first 5 tickers that have lastClose
  const toVerify = results.filter((r) => r.lastClose != null).slice(0, 5).map((r) => r.ticker);
  if (toVerify.length === 0) {
    console.error('No tickers with lastClose in scan-results.');
    process.exit(1);
  }

  console.log('Verifying table data vs live bars (Yahoo, same date range as scan)\n');
  console.log(`Scan range: ${from} → ${to}\n`);
  console.log('Ticker | Table Close | Live lastClose | Table 50 MA | Live sma50 | Match');
  console.log('-'.repeat(85));

  (async () => {
    for (const ticker of toVerify) {
      const row = results.find((r) => r.ticker === ticker);
      const tableClose = row?.lastClose;
      const tableSma50 = row?.sma50;
      try {
        const bars = await getDailyBars(ticker, from, to);
        const vcpResult = checkVCP(bars);
        const liveClose = vcpResult.lastClose;
        const liveSma50 = vcpResult.sma50;
        const closeMatch = tableClose != null && liveClose != null && Math.abs(tableClose - liveClose) < 0.02;
        const smaMatch = tableSma50 != null && liveSma50 != null && Math.abs(tableSma50 - liveSma50) < 0.02;
        const status = closeMatch && smaMatch ? 'OK' : closeMatch ? '50 MA diff' : 'MISMATCH';
        console.log(
          `${ticker.padEnd(6)} | ${(tableClose ?? '').toString().padEnd(11)} | ${(liveClose ?? '').toString().padEnd(15)} | ${(tableSma50 ?? '').toString().padEnd(11)} | ${(liveSma50 ?? '').toString().padEnd(10)} | ${status}`
        );
      } catch (err) {
        console.log(`${ticker.padEnd(6)} | ${(tableClose ?? '').toString().padEnd(11)} | ERROR: ${err.message}`);
      }
    }
    console.log('\nSpot-check: Table Close should match last close in scan date range (if scan end date = last trading day).');
  })();
}

run();
