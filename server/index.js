/**
 * Express server: serves API + optional static build. Caches API data to flat JSON files.
 * Loads .env from project root. Uses Yahoo Finance for bars (no API key). Massive only for populate-tickers.
 * Dev: npm run server (API only, port 3001). Production: npm run serve (build + serve app on PORT).
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load .env from project root (parent of server/)
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import { getBars, getFundamentals, getQuoteName } from './yahoo.js';
import { checkVCP } from './vcp.js';

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, '..', 'data');
const BARS_CACHE_DIR = path.join(DATA_DIR, 'bars');
const RESULTS_FILE = path.join(DATA_DIR, 'scan-results.json');
const FUNDAMENTALS_FILE = path.join(DATA_DIR, 'fundamentals.json');

// Cache TTL: how long to use saved bar data before refetching (default 24h)
const CACHE_TTL_MS = (Number(process.env.CACHE_TTL_HOURS) || 24) * 60 * 60 * 1000;

app.use(cors());
app.use(express.json());

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(BARS_CACHE_DIR)) fs.mkdirSync(BARS_CACHE_DIR, { recursive: true });
}
ensureDirs();

// In-memory cache for current process (avoids re-reading file on every request)
const barsMemoryCache = new Map();

/**
 * Get bars from file cache if present and not stale. File: data/bars/{TICKER}_{interval}.json
 * Format: { ticker, from, to, interval, fetchedAt, results }.
 */
