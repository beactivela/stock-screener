/**
 * Conversation tab helpers tests
 */
import { describe, it } from 'node:test'
import assert from 'node:assert'
import { normalizeTab, getTabLabel } from './conversationTabs.js'

describe('conversationTabs', () => {
  it('normalizes unknown tabs to coach', () => {
    assert.equal(normalizeTab('unknown'), 'coach')
  })

  it('keeps agents tab intact', () => {
    assert.equal(normalizeTab('agents'), 'agents')
  })

  it('returns user-facing labels', () => {
    assert.equal(getTabLabel('coach'), 'Minervini Coach')
    assert.equal(getTabLabel('agents'), 'Agent Conversations')
  })
})
