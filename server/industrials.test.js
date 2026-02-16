/**
 * Unit tests for Yahoo industries parser/fetcher.
 * Run: node --test server/industrials.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseIndustriesFromEmbeddedJson, fetchAllIndustriesFromYahoo } from './industrials.js';

function makeSectorHtml(sectorSlug, industries) {
  const body = JSON.stringify({ data: { industries } });
  const outer = JSON.stringify({ body });
  return `
    <html>
      <head>
        <script type="application/json" data-url="https://query1.finance.yahoo.com/v1/finance/sectors/${sectorSlug}?formatted=true&amp;withReturns=false&amp;lang=en-US&amp;region=US">${outer}</script>
      </head>
    </html>
  `;
}

describe('parseIndustriesFromEmbeddedJson', () => {
  it('extracts name, sector, key, symbol and ytdReturn', () => {
    const html = makeSectorHtml('technology', [
      {
        name: 'Semiconductors',
        key: 'semiconductors',
        symbol: '^YH31130020',
        ytdReturn: { raw: 0.012547095, fmt: '1.25%' },
      },
    ]);
    const parsed = parseIndustriesFromEmbeddedJson(html, 'technology');
    assert.equal(parsed?.length, 1);
    assert.deepEqual(parsed?.[0], {
      name: 'Semiconductors',
      ytdReturn: 1.25,
      key: 'semiconductors',
      symbol: '^YH31130020',
      sector: 'Technology',
      return6Mo: null,
      return1Y: null,
    });
  });
});

describe('fetchAllIndustriesFromYahoo', () => {
  it('includes index symbol for each parsed industry', async () => {
    const sectorSlugs = [
      'technology',
      'financial-services',
      'consumer-cyclical',
      'communication-services',
      'healthcare',
      'industrials',
      'consumer-defensive',
      'energy',
      'basic-materials',
      'utilities',
      'real-estate',
    ];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const match = String(url).match(/\/sectors\/([^/]+)\/$/);
      const sectorSlug = match?.[1] ?? 'technology';
      const idx = sectorSlugs.indexOf(sectorSlug);
      const html = makeSectorHtml(sectorSlug, [
        {
          name: `${sectorSlug}-industry`,
          key: `${sectorSlug}-industry`,
          symbol: `^YHTEST${idx}`,
          ytdReturn: { raw: 0.01, fmt: '1.00%' },
        },
      ]);
      return { ok: true, text: async () => html };
    };
    try {
      const result = await fetchAllIndustriesFromYahoo();
      assert.equal(result.source, 'yahoo');
      assert.equal(result.industries.length, 11);
      assert.ok(result.industries.every((i) => typeof i.symbol === 'string' && i.symbol.startsWith('^YHTEST')));
      assert.ok(result.industries.every((i) => typeof i.ytdReturn === 'number'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
