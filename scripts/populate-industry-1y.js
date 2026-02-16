/**
 * Populates data/industry-yahoo-returns.json with Yahoo 1Y returns.
 * Run: node scripts/populate-industry-1y.js
 * Then refresh the Dashboard - Industry 1Y column should display.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchIndustry1YReturn } from '../server/industrials.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const FUNDAMENTALS_FILE = path.join(DATA_DIR, 'fundamentals.json');
const OUTPUT_FILE = path.join(DATA_DIR, 'industry-yahoo-returns.json');

function loadFundamentals() {
  if (!fs.existsSync(FUNDAMENTALS_FILE)) return {};
  return JSON.parse(fs.readFileSync(FUNDAMENTALS_FILE, 'utf8'));
}

async function main() {
  const fundamentals = loadFundamentals();
  const industries = [...new Set(Object.values(fundamentals).filter((e) => e?.industry).map((e) => e.industry))];

  if (industries.length === 0) {
    console.log('No industries in fundamentals. Run "Fetch fundamentals" first.');
    process.exit(1);
  }

  console.log(`Fetching 1Y for ${industries.length} industries...`);
  const yahooReturns = {};
  const DELAY_MS = 500;

  for (let i = 0; i < industries.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, DELAY_MS));
    const industry = industries[i];
    const sector = Object.values(fundamentals).find((e) => e?.industry === industry)?.sector ?? null;
    try {
      const return1Y = await fetchIndustry1YReturn(industry, sector);
      if (return1Y != null) {
        yahooReturns[industry] = { return1Y, fetchedAt: new Date().toISOString() };
      }
      if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${industries.length}`);
    } catch (e) {
      console.warn(`  Failed ${industry}:`, e.message);
    }
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(yahooReturns, null, 2), 'utf8');
  console.log(`Done. Saved ${Object.keys(yahooReturns).length} industry 1Y returns to ${OUTPUT_FILE}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
