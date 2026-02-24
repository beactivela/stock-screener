export const AGENT_CHART_CONFIG = {
  momentum_scout: {
    name: 'Momentum Scout',
    color: '#22c55e',
    accentClass: 'accent-emerald-500',
    legendClass: 'text-emerald-400',
  },
  base_hunter: {
    name: 'Base Hunter',
    color: '#3b82f6',
    accentClass: 'accent-blue-500',
    legendClass: 'text-blue-400',
  },
  breakout_tracker: {
    name: 'Breakout Tracker',
    color: '#f59e0b',
    accentClass: 'accent-amber-500',
    legendClass: 'text-amber-400',
  },
  turtle_trader: {
    name: 'Turtle Trader',
    color: '#a855f7',
    accentClass: 'accent-purple-500',
    legendClass: 'text-purple-400',
  },
  ma_crossover_10_20: {
    name: '10-20 Cross Over',
    color: '#14b8a6',
    accentClass: 'accent-teal-500',
    legendClass: 'text-teal-400',
  },
} as const

export type AgentType = keyof typeof AGENT_CHART_CONFIG

export const AGENT_CHART_ORDER: AgentType[] = [
  'momentum_scout',
  'base_hunter',
  'breakout_tracker',
  'turtle_trader',
  'ma_crossover_10_20',
]

export const AGENT_CHART_LIST = AGENT_CHART_ORDER.map((agentType) => ({
  agentType,
  label: AGENT_CHART_CONFIG[agentType].name,
  color: AGENT_CHART_CONFIG[agentType].color,
  accentClass: AGENT_CHART_CONFIG[agentType].accentClass,
  legendClass: AGENT_CHART_CONFIG[agentType].legendClass,
}))

export interface AgentBuySignal {
  time: number
  label: string
  color: string
  agentType: AgentType
  price?: number | null
}

export interface AgentSignalOverlay {
  agentType: AgentType
  name: string
  color: string
  buySignals: AgentBuySignal[]
}

export interface AgentSignalHistoryResponse {
  ticker: string
  agents: Record<string, AgentSignalOverlay>
  scannedAt?: string
  reason?: string
}

export interface ChartMarker {
  time: number
  position: 'belowBar' | 'aboveBar'
  shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square'
  color: string
  text?: string
  size?: number
}

export function toAgentChartMarkers(
  agents: AgentSignalHistoryResponse['agents'] | null,
  visibility: Record<AgentType, boolean>
): ChartMarker[] {
  if (!agents) return []

  const markers: ChartMarker[] = []

  for (const agentType of AGENT_CHART_ORDER) {
    if (!visibility[agentType]) continue
    const overlay = agents[agentType]
    if (!overlay || !Array.isArray(overlay.buySignals)) continue

    for (const buy of overlay.buySignals) {
      markers.push({
        time: buy.time,
        position: 'belowBar',
        shape: 'circle',
        color: overlay.color,
        text: overlay.name,
        size: 1.1,
      })
    }
  }

  return markers
}
