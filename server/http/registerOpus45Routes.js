/**
 * /api/opus45/* HTTP routes + computeAndSaveOpus45Scores for coreScanRouteServices (managed scans).
 */

import { getBars } from '../yahoo.js';
import { checkVCP } from '../vcp.js';
import {
  generateOpus45Signal,
  findOpus45Signals,
  checkExitSignal,
  getSignalStats,
  DEFAULT_WEIGHTS,
  normalizeRs,
  normalizeIndustryRank,
} from '../opus45Signal.js';
import {
  loadOptimizedWeights,
  runLearningPipeline,
  getLearningStatus,
  applyWeightChanges,
  resetWeightsToDefault,
} from '../opus45Learning.js';
import { runBacktest } from '../backtest.js';
import { runRetroBacktest, getTickersForBacktest } from '../retroBacktest.js';
import { fetchTradingViewIndustryReturns, buildIndustryReturnsFromTVMap, normalizeIndustryName } from '../tradingViewIndustry.js';
import { getBars as getBarsFromDb, getBarsBatch as getBarsBatchFromDb, saveBars as saveBarsToDb } from '../db/bars.js';
import {
  loadOpus45Signals as loadOpus45SignalsFromDb,
  saveOpus45Signals as saveOpus45SignalsToDb,
  mergeOpus45AllScoresWithSignals,
} from '../db/opus45.js';
import { mapCachedSignalsToAllScores, enrichCachedSignalsWithCurrentPrice } from './scanOpusMerge.js';
import { summarizePercentiles } from '../utils/percentiles.js';
import { registerAgentsSignalHistoryRoute } from './registerAgentsRoutes.js';
import {
  coreScanRouteServices,
  loadFundamentals,
  loadScanData,
  BARS_BATCH_CONCURRENCY,
} from './registerCoreScanCronBarsMarketRoutes.js';

/**
 * Compute Opus4.5 scores for all tickers and save to cache.
 * Called after scan completes to pre-compute scores for instant dashboard load.
 */
