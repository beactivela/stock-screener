# Signal Agent — Base Hunter

**Purpose:** Find deep, well-formed VCP bases with clear “tightness + volume dry-up” characteristics. This agent is your “patient quality” specialist when momentum is unreliable.

## Identity (constants)

| Field | Value |
|---|---|
| Name | `Base Hunter` |
| `agentType` | `base_hunter` |
| `signalFamily` | `opus45` |
| Implementation | `server/agents/baseHunter.js` |
| Shared base | `server/agents/strategyAgentBase.js` |
| Doctrine source | `server/agents/northstar.js` (mirrors `docs/northstar.md`) |

## What it optimizes for

- **Primary edge**: high-quality consolidations (more contractions, tighter price action, drying volume) tend to survive and produce strong moves once the market stabilizes.
- **Mechanism**: aggressively filters for “deep base quality,” then uses the shared Walk-Forward + Bayesian A/B learning loop.

## Hard filters (actually enforced)

Configured in `mandatoryOverrides` in `server/agents/baseHunter.js`, enforced by `strategyAgentBase.filterSignals()`:

- **VCP contraction count**: \(contractions \ge 4\) (uses `VCP.maxContractions`)
- **Pattern confidence**: \(patternConfidence \ge 60\)

Notes:
- This agent intentionally does **not** hard-require RS here (it can still be present in the scoring model), because deep bases can form while RS is “setting up,” especially during corrections.

## Training filter (agent specialization)

Only trains on signals where:

- `context.contractions >= 4` (falls back to `signal.contractions`)
- `context.volumeDryUp === true`

This keeps the learning set focused on “real VCP” instead of general pullbacks.

## Default weight biases (starting point)

These are layered on top of `DEFAULT_WEIGHTS` before exploration strategies are applied:

- Boost base quality
  - `vcpContractions3Plus`: 12
  - `vcpContractions4Plus`: 8
  - `vcpVolumeDryUp`: 8
  - `vcpPatternConfidence`: 8
- Reduce slope dependency
  - `slope10MAElite`: 15
  - `slope10MAStrong`: 12

## Minimum data requirement

- **Minimum filtered signals to run**: 10 (default `minSignals` from `strategyAgentBase.js`)

## Market regime budget (source of truth)

Budget allocation is set centrally by Market Pulse (`server/agents/marketPulse.js`).

| Regime | Budget for `base_hunter` |
|---|---:|
| `BULL` | 0.10 |
| `UNCERTAIN` | 0.35 |
| `CORRECTION` | 0.55 |
| `BEAR` | 0.00 |

## Where you’ll see it in the product

- **Agents dashboard**: appears under “Signal agents” with its latest learning metrics.
- **Marcus mission briefing**: shows Base Hunter’s control vs variant avg returns so you can compare it vs Momentum Scout in the current regime.

## Practical interpretation

- If Base Hunter is outperforming Momentum Scout, you’re usually in “quality matters” markets (chop, rotation, or correction), where breakouts need tighter bases and better risk/reward.
- If it underperforms while Momentum Scout is strong, it may be filtering too hard (pool too small) or the market is rewarding speed over structure.

