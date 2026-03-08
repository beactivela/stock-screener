/**
 * Commander — Multi-Agent Coordinator
 *
 * Orchestrates the full multi-agent optimization pipeline:
 *   1. Market Pulse classifies the regime and sets agent budgets
 *   2. Signal pool is fetched once (shared across all agents)
 *   3. Strategy agents run in parallel, each on its filtered subset
 *   4. Commander merges results, deduplicates, and reports per-agent A/B
 *
 * Replaces the monolithic runIterativeOptimization() call with a
 * fan-out/fan-in pattern across multiple specialist agents.
 */

import { classifyMarket } from './marketPulse.js';
import momentumScout from './momentumScout.js';
import baseHunter from './baseHunter.js';
import breakoutTracker from './breakoutTracker.js';
import turtleTrader from './turtleTrader.js';
import { getTickerList, scanMultipleTickers } from '../learning/historicalSignalScanner.js';
import { getStoredSignals, storeSignalsInDatabase } from '../learning/autoPopulate.js';
import { isSupabaseConfigured } from '../supabase.js';

const STRATEGY_AGENTS = [momentumScout, baseHunter, breakoutTracker, turtleTrader];

// Same exit strategy versioning as the single-agent optimizer
const EXIT_STRATEGY_VERSION = 2;

/**
 * Run the full multi-agent optimization pipeline.
 *
 * @param {Object} options
 * @param {number} options.lookbackMonths  - Historical data lookback
 * @param {number} options.tickerLimit     - Max tickers to scan
 * @param {number} options.maxIterations   - Iterations per agent
 * @param {number} options.targetProfit    - Target avg return per trade
 * @param {Function} options.onProgress    - SSE progress callback
 * @param {boolean} options.forceRefresh   - Bypass signal cache
 * @param {string[]} options.agentTypes    - Subset of agents to run (null = all)
 * @returns {Promise<Object>} Combined results from all agents
 */