async function computeAndSaveOpus45Scores(context = {}) {
  try {
    const scanData = context.scanData ?? (await loadScanData());
    if (!scanData.results?.length) {
      console.log('Opus4.5: No scan results to score.');
      return null;
    }
    const results = scanData.results || [];
    const [fundamentals, weights] = await Promise.all([
      context.fundamentals ?? loadFundamentals(),
      context.weights ?? loadOptimizedWeights(),
    ]);
    const industryNames = [...new Set(results.map((r) => fundamentals[r.ticker]?.industry).filter(Boolean))];
    const requiredIndustriesOpus = new Set(industryNames.map((name) => normalizeIndustryName(name)));
    const { returnsMap: tvMap } = await fetchTradingViewIndustryReturns(
      requiredIndustriesOpus.size > 0 ? { requiredIndustries: requiredIndustriesOpus } : {},
    );
    const industryReturns = buildIndustryReturnsFromTVMap(tvMap, industryNames);

    const barsByTicker = {};
    const to = new Date();
    const from365 = new Date(to);
    from365.setDate(from365.getDate() - 365);
    const fromStr365 = from365.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);

    const resultsToAnalyze = results;
    const preloadedBarsByTicker =
      context.barsByTicker instanceof Map
        ? Object.fromEntries(context.barsByTicker.entries())
        : context.barsByTicker || {};

    const needFetch = [];
    for (const r of resultsToAnalyze) {
      try {
        let bars = preloadedBarsByTicker[r.ticker] ?? null;
        if (bars && bars.length >= 200) {
          barsByTicker[r.ticker] = [...bars].sort((a, b) => a.t - b.t);
          continue;
        }
        bars = await getBarsFromDb(r.ticker, fromStr365, toStr, '1d');
        if (bars && bars.length >= 200) {
          barsByTicker[r.ticker] = [...bars].sort((a, b) => a.t - b.t);
        }
        if (!bars || bars.length < 200) needFetch.push(r);
      } catch (e) {
        console.error(`Error loading bars for ${r.ticker}:`, e.message);
      }
    }

    if (needFetch.length > 0) {
      const batchOutputs = await getBarsBatchFromDb(
        needFetch.map((row) => ({
          ticker: row.ticker,
          from: fromStr365,
          to: toStr,
          interval: '1d',
        })),
        { concurrency: BARS_BATCH_CONCURRENCY },
      );
      for (let i = 0; i < batchOutputs.length; i++) {
        const output = batchOutputs[i];
        const ticker = needFetch[i]?.ticker;
        if (output?.status === 'fulfilled' && output.bars?.length >= 200) {
          barsByTicker[ticker] = [...output.bars].sort((a, b) => a.t - b.t);
        } else if (output?.status === 'rejected') {
          console.error(`Fetch failed for ${ticker}:`, output.error);
        }
      }
      console.log(`Opus4.5: Resolved bars for ${needFetch.length} tickers via shared batch fetch.`);
    }

    const { signals, allScores } = findOpus45Signals(
      resultsToAnalyze,
      barsByTicker,
      fundamentals,
      industryReturns,
      weights,
    );
    const stats = getSignalStats(signals);

    const signalsToCache = signals.map((s) => {
      const bars = barsByTicker[s.ticker];
      const currentPrice = bars?.length ? bars[bars.length - 1].c : null;
      return { ...s, currentPrice };
    });

    const cacheData = {
      signals: signalsToCache,
      allScores,
      total: signals.length,
      stats,
      scannedAt: scanData.scannedAt,
      computedAt: new Date().toISOString(),
      weightsVersion: weights._version || 'default',
      analyzedTickers: resultsToAnalyze.length,
      tickersWithBars: Object.keys(barsByTicker).length,
    };

    await saveOpus45SignalsToDb({
      signals: cacheData.signals,
      allScores: cacheData.allScores,
      stats: cacheData.stats,
      total: cacheData.total,
      computedAt: cacheData.computedAt,
    });
    console.log(`Opus4.5: Cached ${signals.length} active signals; ${allScores.length} tickers scored.`);

    return cacheData;
  } catch (e) {
    console.error('Opus4.5 compute error:', e);
    return null;
  }
}

/**
 * @param {import('express').Application} app
 */
