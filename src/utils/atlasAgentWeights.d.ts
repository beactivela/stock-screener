export interface AgentRange {
  maxAgents: number
  minAgents: number
}

export function computeAgentRange(weightCount: number): AgentRange
export function clampTopN(topN: number, agentRange: AgentRange): number
export function topWeightedAgentEntries(
  weights: Record<string, number> | undefined,
  topN: number,
  agentRange: AgentRange,
): [string, number][]
export function topNSelectOptions(agentRange: AgentRange): number[]
