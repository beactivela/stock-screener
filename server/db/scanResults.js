/**
 * Scan results data access: Supabase when configured, else data/scan-results.json
 * Shape: { scannedAt, from, to, totalTickers, vcpBullishCount, results }
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSupabase, isSupabaseConfigured } from '../supabase.js';
import { classifySignalSetups } from '../learning/signalSetupClassifier.js';
import { assignIBDRelativeStrengthRatings } from '../vcp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const SCAN_RESULTS_PATH = path.join(DATA_DIR, 'scan-results.json');
const SCAN_RESULT_SUMMARY_SELECT = 'ticker,vcp_bullish,contractions,last_close,relative_strength,score,enhanced_score,industry_name,industry_rank';

function getScanRunMeta(run) {
  return {
    scannedAt: run?.scanned_at ?? null,
    from: run?.date_from,
    to: run?.date_to,
  };
}

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

export function mapScanResultSummaryRow(row) {
  if (!row) return null;
  return {
    ticker: row.ticker,
    vcpBullish: row.vcp_bullish ?? row.vcpBullish ?? false,
    contractions: row.contractions ?? null,
    lastClose: row.last_close ?? row.lastClose ?? null,
    relativeStrength: row.relative_strength ?? row.relativeStrength ?? null,
    score: row.score ?? null,
    enhancedScore: row.enhanced_score ?? row.enhancedScore ?? row.score ?? null,
    industryName: row.industry_name ?? row.industryName ?? null,
    industryRank: row.industry_rank ?? row.industryRank ?? null,
  };
}

/**
 * Merge denormalized Supabase columns into `data` when jsonb is stale.
 * Some deployments saw stream inserts persist raw `data` while upsert updated top-level
 * columns only (or clients read before jsonb refresh) — UI then showed rsData but RS/agents blank.
 */
export function mergeScanResultDataRow(row) {
  if (!row || typeof row !== 'object') return null;
  const d = row.data;
  if (!d || typeof d !== 'object') return null;
  const out = { ...d };
  if (row.ticker && !out.ticker) out.ticker = row.ticker;
  if (row.relative_strength != null && out.relativeStrength == null) {
    out.relativeStrength = row.relative_strength;
  }
  if (row.enhanced_score != null && out.enhancedScore == null) {
    out.enhancedScore = row.enhanced_score;
  }
  if (row.industry_rank != null && out.industryRank == null) {
    out.industryRank = row.industry_rank;
  }
  if (row.industry_name != null && out.industryName == null) {
    out.industryName = row.industry_name;
  }
  if (row.last_close != null && out.lastClose == null) {
    out.lastClose = row.last_close;
  }
  if (row.score != null && out.score == null) {
    out.score = row.score;
  }
  return out;
}

/**
 * When `data` jsonb stayed at stream-insert shape (rsData.rsRaw set, relativeStrength null) and
 * denormalized columns are also null, merge alone never runs classifySignalSetups (needs IBD 1–99).
 * Re-rank the universe from raw RS here, then fill empty signalSetups.
 */
export function enrichScanResultRowsForApi(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const needIbdr = rows.some((r) => {
    if (!r || typeof r !== 'object') return false;
    if (typeof r.relativeStrength === 'number' && Number.isFinite(r.relativeStrength)) return false;
    const raw = r?.rsData?.rsRaw ?? r?.relativeStrengthRaw ?? r?.relativeStrength;
    return Number.isFinite(Number(raw));
  });
  const rated = needIbdr ? assignIBDRelativeStrengthRatings(rows) : rows;
  return rated.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const existing = Array.isArray(row.signalSetups) ? row.signalSetups : [];
    if (existing.length > 0) return row;
    try {
      return { ...row, signalSetups: classifySignalSetups(row) };
    } catch {
      return { ...row, signalSetups: [] };
    }
  });
}