function registerOpus45RoutesPhase1(app) {
  app.get('/api/opus45/signals', async (req, res) => {
    try {
      const forceRecalc = req.query.force === 'true';

      if (!forceRecalc) {
        const cached = await loadOpus45SignalsFromDb();
        if (cached && cached.signals?.length >= 0) {
          await enrichCachedSignalsWithCurrentPrice(cached.signals);
          const mergedCachedScores = mergeOpus45AllScoresWithSignals(cached.allScores, cached.signals);
          const allScores = mapCachedSignalsToAllScores(mergedCachedScores);
          return res.json({
            signals: cached.signals,
            allScores,
            total: cached.total ?? cached.signals?.length,
            stats: cached.stats,
            fromCache: true,
          });
        }
      }

      const scanData = await loadScanData();
      if (!scanData.results?.length) {
        return res.json({ signals: [], total: 0, stats: null, error: 'No scan results. Run a scan first.' });
      }

      const result = await computeAndSaveOpus45Scores();
      if (result) {
        res.json({ ...result, fromCache: false });
      } else {
        res.json({ signals: [], allScores: [], total: 0, stats: null, error: 'Failed to compute Opus4.5 scores' });
      }
    } catch (e) {
      console.error('Opus4.5 signals error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/opus45/debug', async (req, res) => {
    try {
      const scanData = await loadScanData();
      if (!scanData.results?.length) {
        return res.json({ error: 'No scan results' });
      }
      const results = scanData.results || [];
      const [fundamentals, weights] = await Promise.all([loadFundamentals(), loadOptimizedWeights()]);

      const to = new Date();
      const from365 = new Date(to);
      from365.setDate(from365.getDate() - 365);
      const fromStr365 = from365.toISOString().slice(0, 10);
      const toStr = to.toISOString().slice(0, 10);

      const topRows = results.slice(0, 10);
      const debugResults = [];
      const debugBarsResults = await getBarsBatchFromDb(
        topRows.map((row) => ({
          ticker: row.ticker,
          from: fromStr365,
          to: toStr,
          interval: '1d',
        })),
        { concurrency: BARS_BATCH_CONCURRENCY },
      );

      for (let i = 0; i < topRows.length; i++) {
        const r = topRows[i];
        const batchOutput = debugBarsResults[i];
        const debug = {
          ticker: r.ticker,
          enhancedScore: r.enhancedScore,
          relativeStrength: r.relativeStrength,
          contractions: r.contractions,
          pattern: r.pattern,
          patternConfidence: r.patternConfidence,
          atMa10: r.atMa10,
          atMa20: r.atMa20,
          industryRank: r.industryRank,
          barsLoaded: 0,
          signalResult: null,
        };
        const bars = batchOutput?.status === 'fulfilled' ? batchOutput.bars || [] : null;
        debug.barsLoaded = bars?.length || 0;
        debug.barsFetched = batchOutput?.source === 'yahoo';
        if (batchOutput?.status === 'rejected') {
          debug.fetchError = batchOutput.error;
        }

        if (bars && bars.length >= 200) {
          const sortedBars = [...bars].sort((a, b) => a.t - b.t);
          const signal = generateOpus45Signal(r, sortedBars, fundamentals[r.ticker], null, weights);
          debug.signalResult = {
            signal: signal.signal,
            confidence: signal.opus45Confidence,
            mandatoryPassed: signal.mandatoryPassed,
            failedCriteria: signal.mandatoryDetails?.failedCriteria,
            passedCriteria: signal.mandatoryDetails?.passedCriteria,
          };
        } else {
          debug.signalResult = { error: `Only ${debug.barsLoaded} bars (need 200+)` };
        }

        debugResults.push(debug);
      }

      res.json({
        analyzed: debugResults.length,
        results: debugResults,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/opus45/debug/rs-industry', async (req, res) => {
    try {
      const limitParam = Number(req.query.limit) || 50;
      const limit = Math.max(1, Math.min(200, limitParam));
      const scanData = await loadScanData();
      if (!scanData.results?.length) {
        return res.json({ error: 'No scan results' });
      }

      const opusData = await computeAndSaveOpus45Scores();
      if (!opusData?.allScores?.length) {
        return res.json({ error: 'No Opus4.5 scores available' });
      }

      const scanByTicker = new Map(scanData.results.map((r) => [r.ticker, r]));
      const maxIndustryRank = scanData.results.reduce((m, r) => {
        const val = Number(r?.industryRank);
        return Number.isFinite(val) && val > m ? val : m;
      }, 0);
      const fallbackIndustryTotal = Math.max(2, maxIndustryRank || 200);

      const sorted = [...opusData.allScores].sort((a, b) => (b.opus45Confidence ?? 0) - (a.opus45Confidence ?? 0));
      const top = sorted.slice(0, limit);

      const enriched = top.map((row) => {
        const scan = scanByTicker.get(row.ticker) || {};
        const industryTotal = scan?.industryTotalCount ?? fallbackIndustryTotal;
        const rsNormalized = normalizeRs(scan?.relativeStrength);
        const industryNormalized = normalizeIndustryRank(scan?.industryRank, industryTotal);
        return {
          ticker: row.ticker,
          opus45Confidence: row.opus45Confidence ?? 0,
          opus45Grade: row.opus45Grade ?? 'F',
          relativeStrength: scan?.relativeStrength ?? null,
          industryRank: scan?.industryRank ?? null,
          industryTotalCount: industryTotal,
          rsNormalized: rsNormalized == null ? null : Math.round(rsNormalized * 1000) / 1000,
          industryNormalized: industryNormalized == null ? null : Math.round(industryNormalized * 1000) / 1000,
        };
      });

      const rsValues = enriched.map((r) => r.rsNormalized).filter((v) => Number.isFinite(v));
      const industryValues = enriched.map((r) => r.industryNormalized).filter((v) => Number.isFinite(v));

      res.json({
        limit,
        scannedAt: scanData.scannedAt,
        computedAt: opusData.computedAt,
        summary: {
          rs: summarizePercentiles(rsValues, [50, 90]),
          industry: summarizePercentiles(industryValues, [50, 90]),
        },
        top: enriched,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/opus45/signal/:ticker', async (req, res) => {
    const { ticker } = req.params;

    try {
      const to = new Date();
      const from365 = new Date(to);
      from365.setDate(from365.getDate() - 365);
      const fromStr365 = from365.toISOString().slice(0, 10);
      const toStr = to.toISOString().slice(0, 10);

      let bars = await getBarsFromDb(ticker, fromStr365, toStr, '1d');
      if (!bars) {
        bars = await getBars(ticker, fromStr365, toStr, '1d');
        await saveBarsToDb(ticker, fromStr365, toStr, bars, '1d');
      }

      if (!bars || bars.length < 200) {
        return res.json({
          ticker,
          signal: false,
          reason: 'Insufficient data (need 200+ days)',
          opus45Confidence: 0,
        });
      }

      const vcpResult = checkVCP(bars);

      const fundamentals = await loadFundamentals();
      const tickerFundamentals = fundamentals[ticker] || null;

      const industryNames = tickerFundamentals?.industry ? [tickerFundamentals.industry] : [];
      const requiredIndustriesSignal = tickerFundamentals?.industry
        ? new Set([normalizeIndustryName(tickerFundamentals.industry)])
        : null;
      const { returnsMap: tvMap } = await fetchTradingViewIndustryReturns(
        requiredIndustriesSignal && requiredIndustriesSignal.size > 0 ? { requiredIndustries: requiredIndustriesSignal } : {},
      );
      const industryReturns = buildIndustryReturnsFromTVMap(tvMap, industryNames);
      const industryData = tickerFundamentals?.industry ? industryReturns[tickerFundamentals.industry] : null;

      const weights = loadOptimizedWeights();

      const signal = generateOpus45Signal(vcpResult, bars, tickerFundamentals, industryData, weights);

      res.json({
        ticker,
        ...signal,
        weightsVersion: weights._version || 'default',
      });
    } catch (e) {
      console.error(`Opus4.5 signal error for ${ticker}:`, e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/opus45/signals/:ticker/history', async (req, res) => {
    const { ticker } = req.params;

    try {
      const to = new Date();
      const from365 = new Date(to);
      from365.setDate(from365.getDate() - 365);
      const fromStr365 = from365.toISOString().slice(0, 10);
      const toStr = to.toISOString().slice(0, 10);

      let bars = await getBarsFromDb(ticker, fromStr365, toStr, '1d');
      if (!bars) {
        bars = await getBars(ticker, fromStr365, toStr, '1d');
        await saveBarsToDb(ticker, fromStr365, toStr, bars, '1d');
      }

      if (!bars || bars.length < 200) {
        return res.json({
          ticker,
          buySignals: [],
          sellSignals: [],
          currentStatus: 'no_position',
          lastBuySignal: null,
          lastSellSignal: null,
          reason: 'Insufficient data (need 200+ days)',
        });
      }

      const weights = loadOptimizedWeights();

      const sortedBars = [...bars].sort((a, b) => a.t - b.t);

      const buySignals = [];
      const sellSignals = [];
      let inPosition = false;
      let entryPrice = 0;
      let lastBuySignal = null;
      let lastSellSignal = null;
      let highSinceEntry = 0;

      for (let i = 200; i < sortedBars.length; i++) {
        const bar = sortedBars[i];
        const barsToDate = sortedBars.slice(0, i + 1);

        if (!inPosition) {
          const vcpResult = checkVCP(barsToDate);
          const signal = generateOpus45Signal(vcpResult, barsToDate, null, null, weights);

          if (signal.signal) {
            const buyMarker = {
              time: Math.floor(bar.t / 1000),
              type: 'buy',
              price: bar.c,
              confidence: signal.opus45Confidence,
              grade: signal.opus45Grade || null,
              reason: signal.mandatoryDetails?.passedCriteria?.join(', ') || 'All criteria passed',
              stopLoss: signal.stopLossPrice,
              target: signal.targetPrice,
            };
            buySignals.push(buyMarker);
            lastBuySignal = buyMarker;
            inPosition = true;
            entryPrice = bar.c;
            highSinceEntry = bar.h;
          }
        } else {
          highSinceEntry = Math.max(highSinceEntry, bar.h);
          const exitCheck = checkExitSignal({ entryPrice, highSinceEntry }, barsToDate);

          if (exitCheck.exitSignal) {
            const sellMarker = {
              time: Math.floor(bar.t / 1000),
              type: 'sell',
              price: bar.c,
              reason: exitCheck.exitReason,
              exitType: exitCheck.exitType,
            };
            sellSignals.push(sellMarker);
            lastSellSignal = sellMarker;
            inPosition = false;
            entryPrice = 0;
            highSinceEntry = 0;
          }
        }
      }

      const completedTrades = [];
      const minLen = Math.min(buySignals.length, sellSignals.length);
      for (let i = 0; i < minLen; i++) {
        const buy = buySignals[i];
        const sell = sellSignals[i];
        const returnPct = ((sell.price - buy.price) / buy.price) * 100;
        const daysInTrade = Math.round((sell.time - buy.time) / 86400);
        completedTrades.push({
          entryDate: new Date(buy.time * 1000).toISOString().slice(0, 10),
          entryPrice: buy.price,
          exitDate: new Date(sell.time * 1000).toISOString().slice(0, 10),
          exitPrice: sell.price,
          returnPct: Math.round(returnPct * 10) / 10,
          daysInTrade,
          profitDollars: Math.round((sell.price - buy.price) * 100) / 100,
        });
      }

      const holdingPeriod =
        inPosition && lastBuySignal ? Math.round((Date.now() / 1000 - lastBuySignal.time) / 86400) : null;

      const MAX_DAYS_FOR_ACTIONABLE_BUY = 2;
      const isActionableBuy = inPosition && holdingPeriod !== null && holdingPeriod <= MAX_DAYS_FOR_ACTIONABLE_BUY;

      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');

      const response = {
        ticker,
        buySignals,
        sellSignals,
        currentStatus: inPosition ? 'in_position' : 'no_position',
        lastBuySignal,
        lastSellSignal,
        completedTrades,
        holdingPeriod,
        isActionableBuy,
        weightsVersion: weights._version || 'default',
      };

      if (ticker === 'STRL') {
        console.log(`[STRL DEBUG] Sending response:`, {
          currentStatus: response.currentStatus,
          lastBuyDate: lastBuySignal ? new Date(lastBuySignal.time * 1000).toISOString() : null,
          lastBuyPrice: lastBuySignal?.price,
          holdingPeriod: response.holdingPeriod,
        });
      }

      res.json(response);
    } catch (e) {
      console.error(`Opus4.5 history error for ${ticker}:`, e);
      res.status(500).json({ error: e.message });
    }
  });
}

function registerOpus45RoutesPhase2(app) {
  app.post('/api/opus45/exit-check', async (req, res) => {
    const { ticker, entryPrice, entryDate } = req.body;

    if (!ticker || !entryPrice) {
      return res.status(400).json({ error: 'ticker and entryPrice are required' });
    }

    try {
      const to = new Date();
      const from = new Date(entryDate || to);
      from.setDate(from.getDate() - 30);
      const fromStr = from.toISOString().slice(0, 10);
      const toStr = to.toISOString().slice(0, 10);

      let bars = await getBarsFromDb(ticker, fromStr, toStr, '1d');
      if (!bars) {
        bars = await getBars(ticker, fromStr, toStr, '1d');
        await saveBarsToDb(ticker, fromStr, toStr, bars, '1d');
      }

      const exitCheck = checkExitSignal({ ticker, entryPrice, entryDate }, bars);

      res.json({
        ticker,
        entryPrice,
        ...exitCheck,
      });
    } catch (e) {
      console.error(`Exit check error for ${ticker}:`, e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/opus45/learning/status', async (req, res) => {
    try {
      const status = await getLearningStatus();
      res.json(status);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/opus45/learning/run-retro', async (req, res) => {
    req.setTimeout(600000);
    res.setTimeout(600000);

    const { lookbackMonths = 12, holdingPeriod = 60, topN = 100, autoApply = false } = req.body;

    try {
      console.log(`\n🔄 Opus4.5 Learning: Running retrospective backtest (${lookbackMonths}mo, ${holdingPeriod}d hold)...`);

      const tickers = await getTickersForBacktest();
      if (tickers.length === 0) {
        return res.status(400).json({ error: 'No tickers. Run a scan first or ensure data/tickers.txt exists.' });
      }

      const retroResult = await runRetroBacktest({
        tickers,
        lookbackMonths,
        holdingPeriod,
        topN,
      });

      const signals = retroResult.signals || [];
      if (signals.length < 20) {
        return res.json({
          error: 'INSUFFICIENT_SIGNALS',
          message: `Need 20+ signals for learning, found ${signals.length}`,
          retro: retroResult,
        });
      }

      const tradesForLearning = signals.map((s) => ({
        ticker: s.ticker,
        outcome: s.outcome,
        forwardReturn: s.returnPct,
        contractions: s.contractions ?? 0,
        volumeDryUp: s.volumeDryUp ?? false,
        relativeStrength: s.rs ?? null,
        atMa10: s.entryMA === '10 MA',
        atMa20: s.entryMA === '20 MA',
        industryRank: null,
        institutionalOwnership: null,
        epsGrowth: null,
        enhancedScore: null,
        patternConfidence: null,
      }));

      const backtestResultsForLearning = {
        scanDate: 'retro',
        daysForward: holdingPeriod,
        results: tradesForLearning,
      };

      const learningResult = await runLearningPipeline(backtestResultsForLearning, autoApply);

      res.json({
        retro: {
          config: retroResult.config,
          summary: retroResult.summary,
          signalsFound: signals.length,
        },
        learning: learningResult,
      });
    } catch (e) {
      console.error('Retro learning error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/opus45/learning/run', async (req, res) => {
    const { scanDate, daysForward = 30, topN = null, autoApply = false } = req.body;

    if (!scanDate) {
      return res.status(400).json({ error: 'scanDate is required' });
    }

    try {
      console.log(`\n🧠 Running Opus4.5 learning on backtest ${scanDate}...`);

      const backtestResult = await runBacktest(scanDate, daysForward, topN);

      if (backtestResult.error) {
        return res.json({ error: backtestResult.error, message: backtestResult.message });
      }

      const learningResult = await runLearningPipeline(backtestResult.backtestResults, autoApply);

      res.json({
        backtest: backtestResult.analysis,
        learning: learningResult,
      });
    } catch (e) {
      console.error('Learning error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/opus45/learning/apply-weights', async (req, res) => {
    const { weights } = req.body;

    if (!weights || typeof weights !== 'object') {
      return res.status(400).json({ error: 'weights object is required' });
    }

    try {
      const result = await applyWeightChanges(weights);
      res.json({ success: true, ...result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/opus45/learning/reset', (req, res) => {
    try {
      const weights = resetWeightsToDefault();
      res.json({ success: true, weights });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/opus45/weights', async (req, res) => {
    try {
      const current = await loadOptimizedWeights();
      res.json({
        current,
        defaults: DEFAULT_WEIGHTS,
        isOptimized: Object.keys(current).some((k) => current[k] !== DEFAULT_WEIGHTS[k]),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

/**
 * Wires Opus4.5 routes and inserts `/api/agents/signals/:ticker/history` between opus history and exit-check (same order as legacy index.js).
 * @param {import('express').Application} app
 */
export function registerOpus45Routes(app) {
  coreScanRouteServices.computeAndSaveOpus45Scores = computeAndSaveOpus45Scores;
  registerOpus45RoutesPhase1(app);
  registerAgentsSignalHistoryRoute(app);
  registerOpus45RoutesPhase2(app);
}
