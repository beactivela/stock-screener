/**
 * Supabase client for stock-screener.
 *
 * Connects to Supabase when SUPABASE_URL and SUPABASE_SERVICE_KEY are set.
 * Use SUPABASE_SERVICE_KEY (not anon key) for server-side writes; it bypasses RLS.
 *
 * Usage:
 *   import { getSupabase } from './supabase.js';
 *   const supabase = getSupabase();
 *   if (supabase) {
 *     const { data } = await supabase.from('fundamentals').select('*').eq('ticker', 'AAPL');
 *   }
 */

import { createClient } from '@supabase/supabase-js';

let _client = null;

/**
 * Get Supabase client. Returns null if env vars are not configured.
 * Caches the client for reuse.
 *
 * @returns {import('@supabase/supabase-js').SupabaseClient | null}
 */
export function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    return null;
  }

  if (!_client) {
    _client = createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return _client;
}

/**
 * Check if Supabase is configured and reachable.
 * Useful for feature flags (use DB vs file fallback).
 */
export function isSupabaseConfigured() {
  return !!(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY));
}
