/**
 * Incrementally parse Server-Sent Events text into JSON payloads (lines starting with "data:").
 * Handles CRLF and keeps an incomplete trailing line in the buffer until the next chunk.
 * @param {string} buffer - Carry-over from previous chunks (incomplete line).
 * @param {string} decodedChunk - New UTF-8 text from the stream.
 * @returns {{ nextBuffer: string, events: unknown[] }}
 */
export function appendSseDataLines(buffer, decodedChunk) {
  const combined = buffer + decodedChunk
  const normalized = combined.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')
  const nextBuffer = lines.pop() ?? ''
  const events = []
  for (const line of lines) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (!payload) continue
    try {
      events.push(JSON.parse(payload))
    } catch {
      /* ignore malformed line */
    }
  }
  return { nextBuffer, events }
}

/**
 * Flush a trailing buffer that may not end with a newline (last SSE event in stream).
 * @param {string} buffer
 * @returns {unknown[]}
 */
export function flushSseDataLines(buffer) {
  if (!buffer || !buffer.trim()) return []
  const { events } = appendSseDataLines(buffer, '\n')
  return events
}
