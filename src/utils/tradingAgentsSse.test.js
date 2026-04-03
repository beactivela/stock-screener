import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { appendSseDataLines, flushSseDataLines } from './tradingAgentsSse.js'

describe('tradingAgentsSse', () => {
  it('parses a single complete data line', () => {
    const { nextBuffer, events } = appendSseDataLines('', 'data: {"type":"start","x":1}\n\n')
    assert.equal(nextBuffer, '')
    assert.equal(events.length, 1)
    assert.deepEqual(events[0], { type: 'start', x: 1 })
  })

  it('handles CRLF line endings', () => {
    const { events } = appendSseDataLines('', 'data: {"a":1}\r\n\r\n')
    assert.equal(events.length, 1)
    assert.deepEqual(events[0], { a: 1 })
  })

  it('buffers an incomplete line across chunks', () => {
    let buf = ''
    let r = appendSseDataLines(buf, 'data: {"typ')
    assert.equal(r.events.length, 0)
    assert.ok(r.nextBuffer.includes('data:'))
    r = appendSseDataLines(r.nextBuffer, 'e":"x"}\n\n')
    assert.equal(r.events.length, 1)
    assert.deepEqual(r.events[0], { type: 'x' })
  })

  it('flushSseDataLines parses trailing data without newline', () => {
    const ev = flushSseDataLines('data: {"done":true}')
    assert.equal(ev.length, 1)
    assert.deepEqual(ev[0], { done: true })
  })
})
