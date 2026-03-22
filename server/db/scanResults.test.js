import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createScanRun,
  saveScanResultsBatch,
  updateScanResultsBatch,
  updateIndustryRankBatch,
  loadScanResults,
  inferSupabaseScanRunLooksInProgress,
} from './scanResults.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCAN_RESULTS_PATH = path.join(__dirname, '..', '..', 'data', 'scan-results.json');

function readIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
}

describe('scan results batch persistence (file fallback)', () => {
  const prevEnv = { ...process.env };
  let priorFile = null;

  beforeEach(() => {
    process.env.SUPABASE_URL = '';
    process.env.SUPABASE_SERVICE_KEY = '';
    process.env.SUPABASE_ANON_KEY = '';
    priorFile = readIfExists(SCAN_RESULTS_PATH);
    if (priorFile != null) fs.unlinkSync(SCAN_RESULTS_PATH);
  });

  afterEach(() => {
    if (priorFile != null) {
      fs.writeFileSync(SCAN_RESULTS_PATH, priorFile);
    } else if (fs.existsSync(SCAN_RESULTS_PATH)) {
      fs.unlinkSync(SCAN_RESULTS_PATH);
    }
    process.env = { ...prevEnv };
  });

  it('saves batches and updates RS ratings', async () => {
    const scannedAt = new Date('2026-03-08T00:00:00.000Z').toISOString();
    const from = '2025-01-12';
    const to = '2026-03-08';

    const { scanRunId } = await createScanRun({
      scannedAt,
      from,
      to,
      totalTickers: 2,
      vcpBullishCount: 0,
    });

    assert.equal(scanRunId, null);

    await saveScanResultsBatch({
      scanRunId,
      results: [
        { ticker: 'AAA', relativeStrength: null, rsData: { rsRaw: 12.3 } },
        { ticker: 'BBB', relativeStrength: null, rsData: { rsRaw: 45.6 } },
      ],
    });

    const afterBatch = await loadScanResults();
    assert.equal(afterBatch.results.length, 2);
    assert.equal(afterBatch.results.find((r) => r.ticker === 'AAA')?.relativeStrength, null);
    assert.equal(afterBatch.results.find((r) => r.ticker === 'AAA')?.rsData?.rsRaw, 12.3);

    await updateScanResultsBatch({
      scanRunId,
      results: [
        { ticker: 'AAA', relativeStrength: 77, rsData: { rsRaw: 12.3, rsRating: 77 } },
        { ticker: 'BBB', relativeStrength: 22, rsData: { rsRaw: 45.6, rsRating: 22 } },
      ],
    });

    const afterUpdate = await loadScanResults();
    const aaa = afterUpdate.results.find((r) => r.ticker === 'AAA');
    const bbb = afterUpdate.results.find((r) => r.ticker === 'BBB');

    assert.equal(aaa?.relativeStrength, 77);
    assert.equal(aaa?.rsData?.rsRating, 77);
    assert.equal(bbb?.relativeStrength, 22);
    assert.equal(bbb?.rsData?.rsRating, 22);
  });

  it('preserves enriched industry + signal fields on final update pass', async () => {
    const scannedAt = new Date('2026-03-08T00:00:00.000Z').toISOString();
    const from = '2025-01-12';
    const to = '2026-03-08';

    const { scanRunId } = await createScanRun({
      scannedAt,
      from,
      to,
      totalTickers: 2,
      vcpBullishCount: 1,
    });

    assert.equal(scanRunId, null);

    // Simulate streamed raw rows saved during scan progress.
    await saveScanResultsBatch({
      scanRunId,
      results: [
        { ticker: 'AAA', vcpBullish: true, relativeStrength: null, industryRank: null, signalSetupsRecent: [] },
        { ticker: 'BBB', vcpBullish: false, relativeStrength: null, industryRank: null, signalSetupsRecent: [] },
      ],
    });

    // Simulate final enriched pass after RS/industry/signal classification is computed.
    await updateScanResultsBatch({
      scanRunId,
      results: [
        {
          ticker: 'AAA',
          vcpBullish: true,
          relativeStrength: 94,
          rsData: { rsRaw: 51.2, rsRating: 94 },
          industryName: 'Software',
          industryRank: 5,
          enhancedScore: 86,
          signalSetups: ['momentum_scout'],
          signalSetupsRecent: ['momentum_scout'],
          signalSetupsRecent5: ['momentum_scout'],
        },
        {
          ticker: 'BBB',
          vcpBullish: false,
          relativeStrength: 61,
          rsData: { rsRaw: 18.6, rsRating: 61 },
          industryName: 'Hardware',
          industryRank: 18,
          enhancedScore: 63,
          signalSetups: ['base_hunter'],
          signalSetupsRecent: ['base_hunter'],
          signalSetupsRecent5: ['base_hunter'],
        },
      ],
    });

    const payload = await loadScanResults();
    const aaa = payload.results.find((r) => r.ticker === 'AAA');
    const bbb = payload.results.find((r) => r.ticker === 'BBB');

    assert.equal(aaa?.industryName, 'Software');
    assert.equal(aaa?.industryRank, 5);
    assert.equal(aaa?.relativeStrength, 94);
    assert.deepEqual(aaa?.signalSetupsRecent, ['momentum_scout']);

    assert.equal(bbb?.industryName, 'Hardware');
    assert.equal(bbb?.industryRank, 18);
    assert.equal(bbb?.relativeStrength, 61);
    assert.deepEqual(bbb?.signalSetupsRecent, ['base_hunter']);
  });

  it('updates industry rank batches', async () => {
    const scannedAt = new Date('2026-03-08T00:00:00.000Z').toISOString();
    const from = '2025-01-12';
    const to = '2026-03-08';

    const { scanRunId } = await createScanRun({
      scannedAt,
      from,
      to,
      totalTickers: 2,
      vcpBullishCount: 0,
    });

    assert.equal(scanRunId, null);

    await saveScanResultsBatch({
      scanRunId,
      results: [
        { ticker: 'AAA', industryName: 'Software', industryRank: null },
        { ticker: 'BBB', industryName: 'Hardware', industryRank: null },
      ],
    });

    await updateIndustryRankBatch({
      scanRunId,
      results: [
        { ticker: 'AAA', industryName: 'Software', industryRank: 3 },
        { ticker: 'BBB', industryName: 'Hardware', industryRank: 12 },
      ],
    });

    const afterUpdate = await loadScanResults();
    const aaa = afterUpdate.results.find((r) => r.ticker === 'AAA');
    const bbb = afterUpdate.results.find((r) => r.ticker === 'BBB');

    assert.equal(aaa?.industryRank, 3);
    assert.equal(aaa?.industryName, 'Software');
    assert.equal(bbb?.industryRank, 12);
    assert.equal(bbb?.industryName, 'Hardware');
  });

  it('supports final-only persistence without a second update pass', async () => {
    const scannedAt = new Date('2026-03-08T00:00:00.000Z').toISOString();
    const from = '2025-01-12';
    const to = '2026-03-08';

    const { scanRunId } = await createScanRun({
      scannedAt,
      from,
      to,
      totalTickers: 2,
      vcpBullishCount: 1,
    });

    assert.equal(scanRunId, null);

    await saveScanResultsBatch({
      scanRunId,
      meta: {
        scannedAt,
        from,
        to,
        totalTickers: 2,
        vcpBullishCount: 1,
      },
      results: [
        {
          ticker: 'AAA',
          relativeStrength: 99,
          enhancedScore: 94,
          industryName: 'Software',
          industryRank: 2,
          vcpBullish: true,
        },
        {
          ticker: 'BBB',
          relativeStrength: 70,
          enhancedScore: 61,
          industryName: 'Hardware',
          industryRank: 7,
          vcpBullish: false,
        },
      ],
    });

    const payload = await loadScanResults();
    assert.equal(payload.results.length, 2);
    assert.equal(payload.totalTickers, 2);
    assert.equal(payload.vcpBullishCount, 1);
    assert.equal(payload.results.find((r) => r.ticker === 'AAA')?.enhancedScore, 94);
    assert.equal(payload.results.find((r) => r.ticker === 'AAA')?.industryRank, 2);
  });
});

describe('inferSupabaseScanRunLooksInProgress', () => {
  const now = Date.parse('2026-03-21T12:00:00.000Z');
  const run = (createdOffsetMs, totalTickers, id = 'run-1') => ({
    id,
    created_at: new Date(now + createdOffsetMs).toISOString(),
    total_tickers: totalTickers,
  });

  it('is false when result count reached total_tickers', () => {
    assert.equal(inferSupabaseScanRunLooksInProgress(run(-60_000, 100), 100, now), false);
  });

  it('is true when partial rows and run is recent', () => {
    assert.equal(inferSupabaseScanRunLooksInProgress(run(-60_000, 500), 10, now), true);
  });

  it('is false when run is older than maxStaleMs', () => {
    assert.equal(
      inferSupabaseScanRunLooksInProgress(run(-3 * 3600_000, 500), 10, now, 2 * 3600_000),
      false,
    );
  });

  it('is false when total_tickers still 0 after warmup window', () => {
    assert.equal(inferSupabaseScanRunLooksInProgress(run(-6 * 60_000, 0), 0, now), false);
  });

  it('is true when total_tickers 0 but run just started', () => {
    assert.equal(inferSupabaseScanRunLooksInProgress(run(-30_000, 0), 0, now), true);
  });
});
