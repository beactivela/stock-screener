import { STRATEGY_AGENTS } from '../agents/harryHistorian.js';
import { getStoredSignals } from '../learning/autoPopulate.js';
import { getTickerList, scanMultipleTickers } from '../learning/historicalSignalScanner.js';

const AGENT_FAMILY_MAP = {
  momentum_scout: ['opus45'],
  base_hunter: ['opus45'],
  breakout_tracker: ['opus45'],
  turtle_trader: ['turtle'],
  ma_crossover_10_20: ['ma_crossover'],
};

function normalizeFamily(signal) {
  return signal.signalFamily || signal.context?.signalFamily || null;
}

function filterByFamily(signals, families) {
  if (!families || families.length === 0) return signals;
  const allowed = new Set(families);
  return signals.filter((s) => allowed.has(normalizeFamily(s)));
}

export function resolveAgent(agentType) {
  const agent = STRATEGY_AGENTS.find((a) => a.agentType === agentType);
  if (!agent) throw new Error(`Unknown agentType: ${agentType}`);
  return agent;
}

export async function loadAgentSignals({
  agentType,
  lookbackMonths = 60,
  tickerLimit = 0,
  forceRefresh = false,
}) {
  if (!agentType) throw new Error('agentType is required');
  const agent = resolveAgent(agentType);
  const families = AGENT_FAMILY_MAP[agentType] || ['opus45', 'turtle'];

  let signals = [];

  if (!forceRefresh) {
    const stored = await getStoredSignals(5000);
    if (stored && stored.length > 0) {
      const filteredStored = filterByFamily(stored, families);
      if (filteredStored.length > 0) {
        signals = filteredStored;
      }
    }
  }

  if (signals.length === 0) {
    let tickers = await getTickerList();
    if (tickerLimit > 0 && tickers.length > tickerLimit) {
      tickers = tickers.slice(0, tickerLimit);
    }
    const scanResults = await scanMultipleTickers(tickers, lookbackMonths, null, { signalFamilies: families });
    signals = scanResults.signals || [];
  }

  const filtered = agent.filterSignals(signals);
  return {
    agent,
    signals: filtered,
    meta: {
      totalSignals: signals.length,
      filteredSignals: filtered.length,
      families,
    },
  };
}
