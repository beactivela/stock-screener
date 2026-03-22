/**
 * Pre-warm / extend daily bars in Supabase for the scan universe (same ~420d window as the scan).
 * Invoked by POST /api/cron/refresh-bars so host cron can run before the scheduled scan.
 */

import { loadTickers as loadTickersFromDb } from './db/tickers.js';
import { getBarsBatch } from './db/bars.js';
import { dateRange } from './scan.js';

/**
 * @param {object} [deps]
 * @param {() => Promise<string[]>} [deps.loadTickers]
 * @param {(reqs: object[], opts: object) => Promise<object[]>} [deps.getBarsBatch]
 * @param {(days: number) => { from: string, to: string }} [deps.dateRange]
 * @param {number} [deps.chunkSize]
 */
export async function runUniverseBarsRefresh(deps = {}) {
  const loadTickers = deps.loadTickers ?? loadTickersFromDb;
  const batchGetBars = deps.getBarsBatch ?? getBarsBatch;
  const rangeFn = deps.dateRange ?? dateRange;
  const chunkSize =
    deps.chunkSize ?? Math.max(10, Number(process.env.CRON_BARS_CHUNK) || 40);

  const tickers = await loadTickers();
  if (!tickers.length) {
    return { ok: false, message: 'No tickers in database', tickers: 0, yahooFetched: 0, cacheHits: 0, failures: 0 };
  }

  const limit = Number(process.env.SCAN_LIMIT) || 0;
  const list = limit > 0 ? tickers.slice(0, limit) : tickers;
  const { from, to } = rangeFn(420);
  const concurrency = Math.max(1, Number(process.env.BARS_BATCH_CONCURRENCY) || 8);

  let yahooFetched = 0;
  let cacheHits = 0;
  let failures = 0;

  for (let i = 0; i < list.length; i += chunkSize) {
    const chunk = list.slice(i, i + chunkSize);
    const requests = chunk.map((ticker) => ({ ticker, from, to, interval: '1d' }));
    const results = await batchGetBars(requests, { concurrency });

    for (const r of results) {
      if (!r) {
        failures += 1;
        continue;
      }
      if (r.status === 'rejected') {
        failures += 1;
        continue;
      }
      if (r.status === 'fulfilled') {
        if (!r.bars?.length) {
          failures += 1;
          continue;
        }
        if (r.source === 'yahoo') yahooFetched += 1;
        else if (r.source === 'cache') cacheHits += 1;
        else failures += 1;
      } else {
        failures += 1;
      }
    }
  }

  return {
    ok: true,
    tickers: list.length,
    from,
    to,
    yahooFetched,
    cacheHits,
    failures,
  };
}
