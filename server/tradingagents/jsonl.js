/**
 * Incremental JSONL decoder: splits on newlines, parses complete lines as JSON.
 * @param {string} chunk
 * @param {string} buffer leftover from previous chunk
 * @returns {{ events: unknown[], nextBuffer: string }}
 */
export function consumeJsonlChunk(chunk, buffer = '') {
  const combined = buffer + chunk
  const lines = combined.split('\n')
  const nextBuffer = lines.pop() ?? ''
  const events = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      events.push(JSON.parse(trimmed))
    } catch {
      events.push({
        type: 'error',
        message: 'Malformed JSON line from runner',
        rawLine: trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed,
      })
    }
  }

  return { events, nextBuffer }
}
