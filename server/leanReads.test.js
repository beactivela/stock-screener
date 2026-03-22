import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFundamentalsSelectClause,
  projectFundamentalsEntry,
} from './db/fundamentals.js';
import {
  mapScanResultSummaryRow,
  buildScanTickerNav,
} from './db/scanResults.js';
import {
  applyTradeQuery,
} from './trades.js';

describe('lean fundamentals helpers', () => {
  it('builds a projected select clause without raw json', () => {
    const select = buildFundamentalsSelectClause({
      fields: ['companyName', 'industry', 'profitMargin'],
      includeRaw: false,
    });

    assert.equal(select, 'ticker,company_name,industry,profit_margin');
    assert.equal(select.includes('raw'), false);
  });

  it('projects only the requested entry fields', () => {
    const projected = projectFundamentalsEntry(
      {
        pctHeldByInst: 78.2,
        qtrEarningsYoY: 41.5,
        profitMargin: 21.4,
        operatingMargin: 18.8,
        industry: 'Semiconductors',
        sector: 'Technology',
        companyName: 'NVIDIA Corp',
        fetchedAt: '2026-03-08T10:00:00.000Z',
        trailingPE: 44.3,
      },
      ['companyName', 'industry', 'profitMargin'],
    );

    assert.deepEqual(projected, {
      companyName: 'NVIDIA Corp',
      industry: 'Semiconductors',
      profitMargin: 21.4,
    });
  });
});

describe('lean scan summary helpers', () => {
  it('maps stored scan row columns to a summary payload', () => {
    const summary = mapScanResultSummaryRow({
      ticker: 'NVDA',
      vcp_bullish: true,
      contractions: 4,
      last_close: 913.27,
      relative_strength: 98,
      score: 87,
      enhanced_score: 94,
      industry_name: 'Semiconductors',
      industry_rank: 3,
    });

    assert.deepEqual(summary, {
      ticker: 'NVDA',
      vcpBullish: true,
      contractions: 4,
      lastClose: 913.27,
      relativeStrength: 98,
      score: 87,
      enhancedScore: 94,
      industryName: 'Semiconductors',
      industryRank: 3,
    });
  });

  it('builds ticker nav rows from lean scan data and actionable buys', () => {
    const nav = buildScanTickerNav({
      results: [
        { ticker: 'AMD', enhancedScore: 84, relativeStrength: 91, industryRank: 14 },
        { ticker: 'NVDA', enhancedScore: 94, relativeStrength: 98, industryRank: 3 },
      ],
      actionableBuyTickers: new Set(['NVDA']),
    });

    assert.deepEqual(nav, [
      { ticker: 'NVDA', score: 94, relativeStrength: 98, industryRank: 3, hasActionableBuy: true },
      { ticker: 'AMD', score: 84, relativeStrength: 91, industryRank: 14, hasActionableBuy: false },
    ]);
  });
});

describe('ticker-scoped trade queries', () => {
  it('filters and paginates trades without loading unrelated history into the response', () => {
    const trades = [
      { id: '1', ticker: 'NVDA', status: 'open', createdAt: '2026-03-01T00:00:00.000Z' },
      { id: '2', ticker: 'NVDA', status: 'closed', createdAt: '2026-02-01T00:00:00.000Z' },
      { id: '3', ticker: 'AMD', status: 'closed', createdAt: '2026-01-01T00:00:00.000Z' },
    ];

    const filtered = applyTradeQuery(trades, {
      ticker: 'nvda',
      status: 'closed',
      limit: 1,
    });

    assert.deepEqual(filtered, [
      { id: '2', ticker: 'NVDA', status: 'closed', createdAt: '2026-02-01T00:00:00.000Z' },
    ]);
  });
});
