/**
 * Opus45 signals cache data access
 */

import { getSupabase, isSupabaseConfigured } from '../supabase.js';

export function mapOpus45CacheRow(data) {
  if (!data || typeof data !== 'object') return null;
  return {
    signals: data.signals ?? [],
    allScores: data.all_scores ?? data.allScores ?? [],
    stats: data.stats ?? null,
    total: data.total ?? 0,
    computedAt: data.computed_at ?? data.computedAt ?? null,
  };
}

export function buildOpus45CacheInsertRow(data = {}) {
  return {
    computed_at: data.computedAt ?? new Date().toISOString(),
    signals: data.signals ?? [],
    all_scores: data.allScores ?? [],
    stats: data.stats ?? null,
    total: data.total ?? (data.signals?.length ?? 0),
  };
}

/** @returns {Promise<{ signals: object[], allScores: object[], stats?: object, total?: number, computedAt?: string }|null>} */
export async function loadOpus45Signals() {
  if (!isSupabaseConfigured()) throw new Error('Supabase required. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.');
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('opus45_signals_cache')
    .select('*')
    .order('computed_at', { ascending: false })
    .limit(1)
    .single();
  if (error || !data) return null;
  return mapOpus45CacheRow(data);
}

/** @param {{ signals: object[], allScores?: object[], stats?: object, total?: number, computedAt?: string }} data */
export async function saveOpus45Signals(data) {
  if (!isSupabaseConfigured()) throw new Error('Supabase required. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.');
  const supabase = getSupabase();
  const insertRow = buildOpus45CacheInsertRow(data);
  const { error } = await supabase.from('opus45_signals_cache').insert(insertRow);
  if (!error) return;

  // Backward-compatible fallback for environments that have not run all_scores migration yet.
  if (/all_scores/i.test(String(error.message || ''))) {
    const { error: fallbackError } = await supabase.from('opus45_signals_cache').insert({
      computed_at: insertRow.computed_at,
      signals: insertRow.signals,
      stats: insertRow.stats,
      total: insertRow.total,
    });
    if (!fallbackError) return;
    throw new Error(fallbackError.message);
  }

  throw new Error(error.message);
}
