import test from 'node:test';
import assert from 'node:assert/strict';
import { buildYahooRssUrl, filterNewsByDate } from '../news/newsSearch.js';

test('buildYahooRssUrl builds Yahoo Finance RSS', () => {
  assert.equal(
    buildYahooRssUrl('LSCC'),
    'https://feeds.finance.yahoo.com/rss/2.0/headline?s=LSCC&region=US&lang=en-US'
  );
});

test('filterNewsByDate keeps only the target date (UTC)', () => {
  const items = [
    { title: 'A', publishedAt: '2025-09-19T14:00:00.000Z' },
    { title: 'B', publishedAt: '2025-09-18T23:59:59.000Z' },
    { title: 'C', publishedAt: '2025-09-19T00:00:00.000Z' },
    { title: 'D', publishedAt: '2025-09-20T00:00:00.000Z' },
  ];

  const filtered = filterNewsByDate(items, '2025-09-19');
  assert.deepEqual(
    filtered.map((i) => i.title),
    ['A', 'C']
  );
});
