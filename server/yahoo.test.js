import { describe, it, before, after, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { normalizeChartWindow, getHistoryMetadata, getBars, getBarsBatch, getFundamentals, getFundamentalsBatch, __testing } from './yahoo.js';

describe('normalizeChartWindow', () => {
  it('keeps a valid ascending date range unchanged', () => {
    const window = normalizeChartWindow('2026-01-01', '2026-02-01');
    assert.equal(window.period1, '2026-01-01');
    assert.equal(window.period2, '2026-02-01');
  });

  it('bumps period2 by one day when period1 equals period2', () => {
    const window = normalizeChartWindow('2026-02-24', '2026-02-24');
    assert.equal(window.period1, '2026-02-24');
    assert.equal(window.period2, '2026-02-25');
  });

  it('bumps period2 by one day when period2 is before period1', () => {
    const window = normalizeChartWindow('2026-02-24', '2026-02-20');
    assert.equal(window.period1, '2026-02-24');
    assert.equal(window.period2, '2026-02-25');
  });
});

describe('getHistoryMetadata', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('normalizes chart metadata into a stable response shape', async () => {
    let receivedTicker = null;
    let receivedOptions = null;

    mock.method(__testing.yahooFinance, 'chart', async (ticker, options) => {
      receivedTicker = ticker;
      receivedOptions = options;
      return {
        meta: {
          symbol: 'AAPL',
          exchangeName: 'NMS',
          fullExchangeName: 'NasdaqGS',
          exchangeTimezoneName: 'America/New_York',
          exchangeTimezoneShortName: 'EST',
          instrumentType: 'EQUITY',
          currency: 'USD',
          gmtoffset: -18000,
          dataGranularity: '1d',
          validRanges: ['1d', '5d', '1mo'],
          firstTradeDate: 345479400,
          regularMarketTime: 1700000000,
        },
      };
    });

    const metadata = await getHistoryMetadata('aapl', '2026-02-24', '2026-02-24', 'bogus');

    assert.equal(receivedTicker, 'aapl');
    assert.deepEqual(receivedOptions, {
      period1: '2026-02-24',
      period2: '2026-02-25',
      interval: '1d',
    });
    assert.deepEqual(metadata, {
      ticker: 'AAPL',
      symbol: 'AAPL',
      period1: '2026-02-24',
      period2: '2026-02-25',
      interval: '1d',
      exchangeName: 'NMS',
      fullExchangeName: 'NasdaqGS',
      instrumentType: 'EQUITY',
      currency: 'USD',
      timezone: 'America/New_York',
      timezoneShortName: 'EST',
      gmtoffset: -18000,
      dataGranularity: '1d',
      validRanges: ['1d', '5d', '1mo'],
      firstTradeDateMs: 345479400000,
      regularMarketTimeMs: 1700000000000,
    });
  });

  it('normalizes missing metadata fields to null-friendly defaults', async () => {
    mock.method(__testing.yahooFinance, 'chart', async () => ({
      meta: {},
    }));

    const metadata = await getHistoryMetadata('msft', '2026-01-01', '2026-02-01', '1wk');

    assert.deepEqual(metadata, {
      ticker: 'MSFT',
      symbol: 'MSFT',
      period1: '2026-01-01',
      period2: '2026-02-01',
      interval: '1wk',
      exchangeName: null,
      fullExchangeName: null,
      instrumentType: null,
      currency: null,
      timezone: null,
      timezoneShortName: null,
      gmtoffset: null,
      dataGranularity: '1wk',
      validRanges: [],
      firstTradeDateMs: null,
      regularMarketTimeMs: null,
    });
  });

  it('throws a clear error when Yahoo returns no chart metadata', async () => {
    mock.method(__testing.yahooFinance, 'chart', async () => ({
      quotes: [],
    }));

    await assert.rejects(
      () => getHistoryMetadata('bad', '2026-01-01', '2026-02-01', '1d'),
      /No chart metadata returned for BAD/
    );
  });

  it('wraps upstream Yahoo errors with ticker context', async () => {
    mock.method(__testing.yahooFinance, 'chart', async () => {
      throw new Error('Symbol not found');
    });

    await assert.rejects(
      () => getHistoryMetadata('bad', '2026-01-01', '2026-02-01', '1d'),
      /Failed to fetch history metadata for BAD: Symbol not found/
    );
  });
});

