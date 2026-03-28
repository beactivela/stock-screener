import test from 'node:test'
import assert from 'node:assert/strict'

import { consumeJsonlChunk } from './jsonl.js'

test('consumeJsonlChunk parses multiple lines', () => {
  const { events, nextBuffer } = consumeJsonlChunk(
    '{"a":1}\n{"b":2}\n',
    '',
  )
  assert.deepEqual(events, [{ a: 1 }, { b: 2 }])
  assert.equal(nextBuffer, '')
})

test('consumeJsonlChunk buffers partial line until newline', () => {
  const first = consumeJsonlChunk('{"a":1}\n{"b"', '')
  assert.deepEqual(first.events, [{ a: 1 }])
  assert.equal(first.nextBuffer, '{"b"')

  // Decoder only completes a line once a newline arrives (matches streaming stdout).
  const second = consumeJsonlChunk(':2}\n', first.nextBuffer)
  assert.deepEqual(second.events, [{ b: 2 }])
  assert.equal(second.nextBuffer, '')
})

test('consumeJsonlChunk yields error object for bad JSON', () => {
  const { events } = consumeJsonlChunk('not-json\n', '')
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'error')
  assert.ok(String(events[0].message).includes('Malformed'))
})
