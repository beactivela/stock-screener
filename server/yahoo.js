/**
 * Yahoo Finance — OHLC bars, fundamentals, quote name/exchange, earnings dates.
 * TradingView is used for ticker list and industry returns (server/tradingViewIndustry.js).
 * TradingView has no public OHLC API, so bars come from Yahoo. See docs/README.md.
 */

import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance();

/**
 * OHLC bars for a ticker. from/to = YYYY-MM-DD.
 * interval: '1d' | '1wk' | '1mo'. Returns array of { t, o, h, l, c, v } (t = ms).
 */
async function getBars(ticker, from, to, interval = '1d') {
  const result = await yahooFinance.chart(ticker, {
    period1: from,
    period2: to,
    interval: interval === '1wk' || interval === '1mo' ? interval : '1d',
  });
  const quotes = result?.quotes ?? [];
  return quotes
    .filter((q) => q.open != null && q.close != null)
    .map((q) => ({
      t: new Date(q.date).getTime(),
      o: q.open,
      h: q.high ?? q.close,
      l: q.low ?? q.close,
      c: q.close,
      v: q.volume ?? 0,
    }));
}

const getDailyBars = (ticker, from, to) => getBars(ticker, from, to, '1d');

/**
 * Fundamentals: % held by institutions, quarterly earnings YoY, profit margin, operating margin.
 * Uses quoteSummary with majorHoldersBreakdown, defaultKeyStatistics, earningsTrend, financialData.
 */
async function getFundamentals(ticker) {
  const result = await yahooFinance.quoteSummary(ticker, {
    modules: ['majorHoldersBreakdown', 'defaultKeyStatistics', 'earningsTrend', 'financialData', 'assetProfile', 'price'],
  });
  let pctHeldByInst = null;
  let qtrEarningsYoY = null;
  let profitMargin = null;
  let operatingMargin = null;

  // % of shares held by institutions (0-1 → display as %)
  const mhb = result?.majorHoldersBreakdown;
  if (mhb?.institutionsPercentHeld != null) {
    pctHeldByInst = Math.round(mhb.institutionsPercentHeld * 100 * 10) / 10;
  }
  if (pctHeldByInst == null && result?.defaultKeyStatistics?.heldPercentInstitutions != null) {
    pctHeldByInst = Math.round(result.defaultKeyStatistics.heldPercentInstitutions * 100 * 10) / 10;
  }

  // Quarterly earnings growth YoY (decimal → display as %)
  const dks = result?.defaultKeyStatistics;
  if (dks?.earningsQuarterlyGrowth != null) {
    qtrEarningsYoY = Math.round(dks.earningsQuarterlyGrowth * 100 * 10) / 10;
  }
  if (qtrEarningsYoY == null && result?.earningsTrend?.trend?.length) {
    const qtr = result.earningsTrend.trend.find((t) => t.period === '0q' || (t.period && t.period.endsWith('q')));
    if (qtr?.growth != null) qtrEarningsYoY = Math.round(qtr.growth * 100 * 10) / 10;
  }

  // Profit margin (decimal 0.25 = 25% → store as 25)
  if (dks?.profitMargins != null) {
    profitMargin = Math.round(dks.profitMargins * 100 * 10) / 10;
  }
  if (profitMargin == null && result?.financialData?.profitMargins != null) {
    profitMargin = Math.round(result.financialData.profitMargins * 100 * 10) / 10;
  }

  // Operating margin (decimal 0.30 = 30% → store as 30)
  const fd = result?.financialData;
  if (fd?.operatingMargins != null) {
    operatingMargin = Math.round(fd.operatingMargins * 100 * 10) / 10;
  }

  // Industry and sector from assetProfile (e.g. "Consumer Electronics", "Technology")
  const ap = result?.assetProfile;
  const industry = (ap?.industry && String(ap.industry).trim()) ? ap.industry : (ap?.sector && String(ap.sector).trim()) ? ap.sector : null;
  const sector = (ap?.sector && String(ap.sector).trim()) ? ap.sector : null;

  // Company name from price module (same call, no extra Yahoo request)
  const price = result?.price;
  const companyName = (price?.displayName && String(price.displayName).trim()) || (price?.shortName && String(price.shortName).trim()) || (price?.longName && String(price.longName).trim()) || null;

  return { ticker, pctHeldByInst, qtrEarningsYoY, profitMargin, operatingMargin, industry, sector, companyName };
}

/** Company name for display. Prefer displayName (e.g. "The Home Depot"), else shortName, else longName. */
async function getQuoteName(ticker) {
  const q = await yahooFinance.quote(ticker);
  return q?.displayName ?? q?.shortName ?? q?.longName ?? null;
}

/** Maps Yahoo exchange code to TradingView exchange prefix (NYSE, NASDAQ, AMEX). */
function mapExchange(ex) {
  const u = (ex ?? '').toUpperCase();
  if (u.includes('NYSE') || u === 'NYQ' || u === 'NYS') return 'NYSE';
  if (u.includes('NASDAQ') || u === 'NMS' || u === 'NGM' || u === 'NCM') return 'NASDAQ';
  if (u.includes('AMEX') || u === 'ASE') return 'AMEX';
  return null;
}

/** Quote info: name and exchange (for TradingView symbol). Single fetch. */
async function getQuoteInfo(ticker) {
  const q = await yahooFinance.quote(ticker);
  const name = q?.displayName ?? q?.shortName ?? q?.longName ?? null;
  const exchange = mapExchange(q?.exchange ?? q?.fullExchangeName);
  return { name, exchange };
}

/**
 * Fetch historical earnings announcement dates for a ticker.
 * Used by retroBacktest to avoid entering positions within 5 trading days of earnings,
 * which eliminates gap-down disasters caused by earnings surprises.
 *
 * Returns an array of timestamps (ms) for all historical earnings announcement dates.
 * Falls back to empty array on any error — signal still fires without earnings protection.
 *
 * @param {string} ticker - Stock ticker symbol
 * @returns {Promise<number[]>} Array of earnings date timestamps in milliseconds
 */
async function getEarningsDates(ticker) {
  try {
    const result = await yahooFinance.quoteSummary(ticker, {
      modules: ['earningsHistory', 'calendarEvents'],
    });

    const dates = [];

    // earningsHistory: past earnings reports
    const history = result?.earningsHistory?.history ?? [];
    for (const entry of history) {
      const dt = entry?.date ?? entry?.quarter;
      if (dt) {
        const ts = new Date(dt).getTime();
        if (!isNaN(ts)) dates.push(ts);
      }
    }

    // calendarEvents: upcoming earnings (if any)
    const earningsDates = result?.calendarEvents?.earnings?.earningsDate ?? [];
    for (const dt of earningsDates) {
      if (dt) {
        const ts = new Date(dt).getTime();
        if (!isNaN(ts)) dates.push(ts);
      }
    }

    return dates;
  } catch {
    // Fail silently — earnings filter is enhancement, not requirement
    return [];
  }
}

export { getBars, getDailyBars, getFundamentals, getQuoteName, getQuoteInfo, getEarningsDates };
