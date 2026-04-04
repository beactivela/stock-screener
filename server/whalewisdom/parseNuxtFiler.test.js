import assert from 'node:assert/strict';
import test from 'node:test';

import { parseFilerDataObject, parseWhalewisdomFilerFromHtml } from './parseNuxtFiler.js';

test('parseFilerDataObject maps top_holdings', () => {
  const fd = {
    name: 'Test Fund',
    permalink: 'test-slug',
    id: 42,
    summaries: {
      top_holdings: [
        { symbol: 'AAA', name: 'AAA Inc', percent_of_portfolio: 12.5, security_type: 'SH' },
      ],
    },
    current_quarter: { description: 'Q1 2099' },
  };
  const p = parseFilerDataObject(fd, 'test-slug');
  assert.equal(p.displayName, 'Test Fund');
  assert.equal(p.wwFilerId, 42);
  assert.equal(p.quarterLabel, 'Q1 2099');
  assert.equal(p.positions.length, 1);
  assert.equal(p.positions[0].ticker, 'AAA');
  assert.equal(p.positions[0].pctOfPortfolio, 12.5);
});

test('parseWhalewisdomFilerFromHtml reads JSON-assigned __NUXT__', () => {
  const nuxt = {
    data: {
      'options:asyncdata:test-slug': {
        filerdata: {
          name: 'Test Fund',
          permalink: 'test-slug',
          id: 1,
          summaries: {
            top_holdings: [
              { symbol: 'ZZZ', name: 'Zed', percent_of_portfolio: 5, security_type: 'SH' },
            ],
          },
          current_quarter: { description: 'Q2 2099' },
        },
      },
    },
  };
  const html = `<!DOCTYPE html><html><body><script>window.__NUXT__=${JSON.stringify(nuxt)}</script></body></html>`;
  const p = parseWhalewisdomFilerFromHtml(html, 'test-slug');
  assert.equal(p.positions[0].ticker, 'ZZZ');
  assert.equal(p.quarterLabel, 'Q2 2099');
});