describe('getBarsBatch', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('fetches multiple tickers through the shared v3 client and preserves request order', async () => {
    mock.method(__testing.yahooFinance, 'chart', async (ticker) => {
      if (ticker === 'BAD') throw new Error('Symbol not found');
      return {
        quotes: [
          {
            date: '2026-02-24T00:00:00.000Z',
            open: 100,
            high: 110,
            low: 95,
            close: ticker === 'AAPL' ? 105 : 205,
            volume: 123456,
          },
        ],
      };
    });

    const results = await getBarsBatch([
      { ticker: 'AAPL', from: '2026-02-01', to: '2026-02-24', interval: '1d' },
      { ticker: 'BAD', from: '2026-02-01', to: '2026-02-24', interval: '1d' },
      { ticker: 'MSFT', from: '2026-02-01', to: '2026-02-24', interval: '1wk' },
    ], { concurrency: 2 });

    assert.equal(results.length, 3);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[0].ticker, 'AAPL');
    assert.equal(results[0].bars[0].c, 105);

    assert.equal(results[1].status, 'rejected');
    assert.equal(results[1].ticker, 'BAD');
    assert.match(results[1].error, /Symbol not found/);

    assert.equal(results[2].status, 'fulfilled');
    assert.equal(results[2].ticker, 'MSFT');
    assert.equal(results[2].interval, '1wk');
  });
});

describe('getFundamentals company stats', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('extracts market cap, revenue, employees, EPS, and business summary from quoteSummary', async () => {
    mock.method(__testing.yahooFinance, 'quoteSummary', async () => ({
      majorHoldersBreakdown: { institutionsPercentHeld: 0.5 },
      defaultKeyStatistics: {
        earningsQuarterlyGrowth: 0.1,
        profitMargins: 0.2,
        marketCap: 12_500_000_000,
        trailingEps: 4.567,
      },
      financialData: {
        operatingMargins: 0.15,
        totalRevenue: 3_100_000_000,
      },
      earningsTrend: { trend: [] },
      assetProfile: {
        industry: 'Engineering & Construction',
        sector: 'Industrials',
        fullTimeEmployees: 1350,
        longBusinessSummary:
          'Argan, Inc., together with its subsidiaries, provides engineering, procurement, and construction services.',
      },
      price: {
        displayName: 'Argan',
        marketCap: 12_500_000_000,
      },
    }));

    const f = await getFundamentals('AGX');
    assert.equal(f.marketCap, 12_500_000_000);
    assert.equal(f.totalRevenue, 3_100_000_000);
    assert.equal(f.fullTimeEmployees, 1350);
    assert.equal(f.trailingEps, 4.57);
    assert.ok(f.businessSummary?.includes('Argan'));
  });
});

describe('getFundamentalsBatch', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('builds normalized fundamentals entries and tolerates quote lookup failure', async () => {
    mock.method(__testing.yahooFinance, 'quoteSummary', async (ticker) => {
      if (ticker === 'BAD') throw new Error('No fundamentals');
      return {
        majorHoldersBreakdown: { institutionsPercentHeld: 0.456 },
        defaultKeyStatistics: {
          earningsQuarterlyGrowth: 0.125,
          profitMargins: 0.225,
        },
        financialData: { operatingMargins: 0.315 },
        assetProfile: {
          industry: ticker === 'AAPL' ? 'Consumer Electronics' : 'Software',
          sector: 'Technology',
        },
        price: {
          displayName: `${ticker} Display`,
        },
      };
    });

    mock.method(__testing.yahooFinance, 'quote', async (ticker) => {
      if (ticker === 'MSFT') throw new Error('Quote lookup failed');
      return {
        displayName: `${ticker} Quote`,
        exchange: 'NMS',
      };
    });

    const results = await getFundamentalsBatch(['AAPL', 'MSFT', 'BAD'], { concurrency: 2 });

    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[0].ticker, 'AAPL');
    assert.equal(results[0].entry.companyName, 'AAPL Quote');
    assert.equal(results[0].entry.industry, 'Consumer Electronics');

    assert.equal(results[1].status, 'fulfilled');
    assert.equal(results[1].ticker, 'MSFT');
    assert.equal(results[1].entry.companyName, 'MSFT Display');
    assert.equal(results[1].entry.sector, 'Technology');

    assert.equal(results[2].status, 'rejected');
    assert.equal(results[2].ticker, 'BAD');
    assert.match(results[2].error, /No fundamentals/);
  });
});

