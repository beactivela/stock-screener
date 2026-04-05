/**
 * Extract a JSON array assignment after a needle (e.g. `let tradeData = `).
 * Uses bracket depth counting — safe for large embedded arrays.
 */
export function extractJsonArrayAfter(html, needle) {
  const i = html.indexOf(needle)
  if (i === -1) return null
  let j = i + needle.length
  while (j < html.length && /\s/.test(html[j])) j++
  if (html[j] !== '[') return null
  let depth = 0
  const start = j
  for (let k = j; k < html.length; k++) {
    const c = html[k]
    if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) {
        const slice = html.slice(start, k + 1)
        try {
          return JSON.parse(slice)
        } catch {
          return null
        }
      }
    }
  }
  return null
}
