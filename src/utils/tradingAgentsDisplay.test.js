import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  firstDisplaySentence,
  parseTradingAgentsDecision,
  ratingVisualToken,
  streamEventToRow,
  streamEventToThinkingLine,
} from './tradingAgentsDisplay.js'

describe('tradingAgentsDisplay', () => {
  it('streamEventToRow formats start', () => {
    const row = streamEventToRow({
      type: 'start',
      ticker: 'NVDA',
      asOf: '2026-04-02',
      provider: 'openai',
      runId: 'abc-123',
      at: '2026-04-02T12:00:00.000Z',
    })
    assert.equal(row.tone, 'info')
    assert.equal(row.headline, 'Run started')
    assert.ok(row.body.includes('NVDA'))
    assert.ok(row.sub?.includes('abc-123'))
  })

  it('streamEventToRow formats progress', () => {
    const row = streamEventToRow({
      type: 'progress',
      phase: 'boot',
      message: 'Loading graph',
      at: '2026-04-02T12:01:00.000Z',
    })
    assert.equal(row.tone, 'info')
    assert.equal(row.headline, 'Boot')
    assert.equal(row.body, 'Loading graph')
  })

  it('streamEventToRow treats heartbeat distinctly', () => {
    const row = streamEventToRow({
      type: 'progress',
      phase: 'heartbeat',
      message: 'still running',
    })
    assert.equal(row.tone, 'heartbeat')
    assert.equal(row.headline, 'Heartbeat')
  })

  it('parseTradingAgentsDecision extracts sections', () => {
    const parsed = parseTradingAgentsDecision({
      rating: 'BUY',
      state: {
        company_of_interest: 'NVDA',
        trade_date: '2026-04-02',
        market_report: '## Hello\n\nBody.',
        sentiment_report: '',
      },
    })
    assert.equal(parsed.rating, 'BUY')
    assert.equal(parsed.company, 'NVDA')
    assert.equal(parsed.tradeDate, '2026-04-02')
    assert.equal(parsed.sections.length, 1)
    assert.equal(parsed.sections[0].label, 'Market')
    assert.ok(parsed.sections[0].text.includes('Hello'))
  })

  it('ratingVisualToken maps common words', () => {
    assert.equal(ratingVisualToken('BUY'), 'buy')
    assert.equal(ratingVisualToken('SELL'), 'sell')
    assert.equal(ratingVisualToken('HOLD'), 'hold')
    assert.equal(ratingVisualToken('Maybe'), 'neutral')
  })

  it('firstDisplaySentence takes first sentence or caps long text', () => {
    assert.equal(
      firstDisplaySentence('Agent running. Second part.'),
      'Agent running.',
    )
    assert.ok(firstDisplaySentence('x'.repeat(250)).endsWith('…'))
  })

  it('streamEventToThinkingLine is one line per event type', () => {
    assert.equal(streamEventToThinkingLine({ type: 'start', ticker: 'NVDA' }), 'Starting analysis for NVDA.')
    assert.equal(
      streamEventToThinkingLine({
        type: 'progress',
        phase: 'heartbeat',
        message: 'Still working. Ignore this sentence.',
      }),
      'Still working.',
    )
    assert.ok(streamEventToThinkingLine({ type: 'result' }).includes('ready'))
    assert.ok(streamEventToThinkingLine({ type: 'error', message: 'Boom.\nTrace' }).includes('Boom'))
  })
})