describe('GET /api/history-metadata/:ticker', () => {
  let server;
  let baseUrl;

  before(async () => {
    process.env.SKIP_EXPRESS_LISTEN = '1';
    process.env.NODE_ENV = 'test';
    const { app } = await import('./index.js');
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
    delete process.env.SKIP_EXPRESS_LISTEN;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('returns normalized history metadata', async () => {
    mock.method(__testing.yahooFinance, 'chart', async () => ({
      meta: {
        symbol: 'AAPL',
        exchangeName: 'NMS',
        exchangeTimezoneName: 'America/New_York',
        exchangeTimezoneShortName: 'EST',
        instrumentType: 'EQUITY',
        currency: 'USD',
        gmtoffset: -18000,
        dataGranularity: '1wk',
        validRanges: ['1mo', '3mo'],
        firstTradeDate: 345479400,
        regularMarketTime: 1700000000,
      },
    }));

    const response = await fetch(`${baseUrl}/api/history-metadata/AAPL?days=30&interval=1wk`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ticker, 'AAPL');
    assert.equal(body.interval, '1wk');
    assert.equal(body.dataGranularity, '1wk');
    assert.deepEqual(body.validRanges, ['1mo', '3mo']);
  });

  it('returns a 502 when Yahoo metadata fetch fails', async () => {
    mock.method(__testing.yahooFinance, 'chart', async () => {
      throw new Error('Symbol not found');
    });

    const response = await fetch(`${baseUrl}/api/history-metadata/BAD?days=30`);
    const body = await response.json();

    assert.equal(response.status, 502);
    assert.match(body.error, /Failed to fetch history metadata for BAD: Symbol not found/);
  });
});

describe('yahoo-finance2 v3 guardrails', () => {
  it('keeps constructor-based client initialization and blocks legacy global config usage', () => {
    const source = fs.readFileSync(new URL('./yahoo.js', import.meta.url), 'utf8');
    assert.match(source, /new YahooFinance\(/);
    assert.doesNotMatch(source, /setGlobalConfig\(/);
    assert.doesNotMatch(source, /suppressNotices\[[^\]]+\]/);
  });
});

describe('yahoo-finance2 v3 live smoke (10 tickers)', () => {
  it('fetches recent daily bars for 10 liquid symbols', { timeout: 120000 }, async (t) => {
    if (!process.env.RUN_LIVE_YAHOO_TEST) {
      t.skip('Set RUN_LIVE_YAHOO_TEST=1 to run live Yahoo smoke tests.');
    }

    const tickers = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'JPM', 'XOM', 'UNH'];
    const to = new Date().toISOString().slice(0, 10);
    const fromDate = new Date();
    fromDate.setUTCDate(fromDate.getUTCDate() - 90);
    const from = fromDate.toISOString().slice(0, 10);

    for (const ticker of tickers) {
      const bars = await getBars(ticker, from, to, '1d');
      assert.ok(Array.isArray(bars), `${ticker}: expected bars array`);
      assert.ok(bars.length > 0, `${ticker}: expected at least one daily bar`);
      const first = bars[0];
      assert.equal(typeof first.t, 'number', `${ticker}: bar.t should be number`);
      assert.equal(typeof first.o, 'number', `${ticker}: bar.o should be number`);
      assert.equal(typeof first.h, 'number', `${ticker}: bar.h should be number`);
      assert.equal(typeof first.l, 'number', `${ticker}: bar.l should be number`);
      assert.equal(typeof first.c, 'number', `${ticker}: bar.c should be number`);
      assert.equal(typeof first.v, 'number', `${ticker}: bar.v should be number`);
    }
  });
});
