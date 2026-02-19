#!/usr/bin/env node
/**
 * Remove migrated JSON files after confirming DB migration.
 * Only runs deletions when --confirm is passed.
 *
 * BEFORE running:
 *   1. Run npm run import:supabase to migrate data
 *   2. Run npm run verify:supabase to confirm data integrity
 *   3. Keep a backup of data/ or git commit
 *
 * Usage:
 *   node scripts/remove-json-after-migration.js        # Dry run (list files only)
 *   node scripts/remove-json-after-migration.js --confirm   # Actually delete
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');

const FILES_TO_REMOVE = [
  'tickers.txt',
  'fundamentals.json',
  'scan-results.json',
  'opus45-signals.json',
  'trades.json',
  'industrials.json',
  'all-industries.json',
  'sectors.json',
  'industry-yahoo-returns.json',
];

const DIRS_TO_CLEAN = [
  { dir: 'bars', glob: '*.json' },
  { dir: 'backtests', glob: '*.json' },
  { dir: 'regime', glob: '*.json' },
  { dir: 'opus45-learning', files: ['optimized-weights.json'] },
  { dir: 'adaptive-strategy', files: ['learned-params.json'] },
];

// Skipped per plan: data/industries/, data/deepseek/, data/adaptive-strategy/backtest-360d-full.json

function main() {
  const confirm = process.argv.includes('--confirm');
  if (!confirm) {
    console.log('DRY RUN: No --confirm flag. Showing files that would be removed.');
    console.log('Run with --confirm to actually delete.\n');
  }

  let removed = 0;
  let skipped = 0;

  // Single files in data/
  for (const file of FILES_TO_REMOVE) {
    const p = path.join(DATA_DIR, file);
    if (fs.existsSync(p)) {
      if (confirm) {
        fs.unlinkSync(p);
        console.log('Removed:', p);
        removed++;
      } else {
        console.log('Would remove:', p);
      }
    } else {
      skipped++;
    }
  }

  // Directories with patterns
  for (const { dir, glob, files } of DIRS_TO_CLEAN) {
    const dirPath = path.join(DATA_DIR, dir);
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) continue;

    const toDelete = files
      ? files.map((f) => path.join(dirPath, f))
      : fs.readdirSync(dirPath)
          .filter((f) => f.endsWith('.json'))
          .map((f) => path.join(dirPath, f));

    for (const p of toDelete) {
      if (fs.existsSync(p)) {
        if (confirm) {
          fs.unlinkSync(p);
          console.log('Removed:', p);
          removed++;
        } else {
          console.log('Would remove:', p);
        }
      }
    }
  }

  if (confirm) {
    console.log(`\nDone. Removed ${removed} file(s).`);
  } else {
    console.log('\nDry run complete. Run with --confirm to delete.');
  }
}

main();
