/**
 * Scan results data access: Supabase when configured, else data/scan-results.json
 * Shape: { scannedAt, from, to, totalTickers, vcpBullishCount, results }
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSupabase, isSupabaseConfigured } from '../supabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const SCAN_RESULTS_PATH = path.join(DATA_DIR, 'scan-results.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readScanResultsFile() {
  try {
    if (!fs.existsSync(SCAN_RESULTS_PATH)) {
      return { scannedAt: null, results: [], totalTickers: 0, vcpBullishCount: 0 };
    }
    const raw = fs.readFileSync(SCAN_RESULTS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { scannedAt: null, results: [], totalTickers: 0, vcpBullishCount: 0 };
    }
    const results = Array.isArray(parsed.results) ? parsed.results : [];
    const vcpBullishCount = results.filter((r) => r?.vcpBullish).length;
    return {
      scannedAt: parsed.scannedAt ?? null,
      from: parsed.from,
      to: parsed.to,
      totalTickers: results.length,
      vcpBullishCount,
      results,
    };
  } catch {
    return { scannedAt: null, results: [], totalTickers: 0, vcpBullishCount: 0 };
  }
}

function writeScanResultsFile(payload) {
  ensureDataDir();
  fs.writeFileSync(SCAN_RESULTS_PATH, JSON.stringify(payload, null, 2));
}

function mergeResultsByTicker(existing, incoming) {
  const map = new Map();
  for (const row of existing || []) {
    if (row?.ticker) map.set(row.ticker, row);
  }
  for (const row of incoming || []) {
    if (!row?.ticker) continue;
    const prev = map.get(row.ticker) || {};
    map.set(row.ticker, { ...prev, ...row });
  }
  return [...map.values()];
}

function buildFilePayload({ existing, incoming, meta }) {
  const mergedResults = mergeResultsByTicker(existing?.results, incoming);
  const vcpBullishCount = mergedResults.filter((r) => r?.vcpBullish).length;
  return {
    scannedAt: meta?.scannedAt ?? existing?.scannedAt ?? null,
    from: meta?.from ?? existing?.from,
    to: meta?.to ?? existing?.to,
    totalTickers: meta?.totalTickers ?? existing?.totalTickers ?? mergedResults.length,
    vcpBullishCount,
    results: mergedResults,
  };
}

function buildRunMetaUpdate(meta) {
  if (!meta) return null;
  const payload = {};
  if (meta.scannedAt != null) payload.scanned_at = meta.scannedAt;
  if (meta.from != null) payload.date_from = meta.from;
  if (meta.to != null) payload.date_to = meta.to;
  if (meta.totalTickers != null) payload.total_tickers = meta.totalTickers;
  if (meta.vcpBullishCount != null) payload.vcp_bullish_count = meta.vcpBullishCount;
  return Object.keys(payload).length > 0 ? payload : null;
}

/** @returns {Promise<{ scannedAt: string|null, from?: string, to?: string, totalTickers: number, vcpBullishCount: number, results: object[] }>} */
export async function loadScanResults() {
  if (!isSupabaseConfigured()) return readScanResultsFile();
  try {
    const supabase = getSupabase();
    const { data: run, error: runErr } = await supabase
      .from('scan_runs')
      .select('*')
      .order('scanned_at', { ascending: false })
      .limit(1)
      .single();
    if (runErr || !run) {
      return { scannedAt: null, results: [], totalTickers: 0, vcpBullishCount: 0 };
    }
    const { data: results, error: resErr } = await supabase
      .from('scan_results')
      .select('data')
      .eq('scan_run_id', run.id)
      .order('enhanced_score', { ascending: false, nullsFirst: false });
    if (resErr) throw new Error(resErr.message);
    const rows = (results || []).map((r) => r.data);
    const vcpBullishCount = rows.filter((r) => r?.vcpBullish).length;
    return {
      scannedAt: run.scanned_at,
      from: run.date_from,
      to: run.date_to,
      totalTickers: rows.length,
      vcpBullishCount,
      results: rows,
    };
  } catch (err) {
    console.warn('Load scan results failed; using file fallback.', err?.message || err);
    return readScanResultsFile();
  }
}

