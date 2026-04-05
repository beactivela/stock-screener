/**
 * Optional: resolve FMP first/last name to bioguide via Congress.gov API v3.
 * Set CONGRESS_GOV_API_KEY in env. Cached per process for the duration of one sync run.
 */

import { fmpNameKeyFromParts } from './fmpNameKey.js'

const BASE = 'https://api.congress.gov/v3'

/**
 * @param {string} firstName
 * @param {string} lastName
 * @param {Map<string, string>} [cache] fmp_name_key -> bioguide_id
 * @returns {Promise<string | null>} bioguide or null
 */
export async function resolveBioguideViaCongressGov(firstName, lastName, cache = new Map()) {
  const key = fmpNameKeyFromParts(firstName, lastName)
  if (!key) return null
  if (cache.has(key)) return cache.get(key) ?? null

  const apiKey = process.env.CONGRESS_GOV_API_KEY?.trim()
  if (!apiKey) {
    cache.set(key, null)
    return null
  }

  const fn = String(firstName ?? '')
    .trim()
    .toLowerCase()
  const ln = String(lastName ?? '')
    .trim()
    .toLowerCase()
  if (!fn || !ln) {
    cache.set(key, null)
    return null
  }

  try {
    for (let offset = 0; offset < 750; offset += 250) {
      const url = `${BASE}/member?api_key=${encodeURIComponent(apiKey)}&format=json&limit=250&offset=${offset}`
      const res = await fetch(url, { signal: AbortSignal.timeout(45_000) })
      if (!res.ok) break
      const body = await res.json()
      const members = body?.members ?? body?.member ?? []
      const list = Array.isArray(members) ? members : Array.isArray(members?.member) ? members.member : []
      if (!list.length) break
      for (const wrap of list) {
        const m = wrap?.member ?? wrap
        if (!m || typeof m !== 'object') continue
        if (m.currentMember === false) continue
        const bi = m.bioguideId ?? m.bioguide_id
        const f = String(m.firstName ?? m.first_name ?? '')
          .trim()
          .toLowerCase()
        const l = String(m.lastName ?? m.last_name ?? '')
          .trim()
          .toLowerCase()
        if (f === fn && l === ln && bi && typeof bi === 'string') {
          cache.set(key, bi)
          return bi
        }
      }
    }
  } catch {
    // ignore
  }
  cache.set(key, null)
  return null
}
