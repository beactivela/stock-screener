/**
 * DEPRECATED: Not used. Data is TradingView (tickers, industry) + Yahoo (OHLC bars).
 * Kept for reference only. Remove this file if you do not need Massive.
 *
 * Massive API client – all calls use server-side API key.
 * Base URL: https://api.massive.com
 * Docs: https://massive.com/docs/rest/stocks/aggregates/custom-bars
 */

const BASE = 'https://api.massive.com';

function getApiKey() {
  const key = process.env.MASSIVE_API_KEY || process.env.VITE_MASSIVE_API_KEY;
  if (!key) throw new Error('MASSIVE_API_KEY or VITE_MASSIVE_API_KEY required');
  return key;
}

export function isMassiveConfigured() {
  return !!(process.env.MASSIVE_API_KEY || process.env.VITE_MASSIVE_API_KEY);
}

function url(path, params = {}) {
  const key = getApiKey();
  const search = new URLSearchParams({ ...params, apiKey: key });
  const sep = path.includes('?') ? '&' : '?';
  return `${BASE}${path}${sep}${search}`;
}

/** Normalize ticker for Massive: ^GSPC (Yahoo index) → SPY for S&P 500 bars. */
function normalizeTicker(ticker) {
  const t = (ticker || '').trim().toUpperCase();
  if (t === '^GSPC') return 'SPY';
  return ticker;
}

/**
 * OHLC bars for a ticker. from/to = YYYY-MM-DD.
 * interval: '1d' | '1wk' | '1mo'. Returns array of { t, o, h, l, c, v } (t = ms).
 */
async function getBars(ticker, from, to, interval = '1d') {
  const sym = normalizeTicker(ticker);
  const timespan = interval === '1wk' ? 'week' : interval === '1mo' ? 'month' : 'day';
  const path = `/v2/aggs/ticker/${encodeURIComponent(sym)}/range/1/${timespan}/${from}/${to}`;
  const res = await fetch(url(path, { sort: 'asc', limit: 5000 }));
  if (!res.ok) throw new Error(`Massive bars: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const raw = data.results || [];
  return raw.map((r) => ({ t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v ?? 0 }));
}

/**
 * Daily OHLC for a ticker. from/to = YYYY-MM-DD.
 */
async function getDailyBars(ticker, from, to) {
  return getBars(ticker, from, to, '1d');
}

/**
 * ETF constituents (e.g. SPY, IWM). Paginate with next_url if needed.
 */
async function getEtfConstituents(compositeTicker, limit = 5000) {
  const path = '/etf-global/v1/constituents';
  const res = await fetch(url(path, { composite_ticker: compositeTicker, limit, sort: 'constituent_ticker.asc' }));
  if (!res.ok) throw new Error(`Massive ETF: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const list = data.results || [];
  if (data.next_url) {
    const next = await fetch(data.next_url.replace(BASE, BASE) + (data.next_url.includes('?') ? '&' : '?') + 'apiKey=' + getApiKey());
    const nextData = await next.json();
    return [...list, ...(nextData.results || [])];
  }
  return list;
}

/**
 * Dividends reference (optional). Your URL used apiKey in query.
 */
async function getDividends(params = {}) {
  const path = '/v3/reference/dividends';
  const res = await fetch(url(path, { limit: 100, ...params }));
  if (!res.ok) throw new Error(`Massive dividends: ${res.status}`);
  const data = await res.json();
  return data.results || [];
}

export {
  getApiKey,
  getBars,
  getDailyBars,
  getEtfConstituents,
  getDividends,
  normalizeTicker,
};
