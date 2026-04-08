/**
 * Minimal SSE parser for POST /api/ai-portfolio/simulate/daily-stream (fetch + readable stream).
 */
export type SseHandler = (eventName: string, data: unknown) => void

export async function consumeSseFromResponse(response: Response, onEvent: SseHandler): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body for SSE')
  const decoder = new TextDecoder()
  let buffer = ''
  let currentEvent = 'message'

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let sep: number
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      const lines = block.split('\n')
      for (const line of lines) {
        if (line.startsWith('event:')) {
          currentEvent = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          const raw = line.slice(5).trim()
          try {
            const data = JSON.parse(raw) as unknown
            onEvent(currentEvent, data)
          } catch {
            onEvent(currentEvent, raw)
          }
        }
      }
    }
  }
}
