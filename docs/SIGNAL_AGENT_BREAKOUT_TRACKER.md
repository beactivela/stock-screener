# Signal Agent — Breakout Tracker

**Purpose:** Catch pivot-proximity names that are tightening and either (a) actively breaking out or (b) coiling pre-breakout. This agent is your “timing + volume confirmation” specialist.

## Identity (constants)

| Field | Value |
|---|---|
| Name | `Breakout Tracker` |
| `agentType` | `breakout_tracker` |
| `signalFamily` | `opus45` |
| Implementation | `server/agents/breakoutTracker.js` |
| Shared base | `server/agents/strategyAgentBase.js` |
| Doctrine source | `server/agents/northstar.js` (mirrors `docs/northstar.md`) |

## What it optimizes for

- **Primary edge**: stocks near highs that tighten and then confirm with volume often produce the sharpest moves when the market is supportive.
- **Design intent**: allow slightly “pre-breakout” setups (up to 10% from highs) so the agent has enough signal density to learn during corrections.

## Hard filters (actually enforced)

`strategyAgentBase.filterSignals()` applies `mandatoryOverrides` from `server/agents/breakoutTracker.js`:

- **Distance from 52w high**: \(pctFromHigh \le 10\%\)
- **RS minimum**: \(RS \ge 80\)

**Training pool filter** (stricter, aligned with `docs/research` Top-100 breakout study) is implemented in `server/breakoutTrackerCriteria.js` and used by:

- `trainingFilter` in `server/agents/breakoutTracker.js` (learning / optimization)
- `matchesBreakoutTracker` in `server/learning/signalSetupClassifier.js` (Dashboard / “Breakout” tag)

That filter requires:

- **Pre-move price floor**: lowest close in the prior **20** sessions **≥ $10** (`minClose20d`), or if missing, **last close ≥ $10**
- **Proximity**: \(pctFromHigh \le 10\%\)
- **RS**: **≥ 80**
- **Volume** (study-aligned): **≥ 1.5×** prior **50**-day average volume on the last bar when `breakoutVolumeRatio50` is present (`server/vcp.js`); if not (short history), fall back to legacy **≥ 1.2×** last bar vs **20**-day avg volume (`breakoutVolumeRatio`)
- **Trend**: price **above SMA20, SMA50, and SMA100** when those booleans are present (null = do not block older scans)

`mandatoryOverrides.minBreakoutVolumeRatio` remains a **documentation / Northstar** reference; numeric volume enforcement is in `evaluateBreakoutTrackerStudy()`.

## Default weight biases (starting point)

Biases toward entry quality + proximity to highs:

- `pctFromHighIdeal`: 10
- `pctFromHighGood`: 5
- `entryVolumeConfirm`: 10
- `entryAt10MA`: 15

## Minimum data requirement

- **Minimum filtered signals to run**: 5 (set via `minSignals: 5` in `server/agents/breakoutTracker.js`)

This agent is allowed to run on smaller pools than the other `opus45` agents.

## Market regime budget (source of truth)

Budget allocation is set centrally by Market Pulse (`server/agents/marketPulse.js`).

| Regime | Budget for `breakout_tracker` |
|---|---:|
| `BULL` | 0.25 |
| `UNCERTAIN` | 0.20 |
| `CORRECTION` | 0.15 |
| `BEAR` | 0.00 |

## Where you’ll see it in the product

- **Agents dashboard**: appears under “Signal agents” with its recent learning performance.
- **Marcus mission briefing**: includes Breakout Tracker’s A/B test deltas so you can compare it to Momentum Scout.

## Practical interpretation

- If Breakout Tracker is strong while Momentum Scout is weaker, you’re often in a “selective breakout” market where only the tightest, best-timed entries work.
- If it’s weak too, the market may be hostile to breakouts (failed breakouts / distribution) — Base Hunter and Turtle Trader become more trustworthy.

