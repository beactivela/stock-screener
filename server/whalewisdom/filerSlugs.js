/**
 * Default WhaleWisdom filer permalinks (path after /filer/) to sync.
 * Override with env WHALEWISDOM_FILER_SLUGS=comma,separated,slugs
 */

/** @type {Array<{ slug: string, managerName?: string }>} */
export const DEFAULT_WHALEWISDOM_FILERS = [
  { slug: 'situational-awareness-lp', managerName: 'Leopold Aschenbrenner' },
];

/**
 * @returns {Array<{ slug: string, managerName?: string }>}
 */
export function getWhalewisdomFilersFromEnv() {
  const raw = process.env.WHALEWISDOM_FILER_SLUGS?.trim();
  if (!raw) return DEFAULT_WHALEWISDOM_FILERS;
  const slugs = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return slugs.map((slug) => ({ slug }));
}
