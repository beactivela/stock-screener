import fs from 'fs/promises';
import path from 'path';

import { loadTickers } from './db/tickers.js';
import { loadFundamentals, saveFundamentals } from './db/fundamentals.js';
import { getBarsBatch } from './db/bars.js';
import { getFundamentalsBatch, getQuoteInfo } from './yahoo.js';

function toDateStr(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mean(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const nums = values.map(toNum).filter((n) => n != null);
  if (nums.length === 0) return null;
  return nums.reduce((sum, v) => sum + v, 0) / nums.length;
}

function median(values) {
  const nums = (values || []).map(toNum).filter((n) => n != null).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  if (nums.length % 2) return nums[mid];
  return (nums[mid - 1] + nums[mid]) / 2;
}

function maxInRange(bars, start, end, field = 'h') {
  let out = -Infinity;
  for (let i = start; i <= end; i++) {
    if (i < 0 || i >= bars.length) continue;
    const value = toNum(bars[i]?.[field]);
    if (value != null && value > out) out = value;
  }
  return Number.isFinite(out) ? out : null;
}

function minInRange(bars, start, end, field = 'c') {
  let out = Infinity;
  for (let i = start; i <= end; i++) {
    if (i < 0 || i >= bars.length) continue;
    const value = toNum(bars[i]?.[field]);
    if (value != null && value < out) out = value;
  }
  return Number.isFinite(out) ? out : null;
}

function smaAt(bars, index, length, field = 'c') {
  if (index - length + 1 < 0) return null;
  let sum = 0;
  let count = 0;
  for (let i = index - length + 1; i <= index; i++) {
    const value = toNum(bars[i]?.[field]);
    if (value == null) continue;
    sum += value;
    count += 1;
  }
  if (count !== length) return null;
  return sum / length;
}

function avgVolumeAt(bars, index, length = 50) {
  return smaAt(bars, index, length, 'v');
}

function slopePct(current, prior) {
  if (!Number.isFinite(current) || !Number.isFinite(prior) || prior === 0) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

function inferNarrativeTags(entry = {}) {
  const text = [
    entry.industry,
    entry.sector,
    entry.businessSummary,
    entry.companyName,
  ].filter(Boolean).join(' ').toLowerCase();

  const tags = [];
  const keywordMap = [
    ['ai', /\b(ai|artificial intelligence|machine learning|gpu|semiconductor)\b/],
    ['biotech', /\b(biotech|biotechnology|drug|clinical trial|therapeutic)\b/],
    ['cybersecurity', /\b(cybersecurity|security software|endpoint|identity)\b/],
    ['cloud_saas', /\b(cloud|saas|subscription software|platform)\b/],
    ['ev_energy', /\b(ev|electric vehicle|battery|solar|renewable|energy storage)\b/],
    ['fintech', /\b(fintech|payment|digital banking|financial technology)\b/],
    ['consumer_rebound', /\b(retail|consumer|e-commerce|travel|hospitality)\b/],
    ['industrial_capex', /\b(automation|industrial|infrastructure|manufacturing|aerospace)\b/],
    ['defense', /\b(defense|military|aerospace and defense)\b/],
    ['turnaround', /\b(restructuring|turnaround|cost reduction|spin-off)\b/],
    ['rate_sensitive', /\b(real estate|mortgage|rate|financing)\b/],
  ];
  for (const [tag, regex] of keywordMap) {
    if (regex.test(text)) tags.push(tag);
  }
  return tags.length > 0 ? tags : ['uncategorized'];
}

export function detectBreakoutCandidates(bars, options = {}) {
  const {
    periodStart,
    periodEnd,
    pivotLookback = 65,
    highLookback52w = 252,
    volumeLookback = 50,
    volumeMultiplier = 1.5,
    minCloseLookback = 20,
    minPrice = 10,
    minBarsAfterBreakout = 1,
    min52wHistoryBars = 126,
  } = options;

  if (!Array.isArray(bars) || bars.length === 0) return [];

  const out = [];
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    if (!bar?.t) continue;
    const day = toDateStr(bar.t);
    if (periodStart && day < periodStart) continue;
    if (periodEnd && day > periodEnd) continue;
    if (i < Math.max(pivotLookback, volumeLookback, minCloseLookback, 100)) continue;
    if (i < min52wHistoryBars) continue;

    const close = toNum(bar.c);
    const priorClose = toNum(bars[i - 1]?.c);
    const vol = toNum(bar.v);
    if (close == null || priorClose == null || vol == null) continue;

    const preMinClose = minInRange(bars, i - minCloseLookback, i - 1, 'c');
    const passesMinPrice20d = preMinClose != null && preMinClose >= minPrice;
    if (!passesMinPrice20d) continue;

    const pivotHigh = maxInRange(bars, i - pivotLookback, i - 1, 'h');
    const lookback52w = Math.min(highLookback52w, i);
    const high52w = maxInRange(bars, i - lookback52w, i - 1, 'h');
    const volAvg50 = avgVolumeAt(bars, i - 1, volumeLookback);
    if (pivotHigh == null || high52w == null || volAvg50 == null || volAvg50 <= 0) continue;

    const breakoutOverPivot = close > pivotHigh && priorClose <= pivotHigh;
    const breakoutOver52w = close > high52w;
    const volumeConfirmed = vol >= volAvg50 * volumeMultiplier;
    if (!(breakoutOverPivot && breakoutOver52w && volumeConfirmed)) continue;

    const periodEndIndex = (() => {
      if (!periodEnd) return bars.length - 1;
      let idx = i;
      for (let j = i; j < bars.length; j++) {
        if (toDateStr(bars[j].t) <= periodEnd) idx = j;
        else break;
      }
      return idx;
    })();
    if (periodEndIndex - i < minBarsAfterBreakout) continue;

    const peakPrice = maxInRange(bars, i, periodEndIndex, 'h');
    if (peakPrice == null || peakPrice <= 0) continue;
    const gainPct = ((peakPrice - close) / close) * 100;

    const sma20 = smaAt(bars, i, 20);
    const sma50 = smaAt(bars, i, 50);
    const sma100 = smaAt(bars, i, 100);
    const sma150 = smaAt(bars, i, 150);
    const sma200 = smaAt(bars, i, 200);
    const sma50Prev20 = smaAt(bars, i - 20, 50);
    const sma200Prev20 = smaAt(bars, i - 20, 200);

    out.push({
      breakoutIndex: i,
      breakoutDate: day,
      startPrice: close,
      pivotHigh,
      high52w,
      volume: vol,
      volumeAvg50: volAvg50,
      volumeRatio: volAvg50 > 0 ? vol / volAvg50 : null,
      preBreakout20dMinClose: preMinClose,
      passesMinPrice20d,
      peakPrice,
      peakDate: toDateStr(bars.slice(i, periodEndIndex + 1).reduce((best, cur) => (toNum(cur.h) > toNum(best.h) ? cur : best), bars[i]).t),
      gainPct,
      sma20,
      sma50,
      sma100,
      sma150,
      sma200,
      aboveSma20: sma20 != null ? close > sma20 : null,
      aboveSma50: sma50 != null ? close > sma50 : null,
      aboveSma100: sma100 != null ? close > sma100 : null,
      aboveSma150: sma150 != null ? close > sma150 : null,
      aboveSma200: sma200 != null ? close > sma200 : null,
      slopeSma50Pct20d: slopePct(sma50, sma50Prev20),
      slopeSma200Pct20d: slopePct(sma200, sma200Prev20),
    });
  }
  return out;
}

export function selectBestBreakout(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    if ((b.gainPct ?? -Infinity) !== (a.gainPct ?? -Infinity)) return (b.gainPct ?? -Infinity) - (a.gainPct ?? -Infinity);
    return (a.breakoutIndex ?? Infinity) - (b.breakoutIndex ?? Infinity);
  })[0];
}