/**
 * Load latest scan results plus scanRunId (needed for targeted updates).
 * File fallback returns scanRunId = null.
 */
export async function loadLatestScanResultsWithRun() {
  if (!isSupabaseConfigured()) {
    const payload = readScanResultsFile();
    return { scanRunId: null, ...payload };
  }
  try {
    const supabase = getSupabase();
    const { data: run, error: runErr } = await supabase
      .from('scan_runs')
      .select('*')
      .order('scanned_at', { ascending: false })
      .limit(1)
      .single();
    if (runErr || !run) {
      return { scanRunId: null, scannedAt: null, results: [], totalTickers: 0, vcpBullishCount: 0 };
    }
    const { data: results, error: resErr } = await supabase
      .from('scan_results')
      .select('data')
      .eq('scan_run_id', run.id)
      .order('enhanced_score', { ascending: false, nullsFirst: false });
    if (resErr) throw new Error(resErr.message);
    const rows = (results || []).map((r) => r.data);
    const vcpBullishCount = rows.filter((r) => r?.vcpBullish).length;
    return {
      scanRunId: run.id,
      scannedAt: run.scanned_at,
      from: run.date_from,
      to: run.date_to,
      totalTickers: rows.length,
      vcpBullishCount,
      results: rows,
    };
  } catch (err) {
    console.warn('Load scan results with run failed; using file fallback.', err?.message || err);
    const payload = readScanResultsFile();
    return { scanRunId: null, ...payload };
  }
}

/**
 * Create a scan run row and return scanRunId.
 * File fallback writes an empty results payload and returns null.
 */
export async function createScanRun({ scannedAt, from, to, totalTickers, vcpBullishCount }) {
  if (!isSupabaseConfigured()) {
    writeScanResultsFile({
      scannedAt: scannedAt ?? null,
      from,
      to,
      totalTickers: totalTickers ?? 0,
      vcpBullishCount: vcpBullishCount ?? 0,
      results: [],
    });
    return { scanRunId: null };
  }
  const supabase = getSupabase();
  const { data: run, error: runErr } = await supabase
    .from('scan_runs')
    .insert({
      scanned_at: scannedAt ?? new Date().toISOString(),
      date_from: from ?? null,
      date_to: to ?? null,
      total_tickers: totalTickers ?? 0,
      vcp_bullish_count: vcpBullishCount ?? 0,
    })
    .select('id')
    .single();
  if (runErr) throw new Error(runErr.message);
  return { scanRunId: run.id };
}

/**
 * Save a batch of scan results during a scan.
 * Supabase: inserts into scan_results and updates scan_runs metadata.
 * File fallback: merges by ticker and updates payload.
 */
export async function saveScanResultsBatch({ scanRunId, results, meta }) {
  if (!isSupabaseConfigured()) {
    const existing = readScanResultsFile();
    const payload = buildFilePayload({ existing, incoming: results, meta });
    writeScanResultsFile(payload);
    return;
  }

  if (!scanRunId) throw new Error('scanRunId is required when Supabase is configured');
  const supabase = getSupabase();
  const rows = (results || []).map((r) => ({
    scan_run_id: scanRunId,
    ticker: r.ticker,
    vcp_bullish: r.vcpBullish ?? null,
    contractions: r.contractions ?? null,
    last_close: r.lastClose ?? null,
    relative_strength: r.relativeStrength ?? null,
    score: r.score ?? null,
    enhanced_score: r.enhancedScore ?? r.score ?? null,
    industry_name: r.industryName ?? null,
    industry_rank: r.industryRank ?? null,
    data: r,
  }));

  if (rows.length > 0) {
    const { error } = await supabase.from('scan_results').insert(rows);
    if (error) throw new Error(error.message);
  }

  const metaUpdate = buildRunMetaUpdate(meta);
  if (metaUpdate) {
    const { error: metaErr } = await supabase
      .from('scan_runs')
      .update(metaUpdate)
      .eq('id', scanRunId);
    if (metaErr) throw new Error(metaErr.message);
  }
}

/**
 * Update a batch of results after RS ratings are computed.
 * Supabase: updates existing scan_results rows.
 * File fallback: merges by ticker and updates payload.
 */
