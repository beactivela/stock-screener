import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  DEFAULT_MANAGER_KEY_TO_SLUG,
  mapHedgefollowRowsToWhalewisdomSlugs,
  normalizeManagerKey,
  normalizeManagerSlugOverrides,
  parseCsvLine,
  parseHedgefollowCsv,
} from './hedgefollowWhalewisdomMap.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('normalizeManagerKey lowercases and trims', () => {
  assert.equal(normalizeManagerKey('  Leopold  Aschenbrenner '), 'leopold aschenbrenner');
});

test('normalizeManagerSlugOverrides normalizes JSON keys', () => {
  const n = normalizeManagerSlugOverrides({ 'Leopold Aschenbrenner': 'situational-awareness-lp' });
  assert.equal(n['leopold aschenbrenner'], 'situational-awareness-lp');
});

test('parseCsvLine handles Hedgefollow-style quoted fields with commas', () => {
  const line =
    '"Berkshire Hathaway",2025-12-31,"Warren Buffett",warren-buffett,123,"AAPL,AXP,BAC"';
  const fields = parseCsvLine(line);
  assert.equal(fields[0], 'Berkshire Hathaway');
  assert.equal(fields[2], 'Warren Buffett');
  assert.equal(fields[5], 'AAPL,AXP,BAC');
});

test('parseHedgefollowCsv skips disclaimer and reads header + row', () => {
  const sample = `This sample file only contains one row
fund_name,reporting_date,manager_name,manager_photo
"Berkshire Hathaway",2025-12-31,"Warren Buffett",x
`;
  const { header, rows } = parseHedgefollowCsv(sample);
  assert.ok(header.includes('fund_name'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fields[rows[0].managerIdx], 'Warren Buffett');
});

test('mapHedgefollowRowsToWhalewisdomSlugs resolves Leopold Aschenbrenner from defaults', () => {
  const { rows } = parseHedgefollowCsv(`fund_name,reporting_date,manager_name
"Situational Awareness LP",2025-12-31,"Leopold Aschenbrenner"
`);
  const { slugs, unknown } = mapHedgefollowRowsToWhalewisdomSlugs(rows);
  assert.deepEqual(slugs, ['situational-awareness-lp']);
  assert.equal(unknown.length, 0);
});

test('mapHedgefollowRowsToWhalewisdomSlugs lists unknown managers without mapping', () => {
  const { rows } = parseHedgefollowCsv(`fund_name,reporting_date,manager_name
"Fund",2025-12-31,"Unknown Person"
`);
  const { slugs, unknown } = mapHedgefollowRowsToWhalewisdomSlugs(rows);
  assert.equal(slugs.length, 0);
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].managerName, 'Unknown Person');
});

test('DEFAULT_MANAGER_KEY_TO_SLUG matches WhaleWisdom default filer slug', async () => {
  const { DEFAULT_WHALEWISDOM_FILERS } = await import('../whalewisdom/filerSlugs.js');
  const slug = DEFAULT_WHALEWISDOM_FILERS.find((f) => f.slug === 'situational-awareness-lp');
  assert.ok(slug);
  assert.equal(
    DEFAULT_MANAGER_KEY_TO_SLUG[normalizeManagerKey(slug.managerName)],
    'situational-awareness-lp'
  );
});

test('example overrides JSON parses and normalizes keys', () => {
  const path = join(__dirname, 'hedgefollowWhalewisdomOverrides.example.json');
  const j = JSON.parse(readFileSync(path, 'utf8'));
  const norm = normalizeManagerSlugOverrides(j);
  assert.equal(norm['leopold aschenbrenner'], 'situational-awareness-lp');
});