export function buildCharacteristicsSummary(rows = []) {
  const setups = rows.map((row) => row?.setup).filter(Boolean);
  const total = setups.length;
  const count = (predicate) => setups.filter(predicate).length;

  const exchangeBreakdown = {};
  for (const row of rows) {
    const ex = row?.exchange || 'UNKNOWN';
    exchangeBreakdown[ex] = (exchangeBreakdown[ex] || 0) + 1;
  }

  const narrativeBreakdown = {};
  for (const row of rows) {
    for (const tag of row?.narrativeTags || []) {
      narrativeBreakdown[tag] = (narrativeBreakdown[tag] || 0) + 1;
    }
  }

  return {
    total,
    exchangeBreakdown,
    narrativeBreakdown,
    pctAboveSma20: total ? Math.round((count((s) => s.aboveSma20) / total) * 100) : 0,
    pctAboveSma50: total ? Math.round((count((s) => s.aboveSma50) / total) * 100) : 0,
    pctAboveSma100: total ? Math.round((count((s) => s.aboveSma100) / total) * 100) : 0,
    pctQtrEarningsYoYAbove25: total
      ? Math.round((count((s) => toNum(s.qtrEarningsYoY) != null && toNum(s.qtrEarningsYoY) > 25) / total) * 100)
      : 0,
    medianStartPrice: median(setups.map((s) => s.startPrice)),
    medianGainPct: median(setups.map((s) => s.gainPct)),
    avgVolumeRatio: mean(setups.map((s) => s.volumeRatio)),
  };
}

