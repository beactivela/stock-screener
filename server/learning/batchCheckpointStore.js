import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSupabase, isSupabaseConfigured } from '../supabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const BATCH_RUNS_FILE = path.join(DATA_DIR, 'batch_learning_runs.json');

function ensureDataDir() {
  if (process.env.VERCEL) return;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadRunsFromFile() {
  try {
    if (!fs.existsSync(BATCH_RUNS_FILE)) return {};
    const raw = fs.readFileSync(BATCH_RUNS_FILE, 'utf8');
    if (!raw || raw.trim() === '') return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveRunsToFile(store) {
  if (process.env.VERCEL) return { stored: false, reason: 'vercel_read_only' };
  try {
    ensureDataDir();
    fs.writeFileSync(BATCH_RUNS_FILE, JSON.stringify(store, null, 2), 'utf8');
    return { stored: true, mode: 'file' };
  } catch (e) {
    return { stored: false, error: e.message };
  }
}

async function upsertSupabaseRun(runId, patch) {
  if (!isSupabaseConfigured()) return { stored: false, reason: 'supabase_not_configured' };
  const supabase = getSupabase();
  if (!supabase) return { stored: false, reason: 'supabase_not_configured' };

  const now = new Date().toISOString();
  const row = {
    run_id: runId,
    status: patch.status || 'running',
    started_at: patch.startedAt || now,
    updated_at: patch.updatedAt || now,
    options_json: patch.options || null,
    checkpoints_json: patch.checkpoints || [],
    final_result_json: patch.finalResult || null,
  };

  const { error } = await supabase
    .from('learning_batch_runs')
    .upsert(row, { onConflict: 'run_id' });
  if (error) return { stored: false, error: error.message, mode: 'supabase' };
  return { stored: true, mode: 'supabase' };
}

async function loadSupabaseRun(runId) {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('learning_batch_runs')
    .select('*')
    .eq('run_id', runId)
    .limit(1);
  if (error || !data || data.length === 0) return null;
  const row = data[0];
  return {
    runId: row.run_id,
    status: row.status,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    options: row.options_json || null,
    checkpoints: row.checkpoints_json || [],
    finalResult: row.final_result_json || null,
  };
}

export async function initializeBatchRun({ runId, options }) {
  const now = new Date().toISOString();
  const base = {
    runId,
    status: 'running',
    startedAt: now,
    updatedAt: now,
    options: options || null,
    checkpoints: [],
    finalResult: null,
  };

  const db = await upsertSupabaseRun(runId, base).catch(() => ({ stored: false }));
  if (db?.stored) return { stored: true, mode: db.mode, run: base };

  const file = loadRunsFromFile();
  file[runId] = base;
  const saved = saveRunsToFile(file);
  return { stored: saved.stored, mode: saved.mode || 'file', run: base, error: saved.error || null };
}

export async function appendBatchCheckpoint(runId, checkpoint) {
  const existing = await getBatchRun(runId);
  const base = existing || {
    runId,
    status: 'running',
    startedAt: checkpoint?.updatedAt || new Date().toISOString(),
    updatedAt: checkpoint?.updatedAt || new Date().toISOString(),
    options: null,
    checkpoints: [],
    finalResult: null,
  };

  const next = {
    ...base,
    status: checkpoint?.status || base.status || 'running',
    updatedAt: checkpoint?.updatedAt || new Date().toISOString(),
    checkpoints: [...(base.checkpoints || []), checkpoint],
  };

  const db = await upsertSupabaseRun(runId, next).catch(() => ({ stored: false }));
  if (db?.stored) return { stored: true, mode: db.mode };

  const file = loadRunsFromFile();
  file[runId] = next;
  return saveRunsToFile(file);
}

export async function finalizeBatchRun(runId, finalResult) {
  const existing = await getBatchRun(runId);
  const next = {
    ...(existing || {
      runId,
      startedAt: new Date().toISOString(),
      checkpoints: [],
      options: null,
    }),
    status: 'completed',
    updatedAt: new Date().toISOString(),
    finalResult,
  };

  const db = await upsertSupabaseRun(runId, next).catch(() => ({ stored: false }));
  if (db?.stored) return { stored: true, mode: db.mode };

  const file = loadRunsFromFile();
  file[runId] = next;
  return saveRunsToFile(file);
}

export async function getBatchRun(runId) {
  const db = await loadSupabaseRun(runId).catch(() => null);
  if (db) return db;

  const file = loadRunsFromFile();
  return file[runId] || null;
}

export async function listBatchRuns(limit = 20) {
  if (isSupabaseConfigured()) {
    const supabase = getSupabase();
    if (supabase) {
      const { data, error } = await supabase
        .from('learning_batch_runs')
        .select('run_id,status,started_at,updated_at,final_result_json')
        .order('updated_at', { ascending: false })
        .limit(limit);
      if (!error && data) {
        return data.map((r) => ({
          runId: r.run_id,
          status: r.status,
          startedAt: r.started_at,
          updatedAt: r.updated_at,
          finalResult: r.final_result_json || null,
        }));
      }
    }
  }

  const file = loadRunsFromFile();
  return Object.values(file)
    .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
    .slice(0, limit);
}
