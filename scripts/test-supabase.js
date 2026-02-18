#!/usr/bin/env node
/**
 * Quick Supabase connection test.
 * Run: node scripts/test-supabase.js
 * Requires SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_ANON_KEY) in .env
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSupabase, isSupabaseConfigured } from '../server/supabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  console.log('Supabase configured:', isSupabaseConfigured());
  const supabase = getSupabase();
  if (!supabase) {
    console.log('No SUPABASE_URL or SUPABASE_SERVICE_KEY in .env. Add them and retry.');
    process.exit(1);
  }

  try {
    // Simple health check - list tables or run a safe query
    const { data, error } = await supabase.from('tickers').select('ticker').limit(1);
    if (error) {
      console.error('Supabase error:', error.message);
      process.exit(1);
    }
    console.log('Connection OK. Sample query (tickers):', data);
  } catch (e) {
    console.error('Failed:', e.message);
    process.exit(1);
  }
}

main();