function buildPeriods(now = new Date()) {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const trailingEnd = `${yyyy}-${mm}-${dd}`;
  const trailingStartDate = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate()));
  const trailingStart = trailingStartDate.toISOString().slice(0, 10);
  return [
    { key: '2023', start: '2023-01-01', end: '2023-12-31' },
    { key: '2024', start: '2024-01-01', end: '2024-12-31' },
    { key: '2025', start: '2025-01-01', end: '2025-12-31' },
    { key: 'trailing12m', start: trailingStart, end: trailingEnd },
  ];
}

function lookbackStartForPeriods(periods, extraDays = 420) {
  const earliest = [...periods].sort((a, b) => (a.start < b.start ? -1 : 1))[0];
  const d = new Date(`${earliest.start}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - extraDays);
  return d.toISOString().slice(0, 10);
}

function nowDateStr() {
  return new Date().toISOString().slice(0, 10);
}

function deriveConfidence(setup, fundamentals) {
  let score = 0;
  if (setup?.aboveSma20 != null && setup?.aboveSma50 != null && setup?.aboveSma100 != null) score += 1;
  if (toNum(setup?.volumeRatio) != null) score += 1;
  if (fundamentals?.industry) score += 1;
  if (toNum(fundamentals?.qtrEarningsYoY) != null) score += 1;
  if (fundamentals?.businessSummary) score += 1;
  if (score >= 5) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

async function loadBarsForUniverse(tickers, from, to, options = {}) {
  const chunkSize = Math.max(50, Number(options.chunkSize) || 200);
  const concurrency = Math.max(1, Number(options.concurrency) || 8);
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const byTicker = new Map();
  let processed = 0;

  for (let i = 0; i < tickers.length; i += chunkSize) {
    const chunk = tickers.slice(i, i + chunkSize);
    const requests = chunk.map((ticker) => ({ ticker, from, to, interval: '1d' }));
    const rows = await getBarsBatch(requests, { concurrency });
    for (const row of rows || []) {
      if (row?.status === 'fulfilled' && row?.ticker && Array.isArray(row?.bars) && row.bars.length > 0) {
        byTicker.set(row.ticker, row.bars);
      }
      processed += 1;
      if (onProgress && processed % 100 === 0) {
        onProgress({
          stage: 'bars',
          processed,
          total: tickers.length,
          loaded: byTicker.size,
        });
      }
    }
  }

  if (onProgress) {
    onProgress({
      stage: 'bars',
      processed: tickers.length,
      total: tickers.length,
      loaded: byTicker.size,
    });
  }
  return byTicker;
}

async function hydrateFundamentalsForTickers(tickers) {
  const fromDb = await loadFundamentals({ tickers, includeRaw: true });
  const missing = tickers.filter((ticker) => !fromDb[ticker]);
  if (missing.length === 0) return fromDb;

  const fetched = await getFundamentalsBatch(missing, { concurrency: 6 });
  const toSave = {};
  for (const row of fetched || []) {
    if (row?.status === 'fulfilled' && row?.ticker && row?.entry) {
      toSave[row.ticker] = row.entry;
      fromDb[row.ticker] = row.entry;
    }
  }
  if (Object.keys(toSave).length > 0) {
    await saveFundamentals(toSave);
  }
  return fromDb;
}

function buildMarkdownReport(study) {
  const lines = [];
  lines.push('# Top 100 Breakout Gainers Study (US/NASDAQ)');
  lines.push('');
  lines.push(`Generated: ${study.generatedAt}`);
  lines.push(`Universe size analyzed: ${study.meta.universeCount}`);
  lines.push('');

  for (const period of study.periods) {
    lines.push(`## ${period.key}`);
    lines.push(`- Winners captured: ${period.top100.length}`);
    lines.push(`- Nasdaq names: ${period.summary.exchangeBreakdown.NASDAQ || 0}`);
    lines.push(`- Median start price: ${period.summary.medianStartPrice ?? 'n/a'}`);
    lines.push(`- Median gain %: ${period.summary.medianGainPct ?? 'n/a'}`);
    lines.push(`- % above SMA20: ${period.summary.pctAboveSma20}%`);
    lines.push(`- % above SMA50: ${period.summary.pctAboveSma50}%`);
    lines.push(`- % above SMA100: ${period.summary.pctAboveSma100}%`);
    lines.push(`- % qtr EPS YoY > 25: ${period.summary.pctQtrEarningsYoYAbove25}%`);
    lines.push('');
    lines.push('Top 10 tickers by breakout gain:');
    lines.push('');
    lines.push('| Ticker | Exchange | Breakout | Start | Peak | Gain % | Industry | qtr EPS YoY | Tags |');
    lines.push('|---|---|---:|---:|---:|---:|---|---:|---|');
    for (const row of period.top100.slice(0, 10)) {
      lines.push(`| ${row.ticker} | ${row.exchange || 'UNKNOWN'} | ${row.setup.breakoutDate} | ${row.setup.startPrice.toFixed(2)} | ${row.setup.peakPrice.toFixed(2)} | ${row.setup.gainPct.toFixed(2)} | ${row.industry || 'n/a'} | ${row.setup.qtrEarningsYoY ?? 'n/a'} | ${(row.narrativeTags || []).join(', ')} |`);
    }
    lines.push('');
  }

  lines.push('## Cross-Period Recurring Traits');
  lines.push('');
  lines.push(`- Tickers appearing in 2+ cohorts: ${study.crossPeriod.repeaters.length}`);
  lines.push(`- Most common industries: ${study.crossPeriod.topIndustries.map((x) => `${x.industry} (${x.count})`).join(', ') || 'n/a'}`);
  lines.push(`- Most common narratives: ${study.crossPeriod.topNarratives.map((x) => `${x.tag} (${x.count})`).join(', ') || 'n/a'}`);
  lines.push('');
  lines.push('## Method Notes');
  lines.push('');
  lines.push('- Breakout definition: close above both 65-day pivot high and prior 52-week high, with volume >= 1.5x 50-day average.');
  lines.push('- Price filter: lowest close in prior 20 sessions must be >= $10.');
  lines.push('- Ranking: best realized gain from breakout close to highest post-breakout high within period.');
  lines.push('- Data quality confidence: high/medium/low based on technical + fundamental field completeness.');

  return `${lines.join('\n')}\n`;
}

