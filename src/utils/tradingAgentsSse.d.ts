export function appendSseDataLines(
  buffer: string,
  decodedChunk: string,
): { nextBuffer: string; events: unknown[] }

export function flushSseDataLines(buffer: string): unknown[]
