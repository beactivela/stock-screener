/**
 * 10-20 Cross Over — Signal Agent
 *
 * Simple trend-following agent:
 *   - Buy when 10 MA crosses above 20 MA
 *   - Sell when price closes below 10 MA
 */

import { createStrategyAgent } from './strategyAgentBase.js';

const maCrossover_10_20 = createStrategyAgent({
  name: '10-20 Cross Over',
  agentType: 'ma_crossover_10_20',
  signalFamily: 'ma_crossover',
  objective: 'expectancy',
  minImprovement: 0.5,
  riskGates: {
    minTrades: 200,
    minProfitFactor: 1.5,
    maxDrawdownPct: 20,
    minSharpe: 1,
    minSortino: 1,
  },

  trainingFilter: (signal) => {
    const ctx = signal.context || {};
    return ctx.ma10Above20 === true;
  },
});

export default maCrossover_10_20;