function topCounts(mapLike, topN = 10, field = 'tag') {
  const entries = Object.entries(mapLike || {});
  return entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([key, count]) => ({ [field]: key, count }));
}

function computeCrossPeriodStats(periods) {
  const tickerCount = {};
  const industryCount = {};
  const narrativeCount = {};

  for (const period of periods) {
    for (const row of period.top100 || []) {
      tickerCount[row.ticker] = (tickerCount[row.ticker] || 0) + 1;
      if (row.industry) industryCount[row.industry] = (industryCount[row.industry] || 0) + 1;
      for (const tag of row.narrativeTags || []) {
        narrativeCount[tag] = (narrativeCount[tag] || 0) + 1;
      }
    }
  }

  return {
    repeaters: Object.entries(tickerCount)
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([ticker, count]) => ({ ticker, periods: count })),
    topIndustries: topCounts(industryCount, 12, 'industry'),
    topNarratives: topCounts(narrativeCount, 12, 'tag'),
  };
}

async function hydrateExchangeMap(tickers, options = {}) {
  const concurrency = Math.max(1, Number(options.concurrency) || 8);
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const exchangeMap = {};
  let cursor = 0;
  const inFlight = new Set();
  let completed = 0;

  const launchNext = () => {
    while (cursor < tickers.length && inFlight.size < concurrency) {
      const ticker = tickers[cursor];
      cursor += 1;
      let taskPromise;
      taskPromise = (async () => {
        try {
          const quote = await getQuoteInfo(ticker);
          exchangeMap[ticker] = quote?.exchange || 'UNKNOWN';
        } catch {
          exchangeMap[ticker] = 'UNKNOWN';
        } finally {
          completed += 1;
          if (onProgress && completed % 100 === 0) {
            onProgress({ stage: 'exchange', processed: completed, total: tickers.length });
          }
        }
      })().finally(() => {
        inFlight.delete(taskPromise);
      });
      inFlight.add(taskPromise);
    }
  };

  launchNext();
  while (inFlight.size > 0) {
    await Promise.race(inFlight);
    launchNext();
  }

  if (onProgress) {
    onProgress({ stage: 'exchange', processed: completed, total: tickers.length });
  }
  return exchangeMap;
}

