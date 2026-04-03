/**
 * Parser for Investor's Business Daily "My Stock List" text export.
 * Trailing columns: Composite, EPS, RS, SMR, Acc/Dis, Group Rel Str (see IBD UI).
 */

/** Last six fields: three numeric ratings then three letter/N/A grades. */
const TRAILING_IBD_RATINGS =
  /\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s*$/;

function normalizeTickerSymbol(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase();
}

function normalizeIbdGradeToken(token) {
  const t = String(token || '').trim();
  if (!t || /^n\/a$/i.test(t)) return null;
  return t;
}

function parseNumericRating(n) {
  const v = parseInt(String(n), 10);
  return Number.isFinite(v) ? v : null;
}

/**
 * @param {string} line
 * @returns {{ ticker: string, ibdCompositeRating: number, ibdEpsRating: number, ibdRsRating: number, ibdSmrRating: string | null, ibdAccDisRating: string | null, ibdGroupRelStrRating: string | null } | null}
 */
export function parseIbdStockListLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;
  if (/^stock list name:/i.test(trimmed)) return null;
  if (/^stock list date:/i.test(trimmed)) return null;
  if (/^sorted:/i.test(trimmed)) return null;
  if (/^stock\s+company\b/i.test(trimmed)) return null;
  if (/^symbol\s+name\b/i.test(trimmed)) return null;
  if (/^data provided\b/i.test(trimmed)) return null;
  if (/^investor'?s business daily\b/i.test(trimmed)) return null;
  if (/^reproduction or redistribution\b/i.test(trimmed)) return null;
  if (/^provided by nasdaq\b/i.test(trimmed)) return null;

  const mRatings = trimmed.match(TRAILING_IBD_RATINGS);
  if (!mRatings) return null;

  const head = trimmed.slice(0, mRatings.index).trim();
  const tickerMatch = head.match(/^([A-Z0-9.-]+)/i);
  if (!tickerMatch) return null;

  const ticker = normalizeTickerSymbol(tickerMatch[1]);

  return {
    ticker,
    ibdCompositeRating: parseNumericRating(mRatings[1]),
    ibdEpsRating: parseNumericRating(mRatings[2]),
    ibdRsRating: parseNumericRating(mRatings[3]),
    ibdSmrRating: normalizeIbdGradeToken(mRatings[4]),
    ibdAccDisRating: normalizeIbdGradeToken(mRatings[5]),
    ibdGroupRelStrRating: normalizeIbdGradeToken(mRatings[6]),
  };
}

/**
 * @param {string} fileContent
 * @returns {Array<NonNullable<ReturnType<typeof parseIbdStockListLine>>>}
 */
export function parseIbdStockListExport(fileContent) {
  const lines = String(fileContent || '').split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const row = parseIbdStockListLine(line);
    if (row) out.push(row);
  }
  return out;
}
