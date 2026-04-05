/**
 * Derive allowlists from the slim consensus digest so the LLM cannot "fill in"
 * plausible tickers (AMR, HCC, …) that are not in the table JSON.
 */

/** Uppercase tokens that look like tickers but are common English / infra — not validated as symbols. */
const EXCLUDED_UPPER_WORD = new Set([
  'AND',
  'ARE',
  'BAD',
  'BIG',
  'BUT',
  'CAN',
  'DATA',
  'DAY',
  'DID',
  'END',
  'ETF',
  'FEW',
  'FOR',
  'GET',
  'GOT',
  'HAD',
  'HAS',
  'HER',
  'HIM',
  'HIS',
  'HOW',
  'ITS',
  'LET',
  'LOW',
  'MAY',
  'NEW',
  'NOT',
  'NOW',
  'OFF',
  'OLD',
  'ONE',
  'OUR',
  'OUT',
  'OWN',
  'PER',
  'PUT',
  'RUN',
  'SAW',
  'SAY',
  'SHE',
  'THE',
  'TOO',
  'TOP',
  'TRY',
  'TWO',
  'USE',
  'VIA',
  'WAS',
  'WAY',
  'WHO',
  'WHY',
  'YES',
  'YET',
  'YOU',
  'ADR',
  'API',
  'ATH',
  'CEO',
  'CFO',
  'CIO',
  'COO',
  'CTO',
  'CSS',
  'EOD',
  'EPS',
  'ESG',
  'EUR',
  'FBI',
  'GAAP',
  'GBP',
  'GDP',
  'HTML',
  'HTTP',
  'HTTPS',
  'INTL',
  'IRA',
  'IRS',
  'IPO',
  'JSON',
  'LLM',
  'NASDAQ',
  'NYSE',
  'OTC',
  'PDF',
  'QOQ',
  'ROI',
  'SEC',
  'SQL',
  'USA',
  'USD',
  'XML',
  'YOY',
  'MUST',
  'THIS',
  'THAT',
  'WHAT',
  'WHEN',
  'WITH',
  'FROM',
  'EACH',
  'MANY',
  'INTO',
  'ONLY',
  'EVEN',
  'MOST',
  'SOME',
  'MUCH',
  'LIKE',
  'JUST',
  'OVER',
  'ALSO',
  'BACK',
  'WELL',
  'WILL',
  'HAVE',
  'BEEN',
  'THEY',
  'THEM',
  'THEN',
  'THAN',
  'SUCH',
]);

/** Parenthetical (FOO) that is not a stock ticker in our context (venues, labels). */
const EXCLUDED_PARENTHETICAL = new Set([
  'ADR',
  'ETF',
  'NYSE',
  'NASDAQ',
  'OTC',
  'SEC',
  'USD',
]);

/**
 * Symbols that appear as stock tickers in prose but are not in the allowlist (hallucinations).
 * Uses (TICK) parentheticals and 3–5 letter ALL CAPS words; excludes common false positives.
 *
 * @param {string} narrative
 * @param {string[]} allowedTickers
 * @returns {string[]} sorted unique offending symbols
 */
export function findDisallowedTickerMentions(narrative, allowedTickers) {
  const allowed = new Set(allowedTickers.map((t) => String(t).trim().toUpperCase()).filter(Boolean));
  const bad = new Set();
  const s = String(narrative ?? '');

  const paren = /\(([A-Z]{1,5})\)/g;
  let m;
  while ((m = paren.exec(s)) !== null) {
    const sym = m[1];
    if (EXCLUDED_PARENTHETICAL.has(sym)) continue;
    if (!allowed.has(sym)) bad.add(sym);
  }

  const word = /\b([A-Z]{3,5})\b/g;
  while ((m = word.exec(s)) !== null) {
    const sym = m[1];
    if (EXCLUDED_UPPER_WORD.has(sym)) continue;
    if (!allowed.has(sym)) bad.add(sym);
  }

  return [...bad].sort((a, b) => a.localeCompare(b));
}

/**
 * @param {Record<string, unknown>} slim output of slimConsensusDigestForLlm*
 * @returns {string[]} sorted unique tickers (uppercase)
 */
export function collectAllowedTickersFromSlimDigest(slim) {
  const tickers = new Set();
  const add = (o) => {
    if (!o || typeof o !== 'object') return;
    const t = String(o.ticker ?? '')
      .trim()
      .toUpperCase();
    if (t) tickers.add(t);
  };

  for (const bucket of [
    slim.consensusMultiBuys,
    slim.singleExpertNetBuys,
    slim.consensusSells,
    slim.mixedNetZero,
  ]) {
    for (const r of bucket || []) add(r);
  }
  for (const p of slim.largeBuyPositions || []) add(p);
  for (const p of slim.largeSellPositions || []) add(p);

  for (const e of slim.meta?.tickerCatalog || []) {
    if (e && typeof e === 'object') add(e);
  }

  return [...tickers].sort((a, b) => a.localeCompare(b));
}
