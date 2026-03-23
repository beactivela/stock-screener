/**
 * /api/learning/* HTTP routes (extracted from index.js for maintainability).
 */

import { getBars } from '../yahoo.js';

/**
 * @param {import('express').Application} app
 * @param {Record<string, unknown>} [_ctx] reserved for future dependency injection
 */
export function registerLearningRoutes(app, _ctx) {
  // ========== SELF-LEARNING SYSTEM ENDPOINTS ==========
  // Advanced self-learning trading system with failure analysis, pattern recognition,
  // and adaptive scoring. See server/learning/ for implementation.

  // Get learning dashboard summary
  app.get('/api/learning/dashboard', async (req, res) => {
    try {
      const { getLearningDashboard } = await import('../learning/index.js');
      const dashboard = await getLearningDashboard();
      res.json(dashboard);
    } catch (e) {
      console.error('Learning dashboard error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // Get current market condition (distribution days, regime)
  app.get('/api/learning/market-condition', async (req, res) => {
    try {
      const { getCurrentMarketCondition } = await import('../learning/index.js');
      const condition = await getCurrentMarketCondition();
      res.json(condition || { error: 'Could not fetch market condition' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get failure classification statistics
  app.get('/api/learning/failures', async (req, res) => {
    try {
      const { getClassificationStats } = await import('../learning/index.js');
      const stats = await getClassificationStats();
      res.json(stats || { error: 'No failure data available' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Classify all unclassified losing trades
  app.post('/api/learning/failures/classify', async (req, res) => {
    try {
      const { classifyAllUnclassified } = await import('../learning/index.js');
      const result = await classifyAllUnclassified();
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Run pattern analysis across all trades
  app.post('/api/learning/analyze-patterns', async (req, res) => {
    try {
      const { analyzePatterns } = await import('../learning/index.js');
      const analysis = await analyzePatterns();
      res.json(analysis);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get latest pattern analysis
  app.get('/api/learning/patterns', async (req, res) => {
    try {
      const { getLatestPatternAnalysis } = await import('../learning/index.js');
      const analysis = await getLatestPatternAnalysis();
      res.json(analysis || { error: 'No pattern analysis available' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Generate weekly learning report
  app.post('/api/learning/weekly-report', async (req, res) => {
    try {
      const { weekEndDate } = req.body;
      const { generateWeeklyReport } = await import('../learning/index.js');
      const report = await generateWeeklyReport(weekEndDate);
      res.json(report);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get latest weekly report
  app.get('/api/learning/weekly-report', async (req, res) => {
    try {
      const { getLatestWeeklyReport, formatReportAsMarkdown } = await import('../learning/index.js');
      const report = await getLatestWeeklyReport();
      const format = req.query.format;

      if (format === 'markdown' && report) {
        res.type('text/markdown').send(formatReportAsMarkdown(report));
      } else {
        res.json(report || { error: 'No weekly report available' });
      }
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get all weekly reports
  app.get('/api/learning/weekly-reports', async (req, res) => {
    try {
      const { getAllWeeklyReports } = await import('../learning/index.js');
      const reports = await getAllWeeklyReports();
      res.json({ reports, count: reports.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Run full weekly learning cycle
  app.post('/api/learning/run-weekly-cycle', async (req, res) => {
    try {
      const { runWeeklyLearningCycle } = await import('../learning/index.js');
      const results = await runWeeklyLearningCycle();
      res.json(results);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Update setup win rates from trade history
  app.post('/api/learning/update-win-rates', async (req, res) => {
    try {
      const { updateSetupWinRates } = await import('../learning/index.js');
      const result = await updateSetupWinRates();
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get historical win rate for a setup
  app.post('/api/learning/historical-win-rate', async (req, res) => {
    try {
      const { getHistoricalWinRate } = await import('../learning/index.js');
      const setup = req.body;
      const result = await getHistoricalWinRate(setup);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get effective weights (default or learned)
  app.get('/api/learning/weights', async (req, res) => {
    try {
      const { getEffectiveWeights } = await import('../learning/index.js');
      const weights = await getEffectiveWeights();
      res.json(weights);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Apply learned weight adjustments
  app.post('/api/learning/apply-weights', async (req, res) => {
    try {
      const { applyLearnedWeights } = await import('../learning/index.js');
      const result = await applyLearnedWeights();
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Validate entry with learning system
  app.post('/api/learning/validate-entry', async (req, res) => {
    try {
      const { ticker, bars, vcpResult, opus45Signal, fundamentals, industryData } = req.body;

      // If bars not provided, fetch them
      let barsData = bars;
      if (!barsData && ticker) {
        const to = new Date();
        const from = new Date();
        from.setDate(from.getDate() - 365);
        barsData = await getBars(ticker, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10));
      }

      const { validateEntryWithLearning } = await import('../learning/index.js');
      const validation = await validateEntryWithLearning({
        bars: barsData,
        vcpResult: vcpResult || {},
        opus45Signal: opus45Signal || {},
        fundamentals: fundamentals || {},
        industryData: industryData || {},
      });

      res.json({ ticker, ...validation });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Analyze a breakout
  app.post('/api/learning/analyze-breakout', async (req, res) => {
    try {
      const { ticker, breakoutDate, pivotPrice, patternData } = req.body;

      if (!ticker || !breakoutDate) {
        return res.status(400).json({ error: 'ticker and breakoutDate required' });
      }

      const { analyzeBreakout } = await import('../learning/index.js');
      const analysis = await analyzeBreakout(ticker, breakoutDate, pivotPrice, patternData);
      res.json(analysis);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get breakout success statistics
  app.get('/api/learning/breakout-stats', async (req, res) => {
    try {
      const { getBreakoutStats } = await import('../learning/index.js');
      const stats = await getBreakoutStats();
      res.json(stats || { error: 'No breakout data available' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get context snapshot for a trade
  app.get('/api/learning/context/:tradeId', async (req, res) => {
    try {
      const { getContextSnapshotByTradeId } = await import('../learning/index.js');
      const context = await getContextSnapshotByTradeId(req.params.tradeId);
      res.json(context || { error: 'No context snapshot found' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get failure classification for a trade
  app.get('/api/learning/classification/:tradeId', async (req, res) => {
    try {
      const { getClassification } = await import('../learning/index.js');
      const classification = await getClassification(req.params.tradeId);
      res.json(classification || { error: 'No classification found' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ========== HISTORICAL SIGNAL ANALYSIS ENDPOINTS ==========
  // Auto-generate trades from Opus4.5 signals over past 5 years (60 months)
  // Learn cross-stock patterns without manual trade entry

  // Run full historical analysis (main entry point)
  // This scans tickers, finds signals, simulates trades, and analyzes patterns
  app.post('/api/learning/historical/run', async (req, res) => {
    try {
      const { tickers, lookbackMonths = 60, storeInDatabase = true, tickerLimit = 0, relaxedThresholds = false, seedMode = false, signalFamilies = null } = req.body;

      const { runHistoricalAnalysis } = await import('../learning/index.js');

      // This can take a while - start it and stream progress
      const results = await runHistoricalAnalysis({
        tickers,
        lookbackMonths,
        tickerLimit,
        storeInDatabase,
        relaxedThresholds,
        seedMode,
        signalFamilies,
        onProgress: (progress) => {
          console.log(`Scanning ${progress.ticker} (${progress.current}/${progress.total})`);
        },
      });

      res.json(results);
    } catch (e) {
      console.error('Historical analysis error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // Quick analysis on specific tickers (faster, no DB storage)
  app.post('/api/learning/historical/quick', async (req, res) => {
    try {
      const { tickers, lookbackMonths = 6 } = req.body;

      if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
        return res.status(400).json({ error: 'tickers array required' });
      }

      const { quickAnalysis } = await import('../learning/index.js');
      const results = await quickAnalysis(tickers, lookbackMonths);

      res.json(results);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get latest cross-stock analysis results
  app.get('/api/learning/historical/latest', async (req, res) => {
    try {
      const { getLatestAnalysis } = await import('../learning/index.js');
      const analysis = await getLatestAnalysis();
      res.json(analysis || { error: 'No historical analysis available. Run /api/learning/historical/run first.' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get stored historical signals from database
  app.get('/api/learning/historical/signals', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 500;
      const { getStoredSignals } = await import('../learning/index.js');
      const signals = await getStoredSignals(limit);
      res.json({ signals, count: signals.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Re-analyze stored signals without re-scanning
  app.post('/api/learning/historical/reanalyze', async (req, res) => {
    try {
      const { getStoredSignals, runCrossStockAnalysis, storeAnalysisResults } = await import('../learning/index.js');

      const signals = await getStoredSignals(1000);

      if (signals.length === 0) {
        return res.json({ error: 'No stored signals. Run historical scan first.' });
      }

      const analysis = runCrossStockAnalysis(signals);
      await storeAnalysisResults(analysis);

      res.json({
        signalsAnalyzed: signals.length,
        ...analysis,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Scan a single ticker for historical signals (for testing)
  app.get('/api/learning/historical/scan/:ticker', async (req, res) => {
    try {
      const ticker = req.params.ticker.toUpperCase();
      const lookbackMonths = parseInt(req.query.months) || 60;

      const { scanMultipleTickers } = await import('../learning/index.js');
      const results = await scanMultipleTickers([ticker], lookbackMonths);

      res.json({
        ticker,
        signals: results.signals,
        stats: results.stats,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get optimal VCP setup parameters (cross-stock learned)
  app.get('/api/learning/historical/optimal-setup', async (req, res) => {
    try {
      const { getStoredSignals, findOptimalSetup } = await import('../learning/index.js');

      const signals = await getStoredSignals(1000);

      if (signals.length < 10) {
        return res.json({
          error: 'Not enough signals. Need at least 10 historical trades.',
          signalsFound: signals.length,
        });
      }

      const optimal = findOptimalSetup(signals);
      res.json(optimal);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get factor analysis (win rate by RS, contractions, volume, etc.)
  app.get('/api/learning/historical/factors', async (req, res) => {
    try {
      const { getStoredSignals, analyzeAllFactors } = await import('../learning/index.js');

      const signals = await getStoredSignals(1000);

      if (signals.length < 5) {
        return res.json({ error: 'Not enough signals for factor analysis' });
      }

      const factors = analyzeAllFactors(signals);
      res.json(factors);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get pattern type analysis (VCP vs Cup-with-Handle vs Flat Base)
  app.get('/api/learning/historical/pattern-types', async (req, res) => {
    try {
      const { getStoredSignals, analyzePatternTypes } = await import('../learning/index.js');

      const signals = await getStoredSignals(1000);

      if (signals.length < 5) {
        return res.json({ error: 'Not enough signals for pattern analysis' });
      }

      const patterns = analyzePatternTypes(signals);
      res.json(patterns);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get exit type analysis
  app.get('/api/learning/historical/exits', async (req, res) => {
    try {
      const { getStoredSignals, analyzeExitTypes } = await import('../learning/index.js');

      const signals = await getStoredSignals(1000);

      if (signals.length < 5) {
        return res.json({ error: 'Not enough signals for exit analysis' });
      }

      const exits = analyzeExitTypes(signals);
      res.json(exits);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get weight adjustment recommendations based on historical data
  app.get('/api/learning/historical/weight-recommendations', async (req, res) => {
    try {
      const { getStoredSignals, analyzeAllFactors, generateWeightRecommendations } = await import('../learning/index.js');

      const signals = await getStoredSignals(1000);

      if (signals.length < 10) {
        return res.json({ error: 'Not enough signals for weight recommendations' });
      }

      const factors = analyzeAllFactors(signals);
      const recommendations = generateWeightRecommendations(factors);

      res.json({
        signalsAnalyzed: signals.length,
        recommendations,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ========== OPUS4.5 SELF-OPTIMIZATION ENDPOINTS ==========

  // Run full weight optimization (auto-update Opus4.5 based on historical data)
  app.post('/api/learning/optimize-weights', async (req, res) => {
    try {
      const { minSignals = 50, forceRun = false } = req.body;

      const { runWeightOptimization } = await import('../learning/index.js');
      const result = await runWeightOptimization({ minSignals, forceRun });

      // Clear weight cache so new weights are used immediately
      if (result.success && result.stored) {
        const { clearWeightCache } = await import('../opus45Signal.js');
        clearWeightCache();
      }

      res.json(result);
    } catch (e) {
      console.error('Weight optimization error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // Get current active weights (optimized or default)
  app.get('/api/learning/active-weights', async (req, res) => {
    try {
      const { loadOptimizedWeights } = await import('../learning/index.js');
      const result = await loadOptimizedWeights();
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Compare default vs optimized weights
  app.get('/api/learning/compare-weights', async (req, res) => {
    try {
      const { loadOptimizedWeights } = await import('../learning/index.js');
      const { DEFAULT_WEIGHTS } = await import('../opus45Signal.js');

      const optimized = await loadOptimizedWeights();

      // Calculate differences
      const differences = [];
      if (optimized.source === 'optimized') {
        for (const [key, defaultVal] of Object.entries(DEFAULT_WEIGHTS)) {
          const optimizedVal = optimized.weights[key];
          if (optimizedVal !== defaultVal) {
            differences.push({
              weight: key,
              default: defaultVal,
              optimized: optimizedVal,
              delta: optimizedVal - defaultVal,
            });
          }
        }
      }

      res.json({
        default: DEFAULT_WEIGHTS,
        optimized: optimized.weights,
        source: optimized.source,
        signalsAnalyzed: optimized.signalsAnalyzed,
        generatedAt: optimized.generatedAt,
        differences,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Latest A/B learning run result (control vs variant comparison)
  app.get('/api/learning/latest-ab', async (req, res) => {
    try {
      const { loadLatestLearningRun } = await import('../learning/index.js');
      const run = await loadLatestLearningRun();
      if (!run) {
        return res.json({ available: false, message: 'No learning runs found. Run iterative-optimize first.' });
      }
      res.json({
        available: true,
        runNumber: run.run_number,
        objective: run.objective,
        control: {
          source: run.control_source,
          avgReturn: run.control_avg_return,
          expectancy: run.control_expectancy,
          winRate: run.control_win_rate,
          avgWin: run.control_avg_win,
          avgLoss: run.control_avg_loss,
          profitFactor: run.control_profit_factor,
          signalCount: run.control_signal_count,
        },
        variant: {
          avgReturn: run.variant_avg_return,
          expectancy: run.variant_expectancy,
          winRate: run.variant_win_rate,
          avgWin: run.variant_avg_win,
          avgLoss: run.variant_avg_loss,
          profitFactor: run.variant_profit_factor,
          signalCount: run.variant_signal_count,
        },
        delta: {
          avgReturn: run.delta_avg_return,
          expectancy: run.delta_expectancy,
          winRate: run.delta_win_rate,
        },
        factorChanges: run.factor_changes || [],
        topFactors: run.top_factors || [],
        promoted: run.promoted,
        promotionReason: run.promotion_reason,
        iterationsRun: run.iterations_run,
        signalsEvaluated: run.signals_evaluated,
        completedAt: run.completed_at,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Learning run history (last N A/B comparisons, optionally filtered by agent)
  app.get('/api/learning/run-history', async (req, res) => {
    try {
      const limit = Math.min(50, parseInt(req.query.limit) || 20);
      const agentType = req.query.agent || null;
      const { loadLearningRunHistory } = await import('../learning/index.js');
      const runs = await loadLearningRunHistory(limit, agentType);
      res.json({
        total: runs.length,
        runs: runs.map((r) => ({
          runNumber: r.run_number,
          agentType: r.agent_type || 'default',
          regimeTag: r.regime_tag || null,
          objective: r.objective,
          controlAvgReturn: r.control_avg_return,
          variantAvgReturn: r.variant_avg_return,
          deltaAvgReturn: r.delta_avg_return,
          controlExpectancy: r.control_expectancy,
          variantExpectancy: r.variant_expectancy,
          deltaExpectancy: r.delta_expectancy,
          controlWinRate: r.control_win_rate,
          variantWinRate: r.variant_win_rate,
          controlProfitFactor: r.control_profit_factor,
          variantProfitFactor: r.variant_profit_factor,
          promoted: r.promoted,
          promotionReason: r.promotion_reason,
          iterationsRun: r.iterations_run,
          signalsEvaluated: r.signals_evaluated,
          completedAt: r.completed_at,
        })),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Regime leaderboard from learning run history.
  app.get('/api/learning/leaderboard/regime', async (req, res) => {
    try {
      const limit = Math.min(5000, parseInt(req.query.limit) || 1000);
      const { loadLearningRunHistory } = await import('../learning/index.js');
      const runs = await loadLearningRunHistory(limit, null);

      const leaderboard = {};
      for (const r of runs || []) {
        const regime = r.regime_tag || 'UNKNOWN';
        const agent = r.agent_type || 'default';
        if (!leaderboard[regime]) leaderboard[regime] = {};
        if (!leaderboard[regime][agent]) {
          leaderboard[regime][agent] = {
            runs: 0,
            promotions: 0,
            avgDeltaExpectancy: 0,
            avgDeltaWinRate: 0,
            avgDeltaAvgReturn: 0,
            promotionRate: 0,
          };
        }
        const row = leaderboard[regime][agent];
        row.runs += 1;
        if (r.promoted) row.promotions += 1;
        row.avgDeltaExpectancy += Number(r.delta_expectancy || 0);
        row.avgDeltaWinRate += Number(r.delta_win_rate || 0);
        row.avgDeltaAvgReturn += Number(r.delta_avg_return || 0);
      }

      for (const regime of Object.keys(leaderboard)) {
        for (const agent of Object.keys(leaderboard[regime])) {
          const row = leaderboard[regime][agent];
          row.avgDeltaExpectancy = Math.round((row.avgDeltaExpectancy / Math.max(row.runs, 1)) * 100) / 100;
          row.avgDeltaWinRate = Math.round((row.avgDeltaWinRate / Math.max(row.runs, 1)) * 100) / 100;
          row.avgDeltaAvgReturn = Math.round((row.avgDeltaAvgReturn / Math.max(row.runs, 1)) * 100) / 100;
          row.promotionRate = Math.round((row.promotions / Math.max(row.runs, 1)) * 1000) / 10;
        }
      }

      res.json({ totalRuns: runs.length, leaderboard });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Archive legacy learning runs whose objective is not expectancy.
  // This keeps the active dashboard focused on one comparable objective.
  app.post('/api/learning/run-history/archive-legacy', async (req, res) => {
    try {
      const {
        keepObjective = 'expectancy',
        dryRun = false,
        beforeDate = null,
        limit = 5000,
      } = req.body || {};

      const { archiveLearningRuns } = await import('../learning/index.js');
      const result = await archiveLearningRuns({
        keepObjective,
        dryRun: !!dryRun,
        beforeDate,
        limit,
      });

      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Full self-learning pipeline: scan history + analyze + optimize weights
  app.post('/api/learning/full-pipeline', async (req, res) => {
    try {
      const { tickers, lookbackMonths = 60, tickerLimit = 0 } = req.body;

      console.log('🚀 Starting full self-learning pipeline...');
      if (tickerLimit > 0) {
        console.log(`   Ticker limit: ${tickerLimit}`);
      }

      // Step 1: Run historical analysis
      const { runHistoricalAnalysis } = await import('../learning/index.js');
      const scanResult = await runHistoricalAnalysis({
        tickers,
        lookbackMonths,
        tickerLimit,
        storeInDatabase: true,
      });

      if (!scanResult.success) {
        return res.json({ success: false, step: 'scan', error: scanResult.message });
      }

      console.log(`📊 Scanned ${scanResult.totalSignals} signals`);

      // Step 2: Optimize weights
      const { runWeightOptimization } = await import('../learning/index.js');
      const optimizeResult = await runWeightOptimization({
        minSignals: 10,
        forceRun: true,
      });

      // Step 3: Clear cache so new weights are used
      if (optimizeResult.success) {
        const { clearWeightCache } = await import('../opus45Signal.js');
        clearWeightCache();
      }

      console.log('✅ Full pipeline complete');

      res.json({
        success: true,

        // Scan results
        signalsScanned: scanResult.totalSignals,
        overallStats: scanResult.overallStats,

        // Optimization results
        weightAdjustments: optimizeResult.adjustments,
        optimizedWeights: optimizeResult.optimizedWeights,

        // Summary
        report: scanResult.report,
        optimizationSummary: optimizeResult.summary,
      });
    } catch (e) {
      console.error('Full pipeline error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // Run-agents: same as Marcus orchestration, SSE shape expected by UI + Python heartbeat (phase/message, final phase: 'done' + result)
  app.post('/api/learning/run-agents', async (req, res) => {
    const { tickerLimit = 200, forceRefresh = false } = req.body || {};

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const send = (obj) => {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
      res.flush?.();
    };

    try {
      send({ phase: 'starting', message: 'Marcus: starting orchestration...' });
      const { runMarcusOrchestration } = await import('../agents/marcus.js');
      const result = await runMarcusOrchestration({
        tickerLimit,
        forceRefresh,
        onProgress: (p) => send(p),
      });
      // UI expects phase: 'done' and result with regime.regime, signalCount, elapsedMs
      const payload = {
        phase: 'done',
        result: {
          ...result,
          regime: result.regime != null ? { regime: result.regime } : undefined,
          signalCount: result.signalCount,
          successfulAgents: result.approvedCount,
          elapsedMs: result.elapsedMs,
        },
      };
      send(payload);
      res.end();
    } catch (e) {
      console.error('Run-agents error:', e);
      send({ phase: 'done', result: { error: e.message } });
      res.end();
    }
  });

  // Iterative Profitability Optimization - SSE version with real-time progress
  // Now includes A/B comparison: control vs variant with automatic promotion
  app.post('/api/learning/iterative-optimize', async (req, res) => {
    const {
      maxIterations = 100,
      targetProfit = 8,
      lookbackMonths = 12,
      tickerLimit = 200,
    } = req.body;

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const send = (obj) => {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
      res.flush?.();
    };

    try {
      console.log('\n🔄 Starting iterative optimization loop...');
      console.log(`   Target: ${targetProfit}% avg profit`);
      console.log(`   Max iterations: ${maxIterations}`);
      console.log(`   Ticker limit: ${tickerLimit}`);

      send({ phase: 'starting', message: 'Starting optimization...', tickerLimit, maxIterations });

      const { runIterativeOptimizationWithProgress } = await import('../learning/index.js');

      const result = await runIterativeOptimizationWithProgress({
        maxIterations,
        targetProfit,
        lookbackMonths,
        tickerLimit,
        onProgress: (progress) => {
          send(progress);
        },
      });

      // Weight saving and A/B promotion is now handled inside runIterativeOptimization.
      // The result includes abComparison with promoted flag.

      send({ done: true, result });
      res.end();
    } catch (e) {
      console.error('Iterative optimization error:', e);
      send({ done: true, error: e.message });
      res.end();
    }
  });
}
