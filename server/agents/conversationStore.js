/**
 * Conversation storage: Supabase when configured, else file fallback.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v4 as uuidv4 } from 'uuid';
import { getSupabase, isSupabaseConfigured } from '../supabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = path.join(__dirname, '..', '..', 'data', 'agent-conversations');
const DEFAULT_FILE = 'conversations.json';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function getFilePath(storageDir) {
  const dir = storageDir || DEFAULT_DIR;
  ensureDir(dir);
  return path.join(dir, DEFAULT_FILE);
}

function readAll(storageDir) {
  const filePath = getFilePath(storageDir);
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) || [];
  } catch {
    return [];
  }
}

function writeAll(rows, storageDir) {
  const filePath = getFilePath(storageDir);
  fs.writeFileSync(filePath, JSON.stringify(rows, null, 2), 'utf8');
}

export async function saveConversation(payload, options = {}) {
  const { forceFile = false, storageDir } = options;
  const record = {
    id: payload.id || uuidv4(),
    createdAt: payload.createdAt || new Date().toISOString(),
    ticker: payload.ticker,
    regime: payload.regime ?? null,
    signal: payload.signal ?? null,
    decision: payload.decision ?? null,
    transcript: payload.transcript ?? null,
    outcome: payload.outcome ?? null,
  };

  if (!forceFile && isSupabaseConfigured()) {
    try {
      const supabase = getSupabase();
      const { error } = await supabase.from('agent_conversations').insert({
        id: record.id,
        created_at: record.createdAt,
        ticker: record.ticker,
        regime: record.regime,
        signal: record.signal,
        decision: record.decision,
        transcript: record.transcript,
        outcome: record.outcome,
      });
      if (error) throw new Error(error.message);
      return record;
    } catch {
      // fall through to file storage
    }
  }

  const all = readAll(storageDir);
  all.unshift(record);
  writeAll(all, storageDir);
  return record;
}

export async function loadConversation(id, options = {}) {
  const { forceFile = false, storageDir } = options;
  if (!id) return null;

  if (!forceFile && isSupabaseConfigured()) {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('agent_conversations')
        .select('*')
        .eq('id', id)
        .single();
      if (error || !data) return null;
      return {
        id: data.id,
        createdAt: data.created_at,
        ticker: data.ticker,
        regime: data.regime,
        signal: data.signal,
        decision: data.decision,
        transcript: data.transcript,
        outcome: data.outcome,
      };
    } catch {
      return null;
    }
  }

  const all = readAll(storageDir);
  return all.find((r) => r.id === id) || null;
}

export async function labelConversation(id, outcome, options = {}) {
  const { forceFile = false, storageDir } = options;
  if (!id) return null;

  if (!forceFile && isSupabaseConfigured()) {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('agent_conversations')
        .update({ outcome })
        .eq('id', id)
        .select('*')
        .single();
      if (error || !data) return null;
      return {
        id: data.id,
        createdAt: data.created_at,
        ticker: data.ticker,
        regime: data.regime,
        signal: data.signal,
        decision: data.decision,
        transcript: data.transcript,
        outcome: data.outcome,
      };
    } catch {
      return null;
    }
  }

  const all = readAll(storageDir);
  const idx = all.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  all[idx].outcome = outcome;
  writeAll(all, storageDir);
  return all[idx];
}
