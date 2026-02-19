/**
 * Regime HMM data layer: fetch and persist 5 years of SPY and QQQ daily bars
 * for Hidden Markov Model training. Uses existing Yahoo getDailyBars; chunks
 * requests if needed (Yahoo may limit single request size).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDailyBars } from './yahoo.js';
import { getSupabase, isSupabaseConfigured } from './supabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const REGIME_DIR = path.join(DATA_DIR, 'regime');

/** Chunk size in calendar days (≈2 years) to stay under typical API limits */
const CHUNK_DAYS = 730;

/**
 * Ensure data/regime directory exists.
 */
function ensureRegimeDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(REGIME_DIR)) fs.mkdirSync(REGIME_DIR, { recursive: true });
}

/**
 * Fetch bars for a ticker over a long range by chunking.
 * @param {string} ticker - e.g. 'SPY' or 'QQQ'
 * @param {string} from - YYYY-MM-DD
 * @param {string} to - YYYY-MM-DD
 * @returns {Promise<Array<{t: number, o: number, h: number, l: number, c: number, v: number}>>}
 */
async function fetchBarsChunked(ticker, from, to) {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  const allBars = [];
  let currentStart = new Date(fromDate);

  while (currentStart < toDate) {
    const chunkEnd = new Date(currentStart);
    chunkEnd.setDate(chunkEnd.getDate() + CHUNK_DAYS);
    const chunkTo = chunkEnd > toDate ? toDate : chunkEnd;
    const fromStr = currentStart.toISOString().slice(0, 10);
    const toStr = chunkTo.toISOString().slice(0, 10);
    const bars = await getDailyBars(ticker, fromStr, toStr);
    if (bars.length === 0) break;
    // Dedupe by t (in case of overlap)
    for (const b of bars) {
      if (allBars.length === 0 || b.t > allBars[allBars.length - 1].t) allBars.push(b);
    }
    currentStart = new Date(chunkTo);
    currentStart.setDate(currentStart.getDate() + 1);
  }

  return allBars.sort((a, b) => a.t - b.t);
}

/**
 * Get 5-year date range ending today (or optional end date).
 * @param {Date} [endDate] - End date (default: today)
 * @returns {{ from: string, to: string }}
 */
function fiveYearRange(endDate = new Date()) {
  const to = new Date(endDate);
  const from = new Date(to);
  from.setFullYear(from.getFullYear() - 5);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

/**
 * Fetch 5 years of daily bars for SPY and QQQ and save to data/regime/.
 * Files: spy_5y.json, qqq_5y.json. Each has { ticker, from, to, fetchedAt, results }.
 * @param {Date} [asOfDate] - End date for range (default: today)
 * @returns {Promise<{ spy: Array, qqq: Array }>}
 */
export async function fetchAndSaveRegimeData(asOfDate = new Date()) {
  ensureRegimeDir();
  const { from, to } = fiveYearRange(asOfDate);

  const [spyBars, qqqBars] = await Promise.all([
    fetchBarsChunked('SPY', from, to),
    fetchBarsChunked('QQQ', from, to),
  ]);

  const fetchedAt = new Date().toISOString();
  const payload = (ticker, bars) => ({ ticker, from, to, fetchedAt, results: bars });
  if (isSupabaseConfigured()) {
    const supabase = getSupabase();
    await supabase.from('regime_bars').upsert(
      [{ ticker: 'SPY', date_from: from, date_to: to, fetched_at: fetchedAt, results: spyBars, updated_at: fetchedAt }, { ticker: 'QQQ', date_from: from, date_to: to, fetched_at: fetchedAt, results: qqqBars, updated_at: fetchedAt }],
      { onConflict: 'ticker' }
    );
  }
  ensureRegimeDir();
  fs.writeFileSync(path.join(REGIME_DIR, 'spy_5y.json'), JSON.stringify(payload('SPY', spyBars), null, 2), 'utf8');
  fs.writeFileSync(path.join(REGIME_DIR, 'qqq_5y.json'), JSON.stringify(payload('QQQ', qqqBars), null, 2), 'utf8');
  return { spy: spyBars, qqq: qqqBars };
}

/**
 * Load cached 5y bars from DB or data/regime (if present).
 * @returns {Promise<{ spy: Array, qqq: Array } | null>} - null if either missing
 */
export async function loadRegimeData() {
  if (isSupabaseConfigured()) {
    const supabase = getSupabase();
    const { data: spyRow } = await supabase.from('regime_bars').select('*').eq('ticker', 'SPY').single();
    const { data: qqqRow } = await supabase.from('regime_bars').select('*').eq('ticker', 'QQQ').single();
    if (!spyRow || !qqqRow) return null;
    return { spy: spyRow.results || [], qqq: qqqRow.results || [] };
  }
  const spyPath = path.join(REGIME_DIR, 'spy_5y.json');
  const qqqPath = path.join(REGIME_DIR, 'qqq_5y.json');
  if (!fs.existsSync(spyPath) || !fs.existsSync(qqqPath)) return null;
  const spy = JSON.parse(fs.readFileSync(spyPath, 'utf8'));
  const qqq = JSON.parse(fs.readFileSync(qqqPath, 'utf8'));
  return { spy: spy.results || [], qqq: qqq.results || [] };
}

export { REGIME_DIR, fiveYearRange };
