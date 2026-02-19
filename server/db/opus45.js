/**
 * Opus45 signals cache data access
 */

import { getSupabase, isSupabaseConfigured } from '../supabase.js';

/** @returns {Promise<{ signals: object[], stats?: object, total?: number, computedAt?: string }|null>} */
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
  return {
    signals: data.signals ?? [],
    stats: data.stats ?? null,
    total: data.total ?? 0,
    computedAt: data.computed_at,
  };
}

/** @param {{ signals: object[], stats?: object, total?: number, computedAt?: string }} data */
export async function saveOpus45Signals(data) {
  if (!isSupabaseConfigured()) throw new Error('Supabase required. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.');
  const supabase = getSupabase();
  const { error } = await supabase.from('opus45_signals_cache').insert({
    computed_at: data.computedAt ?? new Date().toISOString(),
    signals: data.signals ?? [],
    stats: data.stats ?? null,
    total: data.total ?? (data.signals?.length ?? 0),
  });
  if (error) throw new Error(error.message);
}
