/**
 * Pure helpers for ATLAS agent weight sorting / Top-N (shared with Atlas page).
 */

export function computeAgentRange(weightCount) {
  const maxAgents = Math.min(25, weightCount)
  const minAgents = Math.min(3, maxAgents)
  return { maxAgents, minAgents }
}

export function clampTopN(topN, agentRange) {
  const { maxAgents, minAgents } = agentRange
  return Math.min(Math.max(minAgents, topN), maxAgents)
}

export function topWeightedAgentEntries(weights, topN, agentRange) {
  const n = clampTopN(topN, agentRange)
  return Object.entries(weights || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
}

export function topNSelectOptions(agentRange) {
  const { maxAgents, minAgents } = agentRange
  const opts = []
  for (let i = minAgents; i <= maxAgents; i++) opts.push(i)
  return opts
}
