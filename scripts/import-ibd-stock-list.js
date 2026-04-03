#!/usr/bin/env node
/**
 * Import IBD "My Stock List" .txt export into fundamentals.ibd_* columns.
 * Run the SQL migration first: docs/supabase/migration-ibd-ratings.sql
 *
 * Usage:
 *   node scripts/import-ibd-stock-list.js /path/to/My\ Stock\ List.txt
 *   npm run import:ibd -- "/path/to/list.txt"
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseIbdStockListExport } from '../server/ibdStockList.js';
import { loadFundamentals, saveFundamentals } from '../server/db/fundamentals.js';
import { isSupabaseConfigured } from '../server/supabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

async function main() {
  dotenv.config({ path: path.join(ROOT, '.env') });
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node scripts/import-ibd-stock-list.js <path-to-ibd-export.txt>');
    process.exit(1);
  }
  if (!isSupabaseConfigured()) {
    console.error('Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env');
    process.exit(1);
  }
  const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  if (!fs.existsSync(abs)) {
    console.error('File not found:', abs);
    process.exit(1);
  }
  const text = fs.readFileSync(abs, 'utf8');
  const rows = parseIbdStockListExport(text);
  if (!rows.length) {
    console.error('No data rows parsed. Check file format (IBD text export).');
    process.exit(1);
  }

  const importedAt = new Date().toISOString();
  const tickers = rows.map((r) => r.ticker);
  const existing = await loadFundamentals({ tickers });

  const merged = {};
  for (const r of rows) {
    merged[r.ticker] = {
      ...(existing[r.ticker] || {}),
      ibdCompositeRating: r.ibdCompositeRating,
      ibdEpsRating: r.ibdEpsRating,
      ibdRsRating: r.ibdRsRating,
      ibdSmrRating: r.ibdSmrRating,
      ibdAccDisRating: r.ibdAccDisRating,
      ibdGroupRelStrRating: r.ibdGroupRelStrRating,
      ibdImportedAt: importedAt,
    };
  }

  await saveFundamentals(merged);
  console.log(`Imported IBD ratings for ${rows.length} tickers from ${path.basename(abs)}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
