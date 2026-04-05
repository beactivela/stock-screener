/**
 * Offline helper: Hedgefollow CSV export → suggested WHALEWISDOM_FILER_SLUGS (comma-separated).
 * Does not call Hedgefollow; you export CSV from their site, then run this locally.
 *
 * Usage: node scripts/map-hedgefollow-csv-to-whalewisdom.js /path/to/export.csv
 *
 * Optional overrides (manager display name → WhaleWisdom /filer/ slug):
 * - env HEDGE_FOLLOW_WW_OVERRIDES_JSON=/absolute/or/relative/path.json
 * - or file data/hedgefollow-whalewisdom-overrides.json (data/ is gitignored)
 * Copy server/experts/hedgefollowWhalewisdomOverrides.example.json as a starting point.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import {
  mapHedgefollowRowsToWhalewisdomSlugs,
  normalizeManagerSlugOverrides,
  parseHedgefollowCsv,
} from '../server/experts/hedgefollowWhalewisdomMap.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

function loadOverridesFromDisk() {
  const envPath = process.env.HEDGE_FOLLOW_WW_OVERRIDES_JSON?.trim();
  const candidates = [
    envPath,
    path.join(__dirname, '..', 'data', 'hedgefollow-whalewisdom-overrides.json'),
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) {
        return normalizeManagerSlugOverrides(JSON.parse(fs.readFileSync(p, 'utf8')));
      }
    } catch (e) {
      console.error(`[hedgefollow:map] failed to read overrides ${p}:`, e?.message || e);
      process.exit(1);
    }
  }
  return {};
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: node scripts/map-hedgefollow-csv-to-whalewisdom.js <path-to-export.csv>');
    process.exit(1);
  }
  const resolved = path.resolve(csvPath);
  const text = fs.readFileSync(resolved, 'utf8');
  const { rows } = parseHedgefollowCsv(text);
  const overrides = loadOverridesFromDisk();
  const { slugs, unknown } = mapHedgefollowRowsToWhalewisdomSlugs(rows, overrides);
  console.log('# WHALEWISDOM_FILER_SLUGS=');
  console.log(slugs.join(','));
  if (unknown.length) {
    console.error('\n# Unmapped rows (add manager → slug in data/hedgefollow-whalewisdom-overrides.json):');
    for (const u of unknown) {
      console.error(`#   "${u.managerName}" — ${u.fundName}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