export async function updateScanResultsBatch({ scanRunId, results, meta }) {
  if (!isSupabaseConfigured()) {
    const existing = readScanResultsFile();
    const payload = buildFilePayload({ existing, incoming: results, meta });
    writeScanResultsFile(payload);
    return;
  }

  if (!scanRunId) throw new Error('scanRunId is required when Supabase is configured');
  const supabase = getSupabase();

  const rows = (results || []).map((r) => ({
    scan_run_id: scanRunId,
    ticker: r.ticker,
    vcp_bullish: r.vcpBullish ?? null,
    contractions: r.contractions ?? null,
    last_close: r.lastClose ?? null,
    relative_strength: r.relativeStrength ?? null,
    score: r.score ?? null,
    enhanced_score: r.enhancedScore ?? r.score ?? null,
    industry_name: r.industryName ?? null,
    industry_rank: r.industryRank ?? null,
    data: r,
  }));
  if (rows.length > 0) {
    const { error } = await supabase
      .from('scan_results')
      .upsert(rows, { onConflict: 'scan_run_id,ticker' });
    if (error) throw new Error(error.message);
  }

  const metaUpdate = buildRunMetaUpdate(meta);
  if (metaUpdate) {
    const { error: metaErr } = await supabase
      .from('scan_runs')
      .update(metaUpdate)
      .eq('id', scanRunId);
    if (metaErr) throw new Error(metaErr.message);
  }
}

/**
 * Update only industry rank/name fields in batch.
 * Supabase: updates scan_results rows.
 * File fallback: merges by ticker and updates payload.
 */
export async function updateIndustryRankBatch({ scanRunId, results, meta }) {
  if (!isSupabaseConfigured()) {
    const existing = readScanResultsFile();
    const payload = buildFilePayload({ existing, incoming: results, meta });
    writeScanResultsFile(payload);
    return;
  }

  if (!scanRunId) throw new Error('scanRunId is required when Supabase is configured');
  const supabase = getSupabase();

  const updates = await Promise.all(
    (results || []).map((r) => supabase
      .from('scan_results')
      .update({
        industry_name: r.industryName ?? null,
        industry_rank: r.industryRank ?? null,
        data: r,
      })
      .eq('scan_run_id', scanRunId)
      .eq('ticker', r.ticker))
  );
  const updateError = updates.find((u) => u?.error);
  if (updateError?.error) throw new Error(updateError.error.message);

  const metaUpdate = buildRunMetaUpdate(meta);
  if (metaUpdate) {
    const { error: metaErr } = await supabase
      .from('scan_runs')
      .update(metaUpdate)
      .eq('id', scanRunId);
    if (metaErr) throw new Error(metaErr.message);
  }
}

/** @param {{ scannedAt: string, from: string, to: string, totalTickers: number, vcpBullishCount: number, results: object[] }} payload */
export async function saveScanResults(payload) {
  if (!isSupabaseConfigured()) {
    writeScanResultsFile(payload);
    return;
  }
  try {
    const supabase = getSupabase();
    const { data: run, error: runErr } = await supabase
        .from('scan_runs')
        .insert({
          scanned_at: payload.scannedAt,
          date_from: payload.from ?? null,
          date_to: payload.to ?? null,
          total_tickers: payload.results?.length ?? 0,
          vcp_bullish_count: payload.vcpBullishCount ?? 0,
        })
        .select('id')
        .single();
    if (runErr) throw new Error(runErr.message);
    const rows = (payload.results || []).map((r) => ({
        scan_run_id: run.id,
        ticker: r.ticker,
        vcp_bullish: r.vcpBullish ?? null,
        contractions: r.contractions ?? null,
        last_close: r.lastClose ?? null,
        relative_strength: r.relativeStrength ?? null,
        score: r.score ?? null,
        enhanced_score: r.enhancedScore ?? r.score ?? null,
        industry_name: r.industryName ?? null,
        industry_rank: r.industryRank ?? null,
        data: r,
    }));
    const batchSize = 500;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { error } = await supabase.from('scan_results').insert(batch);
      if (error) throw new Error(error.message);
    }
  } catch (err) {
    console.warn('Save scan results failed; using file fallback.', err?.message || err);
    writeScanResultsFile(payload);
  }
}
