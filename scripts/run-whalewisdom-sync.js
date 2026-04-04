/**
 * Manual WhaleWisdom → Supabase sync (same logic as POST /api/cron/whalewisdom-sync).
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { runWhalewisdomSync } from '../server/whalewisdom/sync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function main() {
  const result = await runWhalewisdomSync();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
