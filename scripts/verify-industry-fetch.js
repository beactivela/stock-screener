#!/usr/bin/env node
/**
 * Verifies industry fetch: calls POST /api/industry-trend/fetch and waits for completion.
 * Run: node scripts/verify-industry-fetch.js
 * Requires server (npm run dev → 5173, or npm run server → 3001). Override with BASE_URL.
 */
const BASE = process.env.BASE_URL || 'http://localhost:5173';

async function main() {
  console.log('Calling POST /api/industry-trend/fetch...');
  console.log('This fetches fundamentals + bars for all scan tickers. Takes ~2-3 min for 500.\n');

  const res = await fetch(`${BASE}/api/industry-trend/fetch`, { method: 'POST' });
  if (!res.ok) {
    const body = await res.text();
    console.error('Error:', res.status, body);
    process.exit(1);
  }

  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let lastProgress = '';

  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const msg = JSON.parse(line.slice(6).trim());
        if (msg.done) {
          console.log('\nDone:', msg);
          console.log(`\nResult: ${msg.fundamentalsFetched ?? 0}/${msg.fundamentalsTotal} fundamentals, ${msg.barsFetched ?? 0}/${msg.barsTotal} bars`);
          console.log(`Industries: ${msg.industriesCount ?? 0}`);
          process.exit(0);
        }
        if (msg.phase === 'fundamentals' && msg.index % 50 === 0) {
          console.log(`  Fundamentals: ${msg.index}/${msg.total}`);
        }
        if (msg.phase === 'bars' && msg.index % 50 === 0) {
          console.log(`  Bars: ${msg.index}/${msg.total}`);
        }
      } catch {
        /* ignore */
      }
    }
  }
  console.log('Stream ended without done message');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
