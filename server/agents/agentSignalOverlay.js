/**
 * Agent Signal Overlay Helpers
 *
 * Builds per-agent buy markers for chart overlays.
 * Uses the same agent filter rules as the learning pipeline, so the
 * overlays reflect each agent's true specialization.
 */
import momentumScout from './momentumScout.js'
import baseHunter from './baseHunter.js'
import breakoutTracker from './breakoutTracker.js'
import turtleTrader from './turtleTrader.js'
import maCrossover_10_20 from './maCrossover_10_20.js'

export const AGENT_CHART_CONFIG = {
  momentum_scout: { name: 'Momentum Scout', color: '#22c55e' },
  base_hunter: { name: 'Base Hunter', color: '#3b82f6' },
  breakout_tracker: { name: 'Breakout Tracker', color: '#f59e0b' },
  turtle_trader: { name: 'Turtle Trader', color: '#a855f7' },
  ma_crossover_10_20: { name: '10-20 Cross Over', color: '#14b8a6' },
}

const AGENTS = [momentumScout, baseHunter, breakoutTracker, turtleTrader, maCrossover_10_20]
const AGENT_BY_TYPE = new Map(AGENTS.map((agent) => [agent.agentType, agent]))

function resolveSignalTimeSec(signal, bars) {
  const bar = typeof signal.entryBarIdx === 'number' ? bars?.[signal.entryBarIdx] : null
  if (bar?.t) return Math.floor(bar.t / 1000)

  if (typeof signal.entryTimeSec === 'number') return signal.entryTimeSec
  if (typeof signal.entryTimeMs === 'number') return Math.floor(signal.entryTimeMs / 1000)

  if (signal.entryDate) {
    const dateStr = String(signal.entryDate)
    const iso = dateStr.includes('T') ? dateStr : `${dateStr}T00:00:00Z`
    const ms = Date.parse(iso)
    if (!Number.isNaN(ms)) return Math.floor(ms / 1000)
  }

  return null
}

export function resolveAgent(agentType) {
  const agent = AGENT_BY_TYPE.get(agentType)
  if (!agent) throw new Error(`Unknown agentType: ${agentType}`)
  return agent
}

export function buildAgentBuyMarkers({ agentType, signals, bars }) {
  const agent = resolveAgent(agentType)
  const config = AGENT_CHART_CONFIG[agentType]
  const filtered = agent.filterSignals(signals || [])

  return filtered
    .map((signal) => {
      const time = resolveSignalTimeSec(signal, bars)
      if (!time) return null
      return {
        time,
        label: config.name,
        color: config.color,
        agentType,
        price: signal.entryPrice ?? null,
      }
    })
    .filter(Boolean)
}

export function buildAgentSignalOverlay({ signals, bars, agentTypes = null }) {
  const types = Array.isArray(agentTypes) && agentTypes.length > 0
    ? agentTypes
    : Object.keys(AGENT_CHART_CONFIG)

  const overlays = {}
  for (const agentType of types) {
    const cfg = AGENT_CHART_CONFIG[agentType]
    if (!cfg) continue
    overlays[agentType] = {
      agentType,
      name: cfg.name,
      color: cfg.color,
      buySignals: buildAgentBuyMarkers({ agentType, signals, bars }),
    }
  }
  return overlays
}
