const AGENT_META = {
  marcus_ceo: { name: 'Marcus', avatar: '👑' },
  momentum_scout: { name: 'Momentum Scout', avatar: '⚡' },
  base_hunter: { name: 'Base Hunter', avatar: '🔍' },
  breakout_tracker: { name: 'Breakout Tracker', avatar: '🚀' },
  turtle_trader: { name: 'Turtle Trader', avatar: '🐢' },
}

function getAgentMeta(agentType) {
  return AGENT_META[agentType] || { name: agentType || 'Agent', avatar: '🤖' }
}

function formatTradeCard(card) {
  return [
    `Confidence: ${card.confidence ?? '—'}`,
    card.notes ? `Notes: ${card.notes}` : null,
    Array.isArray(card.failureModes) && card.failureModes.length
      ? `Failure modes: ${card.failureModes.join(' · ')}`
      : null,
  ].filter(Boolean).join('\n')
}

function formatChallenge(challenge) {
  return [
    `Assumption: ${challenge.assumption || '—'}`,
    `Risk: ${challenge.risk || '—'}`,
    `Testable rule: ${challenge.testableRule || '—'}`,
    `Confidence impact: ${challenge.confidenceImpact ?? '—'}`,
  ].join('\n')
}

function formatDecision(decision) {
  return [
    `Decision: ${decision.action || '—'}`,
    decision.rationale ? `Rationale: ${decision.rationale}` : null,
    Array.isArray(decision.killCriteria) && decision.killCriteria.length
      ? `Kill criteria: ${decision.killCriteria.join(' · ')}`
      : null,
  ].filter(Boolean).join('\n')
}

export function buildAgentThread(transcript) {
  if (!transcript || !Array.isArray(transcript.rounds)) return []
  const messages = []
  const cardByAgent = new Map()

  for (const round of transcript.rounds) {
    if (round?.name === 'round1' && Array.isArray(round.outputs)) {
      for (const card of round.outputs) {
        const meta = getAgentMeta(card.agentType)
        const msg = {
          id: card.id || `card_${messages.length}`,
          agentType: card.agentType,
          agentName: meta.name,
          avatar: meta.avatar,
          title: 'Signal critique',
          body: formatTradeCard(card),
          depth: 0,
          replyToId: null,
        }
        messages.push(msg)
        cardByAgent.set(card.agentType, msg.id)
      }
    }

    if (round?.name === 'round2' && Array.isArray(round.outputs)) {
      for (const challenge of round.outputs) {
        const meta = getAgentMeta(challenge.fromAgent)
        const replyToId = cardByAgent.get(challenge.toAgent) || null
        messages.push({
          id: challenge.id || `challenge_${messages.length}`,
          agentType: challenge.fromAgent,
          agentName: meta.name,
          avatar: meta.avatar,
          title: `Challenge → ${getAgentMeta(challenge.toAgent).name}`,
          body: formatChallenge(challenge),
          depth: replyToId ? 1 : 0,
          replyToId,
        })
      }
    }

    if (round?.name === 'round3' && round.output) {
      const meta = getAgentMeta('marcus_ceo')
      messages.push({
        id: round.output.id || `decision_${messages.length}`,
        agentType: 'marcus_ceo',
        agentName: meta.name,
        avatar: meta.avatar,
        title: 'Moderator decision',
        body: formatDecision(round.output),
        depth: 0,
        replyToId: null,
      })
    }
  }

  return messages
}
