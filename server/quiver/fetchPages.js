/**
 * HTTP fetch for Quiver Quant public pages (HTML with embedded trade/graph data).
 */
export const QUIVER_BASE = 'https://www.quiverquant.com'
export const USER_AGENT = 'stock-screener/1.0 (quiver-congress-sync; +https://github.com)'

/**
 * @param {string} url
 * @param {{ timeoutMs?: number, signal?: AbortSignal }} [opts]
 */
export async function fetchText(url, { timeoutMs = 60000, signal } = {}) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'X-Requested-With': 'XMLHttpRequest',
    },
    signal: signal ?? AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return res.text()
}

/**
 * @param {string} bioguideId e.g. P000197
 * @param {string} displayName e.g. "Nancy Pelosi" — used in Quiver path
 */
export function politicianPageUrl(displayName, bioguideId) {
  const slug = `${displayName}-${bioguideId}`.trim()
  return `${QUIVER_BASE}/congresstrading/politician/${encodeURIComponent(slug)}`
}

/**
 * Strategy page embeds cumulative return series (graphDataStrategy).
 * @param {string} strategyDisplayName e.g. "Nancy Pelosi"
 */
export function strategyPageUrl(strategyDisplayName) {
  return `${QUIVER_BASE}/strategies/s/${encodeURIComponent(strategyDisplayName)}/`
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * @param {string} url
 * @param {{ retries?: number, timeoutMs?: number }} [opts]
 */
export async function fetchTextWithRetry(url, { retries = 3, timeoutMs = 60000 } = {}) {
  let lastErr
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fetchText(url, { timeoutMs })
    } catch (e) {
      lastErr = e
      const backoff = Math.min(30_000, 800 * 2 ** attempt)
      await sleep(backoff)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}
