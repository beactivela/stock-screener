# Signal Agent — Momentum Scout

**Purpose:** Find the highest-momentum `opus45` setups (steep uptrends, high RS, near highs). This agent is your “go when the tape is strong” specialist.

## Identity (constants)

| Field | Value |
|---|---|
| Name | `Momentum Scout` |
| `agentType` | `momentum_scout` |
| `signalFamily` | `opus45` |
| Implementation | `server/agents/momentumScout.js` |
| Shared base | `server/agents/strategyAgentBase.js` |
| Doctrine source | `server/agents/northstar.js` (mirrors `docs/northstar.md`) |

## What it optimizes for

- **Primary edge**: steep trend + RS strength tends to produce the best avg return in bull regimes.
- **Mechanism**: it filters the shared signal pool down to “true momentum” candidates, then participates in the shared Walk-Forward + Bayesian A/B learning loop (implemented in `strategyAgentBase.js`).

## Hard filters (actually enforced)

Configured in `mandatoryOverrides` in `server/agents/momentumScout.js`, enforced by `strategyAgentBase.filterSignals()`:

- **RS minimum**: \(RS \ge 85\) (from `CANSLIM.minRsRating`)
- **10MA slope (14d)**: \(ma10Slope14d \ge 7\)
- **Distance from 52w high**: \(pctFromHigh \le 15\%\) (from `CANSLIM.maxDistFromHighPct`)

## Training filter (agent specialization)

Only trains on signals where:

- `context.ma10Slope14d >= 7`
- `context.relativeStrength >= 85`

This is intentionally redundant with the hard filters: it keeps the learning pool “pure momentum” rather than letting borderline names dilute the hypothesis tests.

## Default weight biases (starting point)

These are the “starting weights” layered on top of `DEFAULT_WEIGHTS` before the learning loop explores variants:

- `slope10MAElite`: 30
- `slope10MAStrong`: 25
- `entryRSAbove90`: 15
- `pullbackIdeal`: 12

## Minimum data requirement

- **Minimum filtered signals to run**: 10 (default `minSignals` from `strategyAgentBase.js`)

If fewer survive filtering, the agent will skip optimization for that run.

## Market regime budget (source of truth)

Budget allocation is set centrally by Market Pulse (`server/agents/marketPulse.js`), not by comments in the agent file.

| Regime | Budget for `momentum_scout` |
|---|---:|
| `BULL` | 0.45 |
| `UNCERTAIN` | 0.25 |
| `CORRECTION` | 0.10 |
| `BEAR` | 0.00 |

## Where you’ll see it in the product

- **Agents dashboard**: shows this agent under “Signal agents” with avg return / win rate / etc (derived from learning run history).
- **Marcus mission briefing**: includes this agent’s control vs variant avg returns as part of “Signal Agent Avg Returns”.

## Practical interpretation

- If Momentum Scout’s out-of-sample delta is consistently positive (and Bayes Factor is strong), the system is learning “what matters now” in momentum markets.
- If it’s underperforming, treat that as a regime smell test: the market may be choppy, leadership may be rotating, or breakouts may be failing—look at Base Hunter / Turtle Trader for higher-quality survivors.

