#!/usr/bin/env node
/**
 * Diagnostic: show which Supabase env vars are set (values hidden).
 * Run: node scripts/check-supabase-env.js
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const vars = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'SUPABASE_ANON_KEY'];
console.log('Supabase env (values hidden):');
for (const v of vars) {
  const val = process.env[v];
  console.log(`  ${v}: ${val ? '[SET]' : '[MISSING]'}`);
}
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
if (url && key) {
  console.log('\nConfig OK. Run: npm run import:supabase');
} else {
  console.log('\nAdd to .env:');
  console.log('  SUPABASE_URL=https://ksnneoomyrvmzukwxmqg.supabase.co');
  console.log('  SUPABASE_SERVICE_KEY=<service_role key from Supabase dashboard>');
  console.log('\nGet the key: Supabase Dashboard > Project Settings > API > service_role (secret)');
}