export function buildScanTickerNav({ results = [], actionableBuyTickers = new Set() } = {}) {
  return (results || [])
    .map((row) => ({
      ticker: row.ticker,
      score: row.enhancedScore ?? row.score ?? 0,
      relativeStrength: row.relativeStrength ?? null,
      industryRank: row.industryRank ?? null,
      hasActionableBuy: actionableBuyTickers.has(row.ticker),
    }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

async function loadLatestRun(supabase) {
  // Match getSupabaseScanProgressIfRunning: newest run by insert time so progress + results
  // refer to the same scan (scanned_at alone can diverge if backfills or clocks differ).
  const { data: run, error: runErr } = await supabase
    .from('scan_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (runErr || !run) return null;
  return run;
}

/** Max age for treating a partial scan_run as still running (abandoned runs stop reporting). */
const DEFAULT_SCAN_DB_PROGRESS_MAX_AGE_MS = 2 * 3600 * 1000;
/** If total_tickers is still 0, assume warmup only for this long after run creation. */
const SCAN_DB_WARMUP_MAX_MS = 5 * 60 * 1000;

/**
 * Pure helper for tests — whether latest run row + saved row count looks like an in-flight scan.
 * @param {{ id: string, created_at: string, total_tickers?: number|null }} run
 * @param {number} resultCount
 * @param {number} [nowMs]
 * @param {number} [maxStaleMs]
 */
export function inferSupabaseScanRunLooksInProgress(run, resultCount, nowMs = Date.now(), maxStaleMs = DEFAULT_SCAN_DB_PROGRESS_MAX_AGE_MS) {
  if (!run?.id || !run.created_at) return false;
  const createdMs = Date.parse(run.created_at);
  if (Number.isNaN(createdMs)) return false;
  if (nowMs - createdMs > maxStaleMs) return false;
  const total = Number(run.total_tickers) || 0;
  const n = Number(resultCount) || 0;
  if (total > 0 && n >= total) return false;
  if (total === 0 && nowMs - createdMs > SCAN_DB_WARMUP_MAX_MS) return false;
  return true;
}

/**
 * Serverless-safe scan progress: any Vercel instance can read Supabase row counts.
 * Returns null when no scan looks in progress or Supabase is not configured.
 */
export async function getSupabaseScanProgressIfRunning() {
  if (!isSupabaseConfigured()) return null;
  const maxStaleMs = Number(process.env.SCAN_DB_PROGRESS_MAX_AGE_MS) || DEFAULT_SCAN_DB_PROGRESS_MAX_AGE_MS;
  try {
    const supabase = getSupabase();
    const { data: run, error: runErr } = await supabase
      .from('scan_runs')
      .select('id, scanned_at, total_tickers, vcp_bullish_count, created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (runErr || !run) return null;

    const { count, error: cErr } = await supabase
      .from('scan_results')
      .select('*', { count: 'exact', head: true })
      .eq('scan_run_id', run.id);
    if (cErr) throw new Error(cErr.message);
    const n = count ?? 0;
    const nowMs = Date.now();
    if (!inferSupabaseScanRunLooksInProgress(run, n, nowMs, maxStaleMs)) return null;

    const total = Number(run.total_tickers) || 0;
    return {
      scanId: run.id,
      running: true,
      progress: {
        index: n,
        total,
        vcpBullishCount: run.vcp_bullish_count ?? 0,
        startedAt: run.scanned_at,
        completedAt: null,
      },
      hasResults: n > 0,
      source: 'database',
    };
  } catch (err) {
    console.warn('getSupabaseScanProgressIfRunning:', err?.message || err);
    return null;
  }
}

/** @returns {Promise<{ scannedAt: string|null, from?: string, to?: string, totalTickers: number, vcpBullishCount: number, results: object[] }>} */
export async function loadScanResults() {
  if (!isSupabaseConfigured()) {
    const payload = readScanResultsFile();
    return { ...payload, results: enrichScanResultRowsForApi(payload.results || []) };
  }
  try {
    const supabase = getSupabase();
    const run = await loadLatestRun(supabase);
    if (!run) {
      return { scannedAt: null, results: [], totalTickers: 0, vcpBullishCount: 0 };
    }
    const { data: results, error: resErr } = await supabase
      .from('scan_results')
      .select('data, ticker, relative_strength, enhanced_score, industry_rank, industry_name, last_close, score')
      .eq('scan_run_id', run.id)
      .order('enhanced_score', { ascending: false, nullsFirst: false });
    if (resErr) throw new Error(resErr.message);
    const rows = enrichScanResultRowsForApi(
      (results || []).map((r) => mergeScanResultDataRow(r)).filter(Boolean),
    );
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
    const payload = readScanResultsFile();
    return { ...payload, results: enrichScanResultRowsForApi(payload.results || []) };
  }
}

/**
 * Load latest scan results plus scanRunId (needed for targeted updates).
 * File fallback returns scanRunId = null.
 */
export async function loadLatestScanResultsWithRun() {
  if (!isSupabaseConfigured()) {
    const payload = readScanResultsFile();
    return {
      scanRunId: null,
      ...payload,
      results: enrichScanResultRowsForApi(payload.results || []),
    };
  }
  try {
    const supabase = getSupabase();
    const run = await loadLatestRun(supabase);
    if (!run) {
      return { scanRunId: null, scannedAt: null, results: [], totalTickers: 0, vcpBullishCount: 0 };
    }
    const { data: results, error: resErr } = await supabase
      .from('scan_results')
      .select('data, ticker, relative_strength, enhanced_score, industry_rank, industry_name, last_close, score')
      .eq('scan_run_id', run.id)
      .order('enhanced_score', { ascending: false, nullsFirst: false });
    if (resErr) throw new Error(resErr.message);
    const rows = enrichScanResultRowsForApi(
      (results || []).map((r) => mergeScanResultDataRow(r)).filter(Boolean),
    );
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
    return {
      scanRunId: null,
      ...payload,
      results: enrichScanResultRowsForApi(payload.results || []),
    };
  }
}

export async function loadScanResultSummaries() {
  if (!isSupabaseConfigured()) {
    const payload = readScanResultsFile();
    const results = (payload.results || []).map(mapScanResultSummaryRow).filter(Boolean);
    return {
      scannedAt: payload.scannedAt ?? null,
      from: payload.from,
      to: payload.to,
      totalTickers: results.length,
      vcpBullishCount: results.filter((row) => row?.vcpBullish).length,
      results,
    };
  }
  try {
    const supabase = getSupabase();
    const run = await loadLatestRun(supabase);
    if (!run) {
      return { scannedAt: null, results: [], totalTickers: 0, vcpBullishCount: 0 };
    }
    const { data: results, error: resErr } = await supabase
      .from('scan_results')
      .select(SCAN_RESULT_SUMMARY_SELECT)
      .eq('scan_run_id', run.id)
      .order('enhanced_score', { ascending: false, nullsFirst: false });
    if (resErr) throw new Error(resErr.message);
    const rows = (results || []).map(mapScanResultSummaryRow).filter(Boolean);
    return {
      ...getScanRunMeta(run),
      totalTickers: rows.length,
      vcpBullishCount: rows.filter((row) => row?.vcpBullish).length,
      results: rows,
    };
  } catch (err) {
    console.warn('Load scan summaries failed; using file fallback.', err?.message || err);
    const payload = readScanResultsFile();
    const results = (payload.results || []).map(mapScanResultSummaryRow).filter(Boolean);
    return {
      scannedAt: payload.scannedAt ?? null,
      from: payload.from,
      to: payload.to,
      totalTickers: results.length,
      vcpBullishCount: results.filter((row) => row?.vcpBullish).length,
      results,
    };
  }
}

export async function loadLatestScanResultForTicker(ticker) {
  const normalizedTicker = String(ticker || '').trim().toUpperCase();
  if (!normalizedTicker) return null;
  if (!isSupabaseConfigured()) {
    const payload = readScanResultsFile();
    return (payload.results || []).find((row) => String(row?.ticker || '').toUpperCase() === normalizedTicker) || null;
  }
  try {
    const supabase = getSupabase();
    const run = await loadLatestRun(supabase);
    if (!run) return null;
    const { data, error } = await supabase
      .from('scan_results')
      .select('data')
      .eq('scan_run_id', run.id)
      .eq('ticker', normalizedTicker)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data?.data ?? null;
  } catch (err) {
    console.warn(`Load latest scan result for ${normalizedTicker} failed.`, err?.message || err);
    const payload = readScanResultsFile();
    return (payload.results || []).find((row) => String(row?.ticker || '').toUpperCase() === normalizedTicker) || null;
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