export async function runMultiAgentOptimization(options = {}) {
  const {
    // 60 months (5 years) gives 3,000–5,000 signals vs 165 with 12 months.
    // More signals = meaningful WFO train/test splits and Bayesian updates.
    lookbackMonths = 60,
    tickerLimit = 200,
    maxIterations = 20,
    targetProfit = 5,
    onProgress = null,
    forceRefresh = false,
    agentTypes = null,
  } = options;

  const startedAt = Date.now();

  // ── Step 1: Market Pulse ──
  if (onProgress) {
    onProgress({ phase: 'regime', message: 'Market Pulse: classifying regime...' });
  }

  let regime;
  try {
    regime = await classifyMarket();
  } catch (e) {
    console.warn('Commander: Market Pulse failed, using UNCERTAIN fallback:', e.message);
    regime = {
      regime: 'UNCERTAIN',
      confidence: 0,
      exposureMultiplier: 0.75,
      agentBudgets: {
        momentum_scout: 0.20,
        breakout_tracker: 0.15,
        base_hunter: 0.30,
        turtle_trader: 0.35,
      },
    };
  }

  if (onProgress) {
    onProgress({
      phase: 'regime_complete',
      regime: regime.regime,
      confidence: regime.confidence,
      exposureMultiplier: regime.exposureMultiplier,
      agentBudgets: regime.agentBudgets,
      message: `Market regime: ${regime.regime} (${regime.confidence}% confidence)`,
    });
  }

  // In BEAR regime, no signals should be generated
  if (regime.regime === 'BEAR') {
    if (onProgress) {
      onProgress({ phase: 'done', message: 'BEAR regime — all agents paused.' });
    }
    return {
      success: true,
      regime,
      agentResults: [],
      summary: 'BEAR regime detected — no optimization run. All agents paused.',
    };
  }

  // ── Step 2: Fetch shared signal pool ──
  if (onProgress) {
    onProgress({ phase: 'scanning', message: 'Fetching historical signals...', current: 0, total: tickerLimit });
  }

  const signals = await fetchSignalPool({
    lookbackMonths,
    tickerLimit,
    forceRefresh,
    signalFamilies: ['opus45', 'turtle'],
    onProgress,
  });

  if (!signals || signals.length < 10) {
    return {
      success: false,
      error: `Insufficient signals (${signals?.length || 0})`,
      regime,
    };
  }

  if (onProgress) {
    onProgress({
      phase: 'signals_ready',
      signalCount: signals.length,
      message: `${signals.length} signals ready — fanning out to agents...`,
    });
  }

  // ── Step 3: Fan out to strategy agents in parallel ──
  const activeAgents = STRATEGY_AGENTS.filter((agent) => {
    if (agentTypes && !agentTypes.includes(agent.agentType)) return false;
    const budget = regime.agentBudgets[agent.agentType] || 0;
    return budget > 0;
  });

  if (onProgress) {
    onProgress({
      phase: 'agents_starting',
      agents: activeAgents.map((a) => ({ name: a.name, type: a.agentType, budget: regime.agentBudgets[a.agentType] })),
      message: `Running ${activeAgents.length} agents in parallel...`,
    });
  }

  const agentPromises = activeAgents.map((agent) =>
    agent.optimize(signals, {
      maxIterations,
      targetProfit,
      onProgress: onProgress
        ? (p) => onProgress({ ...p, agent: agent.agentType, agentName: agent.name })
        : null,
    }).catch((err) => ({
      agentType: agent.agentType,
      name: agent.name,
      success: false,
      error: err.message,
    }))
  );

  const agentResults = await Promise.all(agentPromises);

  // ── Step 4: Merge and report ──
  const successfulAgents = agentResults.filter((r) => r.success);
  const failedAgents = agentResults.filter((r) => !r.success);

  // Build summary
  const summaryLines = [
    `Multi-Agent Optimization Complete`,
    `═══════════════════════════════════════`,
    `Regime: ${regime.regime} (${regime.confidence}% confidence)`,
    `Exposure: ${(regime.exposureMultiplier * 100).toFixed(0)}%`,
    `Total signals: ${signals.length}`,
    `Agents run: ${activeAgents.length}`,
    ``,
  ];

  for (const result of agentResults) {
    if (result.success) {
      const ab = result.abComparison;
      summaryLines.push(
        `[${result.name}] ${result.signalCount} signals`,
        `  Control: ${ab?.controlMetrics?.avgReturn?.toFixed(2) || '?'}% avg`,
        `  Variant: ${ab?.variantMetrics?.avgReturn?.toFixed(2) || '?'}% avg`,
        `  ${ab?.promoted ? 'PROMOTED' : 'Rejected'}: ${ab?.promotionReason || ''}`,
        ``
      );
    } else {
      summaryLines.push(`[${result.name}] FAILED: ${result.error || result.reason}`, ``);
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  summaryLines.push(`Completed in ${elapsed}s`);

  const finalResult = {
    success: true,
    regime,
    signalCount: signals.length,
    agentResults,
    successfulAgents: successfulAgents.length,
    failedAgents: failedAgents.length,
    summary: summaryLines.join('\n'),
    elapsedMs: Date.now() - startedAt,
  };

  if (onProgress) {
    onProgress({
      phase: 'done',
      result: finalResult,
      message: `Multi-agent optimization complete (${elapsed}s)`,
    });
  }

  return finalResult;
}

/**
 * Fetch the shared signal pool (cached or fresh).
 * Reuses the same caching logic as the single-agent optimizer.
 */
async function fetchSignalPool({ lookbackMonths, tickerLimit, forceRefresh, signalFamilies = ['opus45', 'turtle', 'ma_crossover'], onProgress }) {
  // Try database cache first
  if (!forceRefresh && isSupabaseConfigured()) {
    try {
      if (onProgress) {
        onProgress({ phase: 'checking_db', message: 'Checking database for cached signals...' });
      }

      const storedSignals = await getStoredSignals(2000);

      if (storedSignals && storedSignals.length > 0) {
        const latestSignal = storedSignals[0];
        const scanDate = latestSignal.scanDate || latestSignal.created_at;
        const storedExitVersion = latestSignal.exitStrategyVersion || 1;
        const needsTurtle = signalFamilies.includes('turtle');
        const hasTurtleSignals = needsTurtle
          ? storedSignals.some((s) => (s.signalFamily === 'turtle') || (s.context?.signalFamily === 'turtle'))
          : true;

        if (scanDate && storedExitVersion >= EXIT_STRATEGY_VERSION) {
          const ageDays = (Date.now() - new Date(scanDate).getTime()) / (1000 * 60 * 60 * 24);

          // Verify signals actually span the expected history window.
          // A real 5yr deep scan will have signals dating back to 2021-2022.
          // Stale cached signals may have lookback_months=60 in metadata but only
          // cover recent months — we detect this by checking actual entry_date span.
          const entryDates = storedSignals
            .map((s) => s.entryDate || s.entry_date)
            .filter(Boolean)
            .sort();
          const earliestEntry = entryDates[0];
          const latestEntry = entryDates[entryDates.length - 1];
          const spanDays = earliestEntry && latestEntry
            ? (new Date(latestEntry) - new Date(earliestEntry)) / (1000 * 60 * 60 * 24)
            : 0;

          // Deep scan: metadata says 5yr AND signals actually span >= 18 months of history.
          // Without the span check, retroactively-labeled data would falsely skip the rescan.
          const metadataDeep = (latestSignal.lookbackMonths || 12) >= 36;
          const isDeepScan = metadataDeep && spanDays >= 540; // 540 days ≈ 18 months
          const maxCacheAgeDays = isDeepScan ? 90 : 7;

          console.log(
            `Commander cache check: ${storedSignals.length} signals, span=${spanDays.toFixed(0)}d, ` +
            `metadataDeep=${metadataDeep}, isDeepScan=${isDeepScan}, age=${ageDays.toFixed(1)}d`
          );

          if (ageDays < maxCacheAgeDays && hasTurtleSignals) {
            if (onProgress) {
              onProgress({
                phase: 'db_cache',
                message: `Using ${storedSignals.length} signals from database (${ageDays.toFixed(1)}d old, ${isDeepScan ? '5yr deep scan' : 'recent scan'})`,
                signalCount: storedSignals.length,
                fromCache: true,
              });
            }
            return storedSignals;
          }
        }
      }
    } catch (e) {
      console.warn('Commander: DB cache check failed:', e.message);
    }
  }

  // Fresh scan
  let tickerList = await getTickerList();
  if (tickerLimit > 0 && tickerList.length > tickerLimit) {
    tickerList = tickerList.slice(0, tickerLimit);
  }

  const progressCallback = onProgress
    ? (p) => onProgress({ phase: 'scanning', ...p, message: `Scanning ${p.ticker}... (${p.current}/${p.total})` })
    : null;

  const scanResults = await scanMultipleTickers(tickerList, lookbackMonths, progressCallback, { signalFamilies });

  // Persist to database for future runs
  if (isSupabaseConfigured() && scanResults.signals?.length > 0) {
    if (onProgress) {
      onProgress({ phase: 'saving', message: `Saving ${scanResults.signals.length} signals to database...` });
    }
    await storeSignalsInDatabase(scanResults.signals);
  }

  return scanResults.signals || [];
}

/**
 * Get a summary of all registered agents and their current status.
 */
export function getAgentManifest() {
  return STRATEGY_AGENTS.map((agent) => ({
    name: agent.name,
    agentType: agent.agentType,
    mandatoryOverrides: agent.mandatoryOverrides,
  }));
}

export { STRATEGY_AGENTS };
