# Signal Agent — 10-20 Cross Over

**Purpose:** Simple trend-following agent that buys on a 10/20 MA bullish crossover and exits on the first close below the 10 MA.

## Identity (constants)

| Field | Value |
| --- | --- |
| Name | `10-20 Cross Over` |
| `agentType` | `ma_crossover_10_20` |
| `signalFamily` | `ma_crossover` |
| Implementation | `server/agents/maCrossover_10_20.js` |
| Signal generator | `server/learning/historicalSignalScanner.js` |

## Entry rules (hard)

- **Buy** when the 10 MA crosses **above** the 20 MA.
  - Implemented as: `ma10 > ma20` **and** `ma10_prev <= ma20_prev`.

## Exit rules (hard)

- **Sell** on the **first close below the 10 MA**.

## Minimum data requirement

- **Minimum filtered signals to run**: 10 (default `minSignals` from `strategyAgentBase.js`).

## Where you’ll see it in the product

- **Agents dashboard**: shows as a signal agent with basic metrics and description.
