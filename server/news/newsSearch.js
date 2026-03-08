import { parseRssXml } from './marketNews.js';

const cache = new Map();

export function buildYahooRssUrl(ticker) {
  const symbol = encodeURIComponent(String(ticker || '').trim().toUpperCase());
  return `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${symbol}&region=US&lang=en-US`;
}

export function filterNewsByDate(items, date) {
  if (!date) return items;
  const start = new Date(`${date}T00:00:00.000Z`).getTime();
  const end = new Date(`${date}T24:00:00.000Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return items;

  return (items || []).filter((item) => {
    const ts = item?.publishedAt ? new Date(item.publishedAt).getTime() : NaN;
    return Number.isFinite(ts) && ts >= start && ts < end;
  });
}

function normalizeItems(items = []) {
  return items
    .filter((item) => item && item.title && item.url)
    .map((item) => ({
      title: String(item.title).trim(),
      url: String(item.url).trim(),
      publishedAt: item.publishedAt || null,
      source: item.source || 'yahoo-finance',
    }));
}

export async function fetchYahooTickerNews({ ticker, date, limit = 8, ttlMs = 5 * 60 * 1000 } = {}) {
  const cleanTicker = String(ticker || '').trim().toUpperCase();
  const cleanDate = String(date || '').trim();
  const cacheKey = `${cleanTicker}:${cleanDate}:${limit}`;
  const now = Date.now();

  const cached = cache.get(cacheKey);
  if (cached && now - cached.fetchedAt < ttlMs) {
    return cached.items.slice(0, limit);
  }

  const url = buildYahooRssUrl(cleanTicker);
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'stock-screener/1.0 (news-search)',
      Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8',
    },
  });
  if (!resp.ok) {
    throw new Error(`news_search_http_${resp.status}`);
  }
  const xml = await resp.text();
  const parsed = parseRssXml(xml, 'yahoo-finance');
  const filtered = filterNewsByDate(parsed, cleanDate);
  const normalized = normalizeItems(filtered);

  cache.set(cacheKey, { fetchedAt: now, items: normalized });
  return normalized.slice(0, limit);
}
