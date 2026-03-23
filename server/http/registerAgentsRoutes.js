/**
 * /api/agents/* HTTP routes (Market Pulse, conversations, Harry, optimize, per-agent weights).
 * `registerAgentsSignalHistoryRoute` is invoked from `registerOpus45Routes` between opus history and exit-check to preserve legacy route order.
 */

import { getBars } from '../yahoo.js';
import { checkVCP } from '../vcp.js';
import { generateOpus45Signal } from '../opus45Signal.js';
import { loadOptimizedWeights } from '../opus45Learning.js';
import { getBars as getBarsFromDb, saveBars as saveBarsToDb } from '../db/bars.js';
import { loadOpus45Signals as loadOpus45SignalsFromDb } from '../db/opus45.js';
import { runConversationForSignal } from '../agents/conversationOrchestrator.js';
import { saveConversation, loadConversation, labelConversation } from '../agents/conversationStore.js';
import { classifyMarket } from '../agents/marketPulse.js';
import { resolveSignalFromCache } from '../agents/conversationSignalSource.js';
import { scanTickerForSignals } from '../learning/historicalSignalScanner.js';
import { buildAgentSignalOverlay } from '../agents/agentSignalOverlay.js';
import { runBacktestHierarchy } from '../backtesting/index.js';
import { buildLearningRunFromHierarchy } from '../backtesting/learningBridge.js';
import { loadFundamentals } from './registerCoreScanCronBarsMarketRoutes.js';
import { getDefaultDateRange } from './query.js';

/** In-memory state for Harry fetch so progress survives client disconnect (background job) */
const harryFetchState = {
  status: 'idle',
  phase: null,
  message: null,
  current: null,
  total: null,
  ticker: null,
  signalCount: null,
  result: null,
  error: null,
  startedAt: null,
  completedAt: null,
};

/**
 * Per-agent buy signals for chart overlays (Momentum Scout, Base Hunter, Breakout Tracker, Turtle Trader).
 * @param {import('express').Application} app
 */
