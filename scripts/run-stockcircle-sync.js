/**
 * Manual StockCircle → Supabase sync (same logic as POST /api/cron/stockcircle-sync).
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { runStockcircleSync } from '../server/stockcircle/sync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

/** Human-readable elapsed for the sync timer (stderr only; stdout stays JSON-only). */
function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

const HEARTBEAT_MS = 15_000;

async function main() {
  const min = Number(process.env.STOCKCIRCLE_MIN_PERF_PCT);
  const t0 = Date.now();
  // Heartbeat on stderr so you can tell the process is alive during long scrapes.
  console.error(`[stockcircle:sync] started — updates every ${HEARTBEAT_MS / 1000}s…`);
  const heartbeat = setInterval(() => {
    console.error(`[stockcircle:sync] still running… ${formatElapsed(Date.now() - t0)}`);
  }, HEARTBEAT_MS);

  let result;
  try {
    result = await runStockcircleSync({
      minPerformance1yPct: Number.isFinite(min) ? min : 20,
    });
  } catch (err) {
    console.error(`[stockcircle:sync] failed after ${formatElapsed(Date.now() - t0)}`);
    throw err;
  } finally {
    clearInterval(heartbeat);
  }

  const total = Date.now() - t0;
  console.error(`[stockcircle:sync] finished in ${formatElapsed(total)} (${result?.ok ? 'ok' : 'error'})`);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
