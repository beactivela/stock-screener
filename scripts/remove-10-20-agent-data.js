#!/usr/bin/env node
/**
 * Remove 10-20 Cross Over signal agent data from the database.
 * Deletes learning_runs and optimized_weights where agent_type = 'ma_crossover_10_20'.
 * Run once after removing the 10-20 agent from the app.
 *
 * Usage: node scripts/remove-10-20-agent-data.js
 * Requires: SUPABASE_URL and SUPABASE_SERVICE_KEY in env (e.g. from .env).
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSupabase, isSupabaseConfigured } from '../server/supabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const AGENT_TYPE = 'ma_crossover_10_20';

async function main() {
  if (!isSupabaseConfigured()) {
    console.error('Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY (e.g. in .env).');
    process.exit(1);
  }

  const supabase = getSupabase();

  // Delete learning_runs for 10-20 agent
  const { data: lrData, error: lrErr } = await supabase
    .from('learning_runs')
    .delete()
    .eq('agent_type', AGENT_TYPE)
    .select('id');

  if (lrErr) {
    console.error('learning_runs delete error:', lrErr.message);
    process.exit(1);
  }
  const lrCount = Array.isArray(lrData) ? lrData.length : 0;
  console.log(`Deleted ${lrCount} row(s) from learning_runs where agent_type = '${AGENT_TYPE}'.`);

  // Delete optimized_weights for 10-20 agent
  const { data: owData, error: owErr } = await supabase
    .from('optimized_weights')
    .delete()
    .eq('agent_type', AGENT_TYPE)
    .select('id');

  if (owErr) {
    console.error('optimized_weights delete error:', owErr.message);
    process.exit(1);
  }
  const owCount = Array.isArray(owData) ? owData.length : 0;
  console.log(`Deleted ${owCount} row(s) from optimized_weights where agent_type = '${AGENT_TYPE}'.`);

  console.log('Done.');
}

main();