export async function runBreakoutGainersStudy(options = {}) {
  const periods = buildPeriods(options.now || new Date());
  const to = periods.reduce((max, p) => (p.end > max ? p.end : max), periods[0].end);
  const from = lookbackStartForPeriods(periods, 420);

  const maxTickers = Math.max(100, Number(options.maxTickers) || 1200);
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const loadedUniverse = options.tickers || await loadTickers();
  const universe = loadedUniverse.slice(0, maxTickers);
  if (onProgress) onProgress({ stage: 'universe', loaded: loadedUniverse.length, using: universe.length });

  const barsByTicker = await loadBarsForUniverse(universe, from, to, {
    concurrency: options.barsConcurrency ?? 8,
    chunkSize: options.barsChunkSize ?? 200,
    onProgress,
  });

  const candidatesByPeriod = {};
  for (const period of periods) candidatesByPeriod[period.key] = [];

  for (const [ticker, bars] of barsByTicker.entries()) {
    for (const period of periods) {
      const candidates = detectBreakoutCandidates(bars, { periodStart: period.start, periodEnd: period.end });
      const best = selectBestBreakout(candidates);
      if (!best) continue;
      candidatesByPeriod[period.key].push({
        ticker,
        setup: best,
      });
    }
  }

  const allWinnerTickers = [...new Set(
    Object.values(candidatesByPeriod)
      .flatMap((rows) => rows.map((row) => row.ticker))
  )];
  const fundamentals = await hydrateFundamentalsForTickers(allWinnerTickers);
  if (onProgress) onProgress({ stage: 'fundamentals', winners: allWinnerTickers.length });
  const exchangeMap = await hydrateExchangeMap(allWinnerTickers, { concurrency: 8, onProgress });

  const allowedExchanges = new Set(['NASDAQ', 'NYSE', 'AMEX']);
  const outPeriods = periods.map((period) => {
    const enriched = (candidatesByPeriod[period.key] || [])
      .map((row) => {
        const fund = fundamentals[row.ticker] || {};
        const exchange = exchangeMap[row.ticker] || 'UNKNOWN';
        return {
          ticker: row.ticker,
          exchange,
          sector: fund?.sector ?? null,
          industry: fund?.industry ?? null,
          companyName: fund?.companyName ?? null,
          narrativeTags: inferNarrativeTags(fund),
          confidence: deriveConfidence(row.setup, fund),
          setup: {
            ...row.setup,
            qtrEarningsYoY: fund?.qtrEarningsYoY ?? null,
            trailingEps: fund?.trailingEps ?? null,
            profitMargin: fund?.profitMargin ?? null,
            operatingMargin: fund?.operatingMargin ?? null,
            pctHeldByInst: fund?.pctHeldByInst ?? null,
          },
        };
      })
      .filter((row) => allowedExchanges.has(row.exchange))
      .sort((a, b) => b.setup.gainPct - a.setup.gainPct);

    const top100 = enriched.slice(0, 100);
    const nasdaqPriority = top100.filter((row) => row.exchange === 'NASDAQ');
    return {
      key: period.key,
      start: period.start,
      end: period.end,
      top100,
      nasdaqPriority,
      summary: buildCharacteristicsSummary(top100),
    };
  });

  const study = {
    generatedAt: new Date().toISOString(),
    meta: {
      dateGenerated: nowDateStr(),
      universeCount: universe.length,
      barsLoadedCount: barsByTicker.size,
      barsRange: { from, to },
      methodology: {
        breakoutRule: 'close_above_65d_pivot_and_52w_high_with_1_5x_volume',
        minPriceRule: 'lowest_close_prior_20d_gte_10',
      },
    },
    periods: outPeriods,
    crossPeriod: computeCrossPeriodStats(outPeriods),
  };

  if (options.outputDir) {
    const base = options.outputDir;
    const stamp = new Date().toISOString().slice(0, 10);
    const jsonPath = path.join(base, `top-100-breakout-gainers-${stamp}.json`);
    const mdPath = path.join(base, `top-100-breakout-gainers-${stamp}.md`);
    await fs.mkdir(base, { recursive: true });
    await fs.writeFile(jsonPath, JSON.stringify(study, null, 2), 'utf8');
    await fs.writeFile(mdPath, buildMarkdownReport(study), 'utf8');
    study.outputs = { jsonPath, mdPath };
  }

  return study;
}