export function registerAgentsSignalHistoryRoute(app) {
  app.get('/api/agents/signals/:ticker/history', async (req, res) => {
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

      if (!bars || bars.length < 250) {
        return res.json({
          ticker,
          agents: {},
          reason: 'Insufficient data (need 250+ days)',
        });
      }

      const signals = scanTickerForSignals(ticker, bars, {
        lookbackMonths: 12,
        signalFamilies: ['opus45', 'turtle'],
      });

      const agents = buildAgentSignalOverlay({ signals, bars });

      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');

      res.json({
        ticker,
        agents,
        scannedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error(`Agent signal history error for ${ticker}:`, e);
      res.status(500).json({ error: e.message });
    }
  });
}

/**
 * @param {import('express').Application} app
 */
export function registerAgentsRoutesBeforeHeartbeat(app) {
  app.get('/api/agents/regime', async (req, res) => {
    try {
      const regime = await classifyMarket({ persist: false });
      res.json(regime);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

/**
 * @param {import('express').Application} app
 */
export function registerAgentsRoutesAfterHeartbeat(app) {
  app.get('/api/agents/manifest', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
      const { getMarcusManifest } = await import('../agents/marcus.js');
      res.json(getMarcusManifest());
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/agents/conversation/run', async (req, res) => {
    try {
      const { ticker, signal, regime, constraints } = req.body || {};

      let targetSignal = signal || null;
      if (!targetSignal) {
        const cached = await loadOpus45SignalsFromDb().catch(() => null);
        const signals = cached?.signals || [];
        targetSignal = resolveSignalFromCache({ ticker, cachedSignals: signals });
      }

      if (!targetSignal && ticker) {
        const to = new Date();
        const from365 = new Date(to);
        from365.setDate(from365.getDate() - 365);
        const fromStr365 = from365.toISOString().slice(0, 10);
        const toStr = to.toISOString().slice(0, 10);

        const bars = await getBarsFromDb(ticker, fromStr365, toStr, '1d');
        if (!bars || bars.length < 200) {
          return res.status(400).json({
            error: 'No cached bars for that ticker. Run “Fetch 5yr history” or a scan first, then retry.',
          });
        }

        const vcpResult = checkVCP(bars);
        const fundamentals = await loadFundamentals();
        const tickerFundamentals = fundamentals[ticker] || null;
        const industryData = null;
        const weights = loadOptimizedWeights();
        const singleSignal = generateOpus45Signal(vcpResult, bars, tickerFundamentals, industryData, weights);
        targetSignal = { ticker, ...singleSignal };
      }

      if (!targetSignal && !ticker) {
        targetSignal = {
          ticker: 'SYSTEM',
          signalType: 'META',
          opus45Confidence: 0,
          riskRewardRatio: null,
          metrics: {},
        };
      }

      if (!targetSignal) {
        return res.status(400).json({
          error: 'No cached Opus45 signals found. Provide { ticker } to compute a single signal, or run /api/opus45/signals first.',
        });
      }

      const market = regime ? { regime } : await classifyMarket({ persist: false });
      const result = await runConversationForSignal(targetSignal, {
        regime: market.regime || 'UNCERTAIN',
        constraints,
        timeoutMs: Number(process.env.AGENT_DIALOGUE_TIMEOUT_MS) || 30000,
      });

      const saved = await saveConversation({
        ticker: targetSignal.ticker,
        regime: market.regime || 'UNCERTAIN',
        signal: targetSignal,
        decision: result.decision,
        transcript: result.transcript,
      });

      res.json(saved);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/agents/conversation/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const convo = await loadConversation(id);
      if (!convo) return res.status(404).json({ error: 'Conversation not found' });
      res.json(convo);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/agents/conversation/:id/label', async (req, res) => {
    try {
      const { id } = req.params;
      const { outcome } = req.body || {};
      if (!outcome) return res.status(400).json({ error: 'Outcome is required' });
      const updated = await labelConversation(id, outcome);
      if (!updated) return res.status(404).json({ error: 'Conversation not found' });
      res.json(updated);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/agents/harry/fetch/status', (req, res) => {
    res.json({
      status: harryFetchState.status,
      phase: harryFetchState.phase,
      message: harryFetchState.message,
      current: harryFetchState.current,
      total: harryFetchState.total,
      ticker: harryFetchState.ticker,
      signalCount: harryFetchState.signalCount,
      result: harryFetchState.result,
      error: harryFetchState.error,
      startedAt: harryFetchState.startedAt,
      completedAt: harryFetchState.completedAt,
    });
  });

  app.get('/api/agents/harry/ohlc-count', async (req, res) => {
    try {
      const { getTickerCountWith5YrBars } = await import('../db/bars.js');
      const { getTickerList } = await import('../learning/historicalSignalScanner.js');
      const { getLastHarryFetchAt } = await import('../learning/autoPopulate.js');
      const [count, tickerList, lastFetchAt] = await Promise.all([
        getTickerCountWith5YrBars(),
        getTickerList(),
        getLastHarryFetchAt(),
      ]);
      res.json({
        count,
        totalTickers: tickerList?.length ?? 0,
        lastFetchAt: lastFetchAt || null,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/agents/harry/fetch', async (req, res) => {
    const { tickerLimit = 0, forceRefresh = true } = req.body || {};

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const send = (obj) => {
      if (res.writableEnded) return;
      try {
        res.write(`data: ${JSON.stringify(obj)}\n\n`);
        res.flush?.();
      } catch {
        // Client disconnected; job continues, progress is in harryFetchState
      }
    };

    const updateState = (p) => {
      harryFetchState.phase = p.phase ?? harryFetchState.phase;
      harryFetchState.message = p.message ?? harryFetchState.message;
      harryFetchState.current = p.current ?? harryFetchState.current;
      harryFetchState.total = p.total ?? harryFetchState.total;
      harryFetchState.ticker = p.ticker ?? harryFetchState.ticker;
      harryFetchState.signalCount = p.signalCount ?? harryFetchState.signalCount;
    };

    harryFetchState.status = 'running';
    harryFetchState.startedAt = new Date().toISOString();
    harryFetchState.phase = null;
    harryFetchState.message = null;
    harryFetchState.current = null;
    harryFetchState.total = null;
    harryFetchState.ticker = null;
    harryFetchState.signalCount = null;
    harryFetchState.result = null;
    harryFetchState.error = null;
    harryFetchState.completedAt = null;

    try {
      const { runHarryFetchOnly } = await import('../agents/harryHistorian.js');
      const result = await runHarryFetchOnly({
        tickerLimit,
        forceRefresh: !!forceRefresh,
        onProgress: (p) => {
          updateState(p);
          send(p);
        },
      });
      harryFetchState.status = result.success ? 'done' : 'error';
      harryFetchState.result = result;
      harryFetchState.error = result.error ?? null;
      harryFetchState.completedAt = new Date().toISOString();
      send({ done: true, result });
      res.end();
    } catch (e) {
      console.error('Harry fetch error:', e);
      harryFetchState.status = 'error';
      harryFetchState.error = e.message;
      harryFetchState.completedAt = new Date().toISOString();
      send({ done: true, error: e.message });
      res.end();
    }
  });

  app.post('/api/agents/optimize', async (req, res) => {
    const {
      maxIterations = 20,
      targetProfit = 5,
      lookbackMonths = 60,
      tickerLimit = 200,
      agentTypes = null,
      forceRefresh = false,
      topDownFilter = true,
    } = req.body;

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
      send({ phase: 'starting', message: 'Starting multi-agent optimization...' });

      const { runMultiAgentOptimization } = await import('../agents/harryHistorian.js');

      const result = await runMultiAgentOptimization({
        maxIterations,
        targetProfit,
        lookbackMonths,
        tickerLimit,
        forceRefresh,
        agentTypes,
        topDownFilter,
        onProgress: (progress) => send(progress),
      });

      send({ done: true, result });
      res.end();
    } catch (e) {
      console.error('Multi-agent optimization error:', e);
      send({ done: true, error: e.message });
      res.end();
    }
  });

  app.post('/api/agents/optimize/batch', async (req, res) => {
    const {
      runId = `batch_${Date.now()}`,
      cyclesPerAgent = 25,
      maxIterations = 20,
      targetProfit = 5,
      lookbackMonths = 60,
      tickerLimit = 200,
      agentTypes = null,
      forceRefresh = false,
      topDownFilter = true,
      stopOnError = false,
      resume = false,
      maxCyclesPerRequest = 0,
      validationEnabled = false,
      validationWfoEveryNCycles = 10,
      validationWfoMcEveryNCycles = 25,
      validationHoldoutEveryNCycles = 0,
      validationHoldoutOnFinalCycle = true,
      validationPromotedOnly = true,
      validationMinDeltaExpectancy = 0.25,
      validationTrainMonths = 12,
      validationTestMonths = 3,
      validationStepMonths = 3,
      validationHoldoutPct = 0.2,
      validationHoldingPeriods = [60, 90, 120],
      validationMonteCarloTrials = 500,
      validationMinImprovement = 0.25,
      validationAllowWeightUpdates = true,
      validationTopN = null,
    } = req.body || {};

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const send = (obj) => {
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
      res.flush?.();
    };

    try {
      send({ phase: 'starting', runId, message: `Starting batch loop (${cyclesPerAgent} cycles per agent)...` });

      const { runBatchLearningLoop } = await import('../agents/harryHistorian.js');
      const {
        initializeBatchRun,
        appendBatchCheckpoint,
        finalizeBatchRun,
        getBatchRun,
      } = await import('../learning/batchCheckpointStore.js');

      const validationPolicy = {
        enabled: !!validationEnabled,
        wfoEveryNCycles: Number(validationWfoEveryNCycles) || 0,
        wfoMcEveryNCycles: Number(validationWfoMcEveryNCycles) || 0,
        holdoutEveryNCycles: Number(validationHoldoutEveryNCycles) || 0,
        holdoutOnFinalCycle: validationHoldoutOnFinalCycle !== false,
        validatePromotedOnly: validationPromotedOnly !== false,
        minPromotedDeltaExpectancy: Number.isFinite(Number(validationMinDeltaExpectancy))
          ? Number(validationMinDeltaExpectancy)
          : null,
      };

      const validationDateRange = getDefaultDateRange(5);
      const normalizedHoldingPeriods =
        Array.isArray(validationHoldingPeriods) && validationHoldingPeriods.length > 0
          ? validationHoldingPeriods.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0)
          : [60, 90, 120];

      const summarizeHierarchyMetrics = (tier, hierarchyResult) => {
        if (!hierarchyResult) return null;
        if (tier === 'wfo' || tier === 'wfo_mc') {
          return hierarchyResult.combinedTest || hierarchyResult.combinedTrain || null;
        }
        if (tier === 'holdout') {
          return hierarchyResult.holdout?.node?.summary || hierarchyResult.inSample?.wfo?.combinedTest || null;
        }
        return hierarchyResult.node?.summary || hierarchyResult.summary || null;
      };

      const runValidation = validationPolicy.enabled
        ? async ({ tier, agentType, cycle, cyclesPerAgent }) => {
            const tierLabel = String(tier || '').toUpperCase();
            const startedAtMs = Date.now();
            const emitValidationProgress = (payload = {}) => {
              send({
                phase: 'batch_validation_progress',
                tier,
                agentType,
                cycle,
                cyclesPerAgent,
                ...payload,
              });
            };

            emitValidationProgress({
              status: 'start',
              elapsedSec: 0,
              message: `Validation ${tierLabel} started for ${agentType} (cycle ${cycle}/${cyclesPerAgent})`,
            });

            const heartbeat = setInterval(() => {
              const elapsedSec = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
              emitValidationProgress({
                status: 'heartbeat',
                elapsedSec,
                message: `Validation ${tierLabel} running for ${agentType} (${elapsedSec}s elapsed)`,
              });
            }, 5000);

            try {
              const hierarchyResult = await runBacktestHierarchy({
                tier,
                engine: 'vectorbt',
                agentType,
                startDate: validationDateRange.startDate,
                endDate: validationDateRange.endDate,
                holdoutPct: Number(validationHoldoutPct) || 0.2,
                trainMonths: Number(validationTrainMonths) || 12,
                testMonths: Number(validationTestMonths) || 3,
                stepMonths: Number(validationStepMonths) || 3,
                candidateHoldingPeriods: normalizedHoldingPeriods.length > 0 ? normalizedHoldingPeriods : [60, 90, 120],
                optimizeMetric: 'expectancy',
                topN: validationTopN ?? tickerLimit ?? null,
                lookbackMonths,
                forceRefresh: false,
                warmupMonths: 12,
                monteCarloTrials: Number(validationMonteCarloTrials) || 500,
                monteCarloSeed: 42,
                onProgress: (evt) => {
                  const current = Number(evt?.current) || 0;
                  const total = Number(evt?.total) || 0;
                  const label = evt?.label ? String(evt.label) : 'Working';
                  emitValidationProgress({
                    status: 'step',
                    current,
                    total,
                    label,
                    elapsedSec: Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)),
                    message: `Validation ${tierLabel} ${current}/${total}: ${label}`,
                  });
                },
              });

              const learningRun = await buildLearningRunFromHierarchy({
                agentType,
                tier,
                result: hierarchyResult,
                objective: 'expectancy',
                allowWeightUpdates: validationAllowWeightUpdates !== false,
                minImprovement: Number(validationMinImprovement) || 0.25,
              });

              const elapsedSec = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
              emitValidationProgress({
                status: 'complete',
                elapsedSec,
                message: `Validation ${tierLabel} complete for ${agentType} (${elapsedSec}s)`,
              });

              const m = summarizeHierarchyMetrics(tier, hierarchyResult);
              return {
                cycle,
                tier,
                agentType,
                metrics: {
                  expectancy: m?.expectancy ?? null,
                  avgReturn: m?.avgReturn ?? null,
                  winRate: m?.winRate ?? null,
                  profitFactor: m?.profitFactor ?? null,
                  totalSignals: m?.totalSignals ?? null,
                },
                learningRun: {
                  stored: Boolean(learningRun?.stored),
                  promoted: Boolean(learningRun?.promoted),
                  objectiveDelta: learningRun?.objectiveDelta ?? null,
                  promotionReason: learningRun?.promotionReason ?? null,
                  weightUpdate: learningRun?.weightUpdate || null,
                },
              };
            } catch (e) {
              const elapsedSec = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
              emitValidationProgress({
                status: 'error',
                elapsedSec,
                error: e?.message || 'validation_failed',
                message: `Validation ${tierLabel} failed for ${agentType}: ${e?.message || 'validation_failed'}`,
              });
              throw e;
            } finally {
              clearInterval(heartbeat);
            }
          }
        : null;

      let startCycle = 1;
      let existingCycles = [];
      const normalizedMaxCyclesPerRequest = Math.max(0, Number(maxCyclesPerRequest) || 0);

      if (resume) {
        const priorRun = await getBatchRun(runId);
        if (priorRun) {
          const cycleMap = new Map();
          for (const c of priorRun?.finalResult?.cycles || []) {
            if (c?.cycle != null) cycleMap.set(c.cycle, c);
          }
          for (const cp of priorRun?.checkpoints || []) {
            const c = cp?.lastCycle;
            if (c?.cycle != null) cycleMap.set(c.cycle, c);
          }
          existingCycles = [...cycleMap.values()].sort((a, b) => (a?.cycle || 0) - (b?.cycle || 0));
          const lastCheckpointCycle =
            priorRun?.checkpoints?.length > 0
              ? priorRun.checkpoints[priorRun.checkpoints.length - 1]?.cycle || 0
              : existingCycles.length;
          startCycle = Math.max(1, lastCheckpointCycle + 1);

          if (lastCheckpointCycle >= cyclesPerAgent && priorRun?.finalResult) {
            send({
              done: true,
              result: priorRun.finalResult,
              message: 'Batch already complete; returned stored final result.',
            });
            res.end();
            return;
          }
        } else {
          await initializeBatchRun({
            runId,
            options: {
              cyclesPerAgent,
              maxIterations,
              targetProfit,
              lookbackMonths,
              tickerLimit,
              agentTypes,
              forceRefresh,
              topDownFilter,
              stopOnError,
              resume: true,
              maxCyclesPerRequest: normalizedMaxCyclesPerRequest,
              validationPolicy,
            },
          });
        }
      } else {
        await initializeBatchRun({
          runId,
          options: {
            cyclesPerAgent,
            maxIterations,
            targetProfit,
            lookbackMonths,
            tickerLimit,
            agentTypes,
            forceRefresh,
            topDownFilter,
            stopOnError,
            resume: false,
            maxCyclesPerRequest: normalizedMaxCyclesPerRequest,
            validationPolicy,
          },
        });
      }

      const result = await runBatchLearningLoop({
        runId,
        cyclesPerAgent,
        maxCycles: normalizedMaxCyclesPerRequest,
        startCycle,
        existingCycles,
        maxIterations,
        targetProfit,
        lookbackMonths,
        tickerLimit,
        agentTypes,
        forceRefresh,
        topDownFilter,
        stopOnError,
        validationPolicy,
        runValidation,
        onProgress: (progress) => send(progress),
        onCheckpoint: async (checkpoint) => {
          await appendBatchCheckpoint(runId, checkpoint);
          send({ phase: 'batch_checkpoint', checkpoint });
        },
      });

      if (result?.completed) {
        await finalizeBatchRun(runId, result);
      }
      send({ done: true, result, partial: !result?.completed });
      res.end();
    } catch (e) {
      console.error('Batch multi-agent optimization error:', e);
      send({ done: true, error: e.message });
      res.end();
    }
  });

  app.get('/api/agents/optimize/batch/:runId', async (req, res) => {
    try {
      const { getBatchRun } = await import('../learning/batchCheckpointStore.js');
      const run = await getBatchRun(req.params.runId);
      if (!run) return res.status(404).json({ error: 'Batch run not found' });
      res.json(run);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/agents/optimize/batch', async (req, res) => {
    try {
      const limit = Math.min(100, parseInt(req.query.limit) || 20);
      const { listBatchRuns } = await import('../learning/batchCheckpointStore.js');
      const runs = await listBatchRuns(limit);
      res.json({ total: runs.length, runs });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/agents/:agentType/weights', async (req, res) => {
    try {
      const { loadOptimizedWeights } = await import('../learning/index.js');
      const result = await loadOptimizedWeights(req.params.agentType);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/agents/:agentType/latest-ab', async (req, res) => {
    try {
      const { loadLatestLearningRun } = await import('../learning/index.js');
      const run = await loadLatestLearningRun(req.params.agentType);
      if (!run) {
        return res.json({ available: false, agentType: req.params.agentType });
      }
      res.json({
        available: true,
        agentType: run.agent_type,
        runNumber: run.run_number,
        control: {
          avgReturn: run.control_avg_return,
          expectancy: run.control_expectancy,
          winRate: run.control_win_rate,
          profitFactor: run.control_profit_factor,
        },
        variant: {
          avgReturn: run.variant_avg_return,
          expectancy: run.variant_expectancy,
          winRate: run.variant_win_rate,
          profitFactor: run.variant_profit_factor,
        },
        delta: {
          avgReturn: run.delta_avg_return,
          expectancy: run.delta_expectancy,
          winRate: run.delta_win_rate,
        },
        promoted: run.promoted,
        promotionReason: run.promotion_reason,
        completedAt: run.completed_at,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
