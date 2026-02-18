#!/usr/bin/env node
/**
 * Run Supabase schema to create all tables.
 *
 * Add to .env (prefer explicit params to avoid URL parsing issues):
 *   SUPABASE_PROJECT_REF=ksnneoomyrvmzukwxmqg
 *   SUPABASE_DB_PASSWORD=your_database_password
 *
 * Or full: DATABASE_URL=postgresql://postgres:PASSWORD@db.ksnneoomyrvmzukwxmqg.supabase.co:5432/postgres
 *
 * Run: npm run migrate:supabase
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { Client } = pg;

function getConnectionConfig() {
  const projectRef = process.env.SUPABASE_PROJECT_REF || 'ksnneoomyrvmzukwxmqg';
  const password = (
    process.env.SUPABASE_DB_PASSWORD ??
    process.env.SUPABASE_PASSWORD ??
    process.env.DATABASE_PASSWORD ??
    process.env.PSWD
  )?.trim();
  if (password) {
    // Build URI with encoded password (handles @, #, : etc in password)
    const uri = `postgresql://postgres:${encodeURIComponent(password)}@db.${projectRef}.supabase.co:5432/postgres`;
    return { connectionString: uri, ssl: { rejectUnauthorized: false } };
  }
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    const normalized = url.startsWith('postgres://') ? 'postgresql://' + url.slice(11) : url;
    try {
      new URL(normalized);
      return { connectionString: normalized, ssl: { rejectUnauthorized: false } };
    } catch (e) {
      console.error(
        'DATABASE_URL is invalid. If your password has special chars (@ # : /), use explicit vars instead:\n' +
          '  SUPABASE_DB_PASSWORD=your_password\n' +
          '  (Script will build the connection string with proper encoding.)'
      );
      process.exit(1);
    }
  }
  return null;
}

async function main() {
  const config = getConnectionConfig();
  if (!config) {
    console.error(
      'Add to .env:\n' +
        '  SUPABASE_PROJECT_REF=ksnneoomyrvmzukwxmqg\n' +
        '  SUPABASE_DB_PASSWORD=your_database_password\n' +
        '  (Get password from Supabase: Project Settings → Database)'
    );
    process.exit(1);
  }

  const schemaPath = path.join(__dirname, '..', 'docs', 'supabase', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  const client = new Client(config);
  try {
    await client.connect();
    console.log('Connected to Supabase Postgres.');
    await client.query(sql);
    console.log('Schema applied successfully. Tables created.');
  } catch (e) {
    console.error('Migration failed:', e.message);
    if (e.code === 'ERR_INVALID_URL') {
      console.error(
        '\nIf your password has special chars, try wrapping in quotes in .env.\n' +
          'Or run the schema manually: Supabase → SQL Editor → paste docs/supabase/schema.sql → Run'
      );
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
