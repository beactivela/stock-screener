/**
 * Agent conversation thread tests
 */
import { describe, it } from 'node:test'
import assert from 'node:assert'
import { buildAgentThread } from './agentConversationThread.js'

describe('buildAgentThread', () => {
  it('maps rounds into ordered thread messages', () => {
    const transcript = {
      rounds: [
        {
          name: 'round1',
          outputs: [
            {
              id: 'card_1',
              agentType: 'momentum_scout',
              confidence: 78,
              failureModes: ['Low volume'],
              notes: 'Focus on momentum',
            },
          ],
        },
        {
          name: 'round2',
          outputs: [
            {
              id: 'ch_1',
              fromAgent: 'base_hunter',
              toAgent: 'momentum_scout',
              assumption: 'Breakout holds',
              risk: 'Chop',
              testableRule: 'If close below 10MA, exit',
              confidenceImpact: -10,
            },
          ],
        },
        {
          name: 'round3',
          output: {
            id: 'dec_1',
            action: 'WATCH',
            rationale: 'Need more evidence',
            killCriteria: ['Regime flips'],
          },
        },
      ],
    }

    const thread = buildAgentThread(transcript)
    assert.equal(thread.length, 3)
    assert.equal(thread[0].agentType, 'momentum_scout')
    assert.equal(thread[1].agentType, 'base_hunter')
    assert.equal(thread[2].agentType, 'marcus_ceo')
    assert.equal(thread[1].replyToId, thread[0].id)
  })
})
