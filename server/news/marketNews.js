import { load } from 'cheerio';

/**
 * Parse an RSS XML string into normalized items.
 *
 * Output shape is intentionally small and UI-friendly:
 *   { title, url, publishedAt, source }
 */
export function parseRssXml(xml, source = 'rss') {
  if (!xml || typeof xml !== 'string') return [];

  const $ = load(xml, { xmlMode: true });
  const items = [];

  $('item').each((_, el) => {
    const title = $(el).find('title').first().text().trim();
    const url =
      $(el).find('link').first().text().trim() ||
      $(el).find('guid').first().text().trim();
    const pubDateRaw = $(el).find('pubDate').first().text().trim();

    if (!title || !url) return;

    const publishedAt = pubDateRaw ? new Date(pubDateRaw).toISOString() : null;
    items.push({
      title,
      url,
      publishedAt,
      source,
    });
  });

  return items;
}

const DEFAULT_FEEDS = [
  {
    source: 'yahoo-finance-spy',
    url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EGSPC&region=US&lang=en-US',
  },
  {
    source: 'yahoo-finance-qqq',
    url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EIXIC&region=US&lang=en-US',
  },
];

let cache = {
  fetchedAtMs: 0,
  items: [],
};

/**
 * Fetch top market news from free RSS feeds.
 * Uses a small in-memory cache to avoid hammering upstream sources.
 */
export async function fetchMarketNews({ limit = 8, ttlMs = 5 * 60 * 1000 } = {}) {
  const now = Date.now();
  if (cache.items.length > 0 && now - cache.fetchedAtMs < ttlMs) {
    return cache.items.slice(0, limit);
  }

  const results = await Promise.allSettled(
    DEFAULT_FEEDS.map(async (feed) => {
      const resp = await fetch(feed.url, {
        headers: {
          // Some RSS hosts respond differently without UA
          'User-Agent': 'stock-screener/1.0 (Marcus)',
          Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8',
        },
      });
      if (!resp.ok) throw new Error(`news_feed_http_${resp.status}`);
      const xml = await resp.text();
      return parseRssXml(xml, feed.source);
    })
  );

  const merged = [];
  for (const r of results) {
    if (r.status === 'fulfilled') merged.push(...r.value);
  }

  // Deduplicate by URL (preferred) then by title
  const byKey = new Map();
  for (const item of merged) {
    const key = item.url || item.title;
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, item);
  }

  const items = Array.from(byKey.values())
    .sort((a, b) => {
      const da = a.publishedAt ? Date.parse(a.publishedAt) : 0;
      const db = b.publishedAt ? Date.parse(b.publishedAt) : 0;
      return db - da;
    })
    .slice(0, limit);

  cache = { fetchedAtMs: now, items };
  return items;
}

