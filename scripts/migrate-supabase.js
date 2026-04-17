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

function resolveSqlFiles(argv = []) {
  const defaultSchema = path.join(__dirname, '..', 'docs', 'supabase', 'schema.sql');
  const fileArgs = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--file' || arg === '-f') {
      const next = argv[i + 1];
      if (!next) {
        console.error('Missing value after --file');
        process.exit(1);
      }
      fileArgs.push(next);
      i += 1;
      continue;
    }
    fileArgs.push(arg);
  }

  if (fileArgs.length === 0) return [defaultSchema];

  return fileArgs.map((filePath) => (
    path.isAbsolute(filePath) ? filePath : path.join(__dirname, '..', filePath)
  ));
}

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
    return {
      connectionString: uri,
      ssl: { rejectUnauthorized: false },
      password,
      projectRef,
    };
  }
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    const normalized = url.startsWith('postgres://') ? 'postgresql://' + url.slice(11) : url;
    try {
      new URL(normalized);
      return {
        connectionString: normalized,
        ssl: { rejectUnauthorized: false },
        password: process.env.SUPABASE_DB_PASSWORD?.trim() || null,
        projectRef,
      };
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

async function connectWithFallback(Client, config) {
  const attempts = [
    { type: 'direct', config },
  ];

  if (config.password && config.projectRef) {
    const poolerHosts = [
      process.env.SUPABASE_POOLER_HOST,
      'aws-0-us-east-1.pooler.supabase.com',
      'aws-0-us-west-1.pooler.supabase.com',
      'aws-0-us-west-2.pooler.supabase.com',
    ].filter(Boolean);
    for (const host of poolerHosts) {
      attempts.push({
        type: `pooler:${host}`,
        config: {
          host,
          port: Number(process.env.SUPABASE_POOLER_PORT) || 6543,
          user: `postgres.${config.projectRef}`,
          password: config.password,
          database: 'postgres',
          ssl: { rejectUnauthorized: false },
          connectionTimeoutMillis: 5000,
        },
      });
    }
  }

  let lastError = null;
  for (const attempt of attempts) {
    const client = new Client(attempt.config);
    try {
      await client.connect();
      return { client, mode: attempt.type };
    } catch (error) {
      lastError = error;
      try { await client.end(); } catch {}
    }
  }
  throw lastError || new Error('Could not connect to Supabase Postgres.');
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

  const sqlFiles = resolveSqlFiles(process.argv.slice(2));

  let client;
  try {
    const connection = await connectWithFallback(Client, config);
    client = connection.client;
    console.log(`Connected to Supabase Postgres via ${connection.mode}.`);
    for (const sqlFile of sqlFiles) {
      const sql = fs.readFileSync(sqlFile, 'utf8');
      await client.query(sql);
      console.log(`Applied SQL file: ${path.relative(path.join(__dirname, '..'), sqlFile)}`);
    }
    console.log('Migration SQL applied successfully.');
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
    if (client) await client.end();
  }
}

main();
