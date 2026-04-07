/**
 * Expert / “smart money” entities we track outside StockCircle — e.g. WhaleWisdom 13F filer pages.
 * StockCircle sync does not scrape these; this list is for quick reference and deep links.
 * Hedgefollow CSV → WhaleWisdom slugs: npm run hedgefollow:map -- /path/to/export.csv
 *
 * @type {Array<{
 *   id: string,
 *   fundName: string,
 *   managerName: string,
 *   whalewisdomUrl: string,
 *   notes?: string
 * }>}
 */
export const EXPERT_INVESTORS_WATCHLIST = [
  {
    id: 'situational-awareness-lp',
    fundName: 'Situational Awareness LP',
    managerName: 'Leopold Aschenbrenner',
    whalewisdomUrl: 'https://whalewisdom.com/filer/situational-awareness-lp',
    notes: '13F holdings via WhaleWisdom filer page',
  },
]