function getBarsFromFile(ticker, from, to, interval = '1d') {
  const key = `${ticker}:${interval}:${from}:${to}`;
  const mem = barsMemoryCache.get(key);
  if (mem && Date.now() - mem.at < CACHE_TTL_MS) return mem.data;

  const safeTicker = ticker.replace(/[^A-Za-z0-9.-]/g, '_');
  const filePath = path.join(BARS_CACHE_DIR, `${safeTicker}_${interval}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (raw.interval !== interval) return null;
    const age = Date.now() - new Date(raw.fetchedAt).getTime();
    if (age > CACHE_TTL_MS) return null;
    const results = raw.results || [];
    if (results.length === 0) return null;
    if (raw.from === from && raw.to === to) {
      barsMemoryCache.set(key, { data: results, at: Date.now() - age });
      return results;
    }
    if (raw.from <= to && raw.to >= from) {
      const filtered = results.filter((b) => {
        const d = new Date(b.t).toISOString().slice(0, 10);
        return d >= from && d <= to;
      });
      if (filtered.length > 0) {
        barsMemoryCache.set(key, { data: filtered, at: Date.now() - age });
        return filtered;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Save bars to data/bars/{TICKER}_{interval}.json and update in-memory cache.
 */
function saveBarsToFile(ticker, from, to, results, interval = '1d') {
  const safeTicker = ticker.replace(/[^A-Za-z0-9.-]/g, '_');
  const filePath = path.join(BARS_CACHE_DIR, `${safeTicker}_${interval}.json`);
  const payload = { ticker, from, to, interval, fetchedAt: new Date().toISOString(), results };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  barsMemoryCache.set(`${ticker}:${interval}:${from}:${to}`, { data: results, at: Date.now() });
}

/** Load cached fundamentals. Format: { [ticker]: { pctHeldByInst, qtrEarningsYoY, profitMargin, operatingMargin, fetchedAt } } */
function loadFundamentals() {
  if (!fs.existsSync(FUNDAMENTALS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(FUNDAMENTALS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/** Save fundamentals to file. */
function saveFundamentals(data) {
  fs.writeFileSync(FUNDAMENTALS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ---------- API ----------

// Cached fundamentals (% held by inst, qtr earnings YoY)
app.get('/api/fundamentals', (req, res) => {
  try {
    res.json(loadFundamentals());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Fetch fundamentals from Yahoo for given tickers. Throttled, cached to data/fundamentals.json.
const FUNDAMENTALS_DELAY_MS = 200;
let lastFundamentalsFetch = 0;
app.post('/api/fundamentals/fetch', async (req, res) => {
  if (Date.now() - lastFundamentalsFetch < 5000) {
    return res.status(429).json({ error: 'Wait 5 seconds between fetch requests.' });
  }
  lastFundamentalsFetch = Date.now();

  const tickers = Array.isArray(req.body?.tickers) ? req.body.tickers : [];
  if (tickers.length === 0) {
    return res.status(400).json({ error: 'Provide tickers array in body.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const send = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
    res.flush?.();
  };

  const cached = loadFundamentals();
  const CACHE_TTL_FUND = 24 * 60 * 60 * 1000; // 24h

  for (let i = 0; i < tickers.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, FUNDAMENTALS_DELAY_MS));
    const ticker = String(tickers[i]).toUpperCase();
    const existing = cached[ticker];
    if (existing?.fetchedAt && Date.now() - new Date(existing.fetchedAt).getTime() < CACHE_TTL_FUND) {
      send({ ticker, ...existing, cached: true, index: i + 1, total: tickers.length });
      continue;
    }
    try {
      const f = await getFundamentals(ticker);
      const entry = {
        pctHeldByInst: f.pctHeldByInst,
        qtrEarningsYoY: f.qtrEarningsYoY,
        profitMargin: f.profitMargin,
        operatingMargin: f.operatingMargin,
        fetchedAt: new Date().toISOString(),
      };
      cached[ticker] = entry;
      send({ ticker, ...entry, index: i + 1, total: tickers.length });
    } catch (e) {
      send({ ticker, error: e.message, index: i + 1, total: tickers.length });
    }
  }
  saveFundamentals(cached);
  send({ done: true, total: tickers.length });
  res.end();
});

// Company name for ticker (shortName or longName from Yahoo quote)
app.get('/api/quote/:ticker', async (req, res) => {
  const { ticker } = req.params;
  if (!ticker) return res.status(400).json({ error: 'Ticker required.' });
  try {
    const name = await getQuoteName(ticker);
    res.json({ ticker, name });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Latest scan results (from file written by server/scan.js)
app.get('/api/scan-results', (req, res) => {
  try {
    if (!fs.existsSync(RESULTS_FILE)) {
      return res.json({ scannedAt: null, results: [], totalTickers: 0, vcpBullishCount: 0 });
    }
    const data = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Trigger scan: streams each ticker result as SSE. Throttled queue (1 ticker at a time) avoids rate limits.
let lastScanStarted = 0;
const SCAN_COOLDOWN_MS = 10 * 1000; // 10s between scan starts (allow new scan if previous finished)

app.post('/api/scan', async (req, res) => {
  if (Date.now() - lastScanStarted < SCAN_COOLDOWN_MS) {
    return res.status(429).json({ error: 'Scan already run recently. Wait a moment.' });
  }
  lastScanStarted = Date.now();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx: disable buffering
  res.flushHeaders?.();

  const send = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
    res.flush?.();
  };

  try {
    const { runScanStream } = await import('./scan.js');
    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - 90);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);

    const results = [];
    let vcpBullishCount = 0;

    for await (const { result, index, total } of runScanStream()) {
      results.push(result);
      if (result.vcpBullish) vcpBullishCount++;
      send({ result, index, total, vcpBullishCount });
      // Write partial results every 25 tickers (survives refresh)
      if (results.length % 25 === 0 || results.length === total) {
        const sorted = [...results].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        fs.writeFileSync(
          RESULTS_FILE,
          JSON.stringify(
            { scannedAt: new Date().toISOString(), from: fromStr, to: toStr, totalTickers: total, vcpBullishCount, results: sorted },
            null,
            2
          )
        );
      }
    }

    const sorted = results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    fs.writeFileSync(
      RESULTS_FILE,
      JSON.stringify(
        { scannedAt: new Date().toISOString(), from: fromStr, to: toStr, totalTickers: results.length, vcpBullishCount, results: sorted },
        null,
        2
      )
    );

    send({ done: true, total: results.length, vcpBullishCount });
  } catch (e) {
    console.error('Scan failed:', e);
    send({ error: e.message });
  } finally {
    res.end();
  }
});

// OHLC bars for a ticker. Query: days (default 180), interval (1d|1wk|1mo, default 1d).
app.get('/api/bars/:ticker', async (req, res) => {
  const { ticker } = req.params;
  // Handle interval: may be string, array (duplicate params), or missing; ensure valid value
  let interval = req.query.interval;
  if (Array.isArray(interval)) interval = interval[0];
  const intervalStr = String(interval || '').toLowerCase();
  interval = ['1d', '1wk', '1mo'].includes(intervalStr) ? intervalStr : '1d';
  let days = Number(req.query.days) || 180;
  // Weekly/monthly need longer range for enough bars
  if (interval === '1wk') days = Math.max(days, 730); // min 2y for weekly
  if (interval === '1mo') days = Math.max(days, 1825); // min 5y for monthly
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - days);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);

  let bars = getBarsFromFile(ticker, fromStr, toStr, interval);
  if (!bars) {
    try {
      bars = await getBars(ticker, fromStr, toStr, interval);
      saveBarsToFile(ticker, fromStr, toStr, bars, interval);
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }
  }
  res.json({ ticker, from: fromStr, to: toStr, interval, results: bars });
});

// VCP analysis for one ticker: bars from file cache or API, then compute VCP (not persisted separately)
app.get('/api/vcp/:ticker', async (req, res) => {
  const { ticker } = req.params;
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 90);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);

  try {
    let bars = getBarsFromFile(ticker, fromStr, toStr, '1d');
    if (!bars) {
      bars = await getBars(ticker, fromStr, toStr, '1d');
      saveBarsToFile(ticker, fromStr, toStr, bars, '1d');
    }
    const vcp = checkVCP(bars);
    res.json({ ticker, ...vcp, barCount: bars.length });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Optional: run full scan every 24 hours
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
function scheduleDailyScan() {
  setInterval(async () => {
    console.log('Running scheduled 24h VCP scan...');
    const { runScan } = await import('./scan.js');
    runScan().catch((e) => console.error('Scheduled scan failed:', e));
  }, TWENTY_FOUR_HOURS_MS);
}
if (process.env.SCHEDULE_SCAN === '1') {
  scheduleDailyScan();
  console.log('24h scan scheduler enabled (SCHEDULE_SCAN=1).');
}

// Serve built frontend when dist exists (e.g. after npm run build)
const DIST_DIR = path.join(__dirname, '..', 'dist');
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR, { index: false }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
  console.log('Serving static app from dist/');
}

app.listen(PORT, () => {
  console.log(`Stock screener at http://localhost:${PORT}`);
});
