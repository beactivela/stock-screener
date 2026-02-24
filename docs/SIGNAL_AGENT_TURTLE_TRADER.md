# Signal Agent — Turtle Trader

**Purpose:** Run a separate “trend breakout” signal family (`turtle`) based on classic Turtle rules (Donchian channel breakouts + volatility-aware filters). This agent is your “trend-following breakout” specialist and acts as diversification vs VCP-style `opus45` signals.

## Identity (constants)

| Field | Value |
|---|---|
| Name | `Turtle Trader` |
| `agentType` | `turtle_trader` |
| `signalFamily` | `turtle` |
| Implementation | `server/agents/turtleTrader.js` |
| Shared base | `server/agents/strategyAgentBase.js` |
| Doctrine source | `server/agents/northstar.js` (for shared RS/risk defaults; Turtle has its own signal family) |

## What it optimizes for

- **Primary edge**: strong, sustained trends that confirm with breakout behavior.
- **Key distinction**: it does *not* require VCP-specific structure; it requires Turtle breakout context flags instead.

## Hard filters (actually enforced)

Configured in `mandatoryOverrides` in `server/agents/turtleTrader.js`, enforced by `strategyAgentBase.filterSignals()`:

- **RS minimum**: \(RS \ge 80\)

Additionally, `strategyAgentBase.filterSignals()` will exclude signals whose `context.signalFamily` doesn’t match `turtle` (when that field exists on the signal).

## Training filter (agent specialization)

Only trains on signals where:

- A breakout happened: `context.turtleBreakout20 || context.turtleBreakout55`
- Trend structure is valid:
  - `context.maAlignmentValid !== false`
  - `context.priceAboveAllMAs !== false`
  - `context.ma200Rising !== false`
- RS quality: `context.relativeStrength >= 80`
- Volatility sanity check (if present): `atr20Pct` is between 1% and 8%

## Default weight biases (starting point)

Emphasizes trend strength + breakout proximity:

- `slope10MAElite`: 28
- `slope10MAStrong`: 22
- `entryRSAbove90`: 12
- `pctFromHighIdeal`: 10
- `pctFromHighGood`: 6
- `entryVolumeConfirm`: 8

## Minimum data requirement

- **Minimum filtered signals to run**: 8 (set via `minSignals: 8` in `server/agents/turtleTrader.js`)

## Market regime budget (source of truth)

Budget allocation is set centrally by Market Pulse (`server/agents/marketPulse.js`).

| Regime | Budget for `turtle_trader` |
|---|---:|
| `BULL` | 0.20 |
| `UNCERTAIN` | 0.20 |
| `CORRECTION` | 0.20 |
| `BEAR` | 0.00 |

## Where you’ll see it in the product

- **Agents dashboard**: shows Turtle Trader under “Signal agents” alongside the `opus45` specialists.
- **Marcus mission briefing**: reports its control vs variant test performance just like the other agents.

## Practical interpretation

- If Turtle Trader is outperforming while VCP agents struggle, you’re often in a market where breakouts exist but are more “trend-following / channel breakout” than classic base breakouts.
- If Turtle is weak too, you’re likely in a hostile tape (distribution / bear) and the regime gate should be suppressing new buys.

