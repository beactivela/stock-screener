/**
 * Manual combined experts sync: FMP Congress + StockCircle + WhaleWisdom (same as POST /api/cron/experts-sync).
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { runExpertsSync } from '../server/experts/runExpertsSync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

const HEARTBEAT_MS = 15000;

async function main() {
  const min = Number(process.env.STOCKCIRCLE_MIN_PERF_PCT);
  const t0 = Date.now();
  console.error(`[experts:sync] started (FMP Congress → StockCircle → WhaleWisdom) — heartbeat every ${HEARTBEAT_MS / 1000}s…`);
  const heartbeat = setInterval(() => {
    console.error(`[experts:sync] still running… ${formatElapsed(Date.now() - t0)}`);
  }, HEARTBEAT_MS);

  let result;
  try {
    result = await runExpertsSync({
      stockcircle: {
        minPerformance1yPct: Number.isFinite(min) ? min : 20,
      },
    });
  } catch (err) {
    console.error(`[experts:sync] failed after ${formatElapsed(Date.now() - t0)}`);
    throw err;
  } finally {
    clearInterval(heartbeat);
  }

  const total = Date.now() - t0;
  const fmp = result?.fmpCongress?.skipped ? 'skipped' : result?.fmpCongress?.ok ? 'ok' : 'error';
  console.error(
    `[experts:sync] finished in ${formatElapsed(total)} (fmp congress: ${fmp}, stockcircle: ${result?.stockcircle?.ok ? 'ok' : 'error'}, whalewisdom: ${result?.whalewisdom?.ok ? 'ok' : 'error'})`
  );
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
