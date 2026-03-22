/**
 * Fundamentals data access: Supabase when configured, else data/fundamentals.json
 * Returns object keyed by ticker: { AAPL: { pctHeldByInst, industry, ... } }
 */

import { getSupabase, isSupabaseConfigured } from '../supabase.js';

export const FUNDAMENTALS_FIELD_TO_COLUMN = {
  pctHeldByInst: 'pct_held_by_inst',
  qtrEarningsYoY: 'qtr_earnings_yoy',
  profitMargin: 'profit_margin',
  operatingMargin: 'operating_margin',
  industry: 'industry',
  sector: 'sector',
  companyName: 'company_name',
  fetchedAt: 'fetched_at',
};

const FUNDAMENTALS_FIELDS = Object.keys(FUNDAMENTALS_FIELD_TO_COLUMN);

function normalizeTickers(tickers) {
  if (!tickers) return null;
  const normalized = [...new Set(
    (Array.isArray(tickers) ? tickers : [tickers])
      .map((ticker) => String(ticker || '').trim().toUpperCase())
      .filter(Boolean)
  )];
  return normalized.length > 0 ? normalized : [];
}

function normalizeFields(fields) {
  if (!fields) return null;
  const normalized = [...new Set(
    (Array.isArray(fields) ? fields : [fields])
      .flatMap((value) => String(value || '').split(','))
      .map((value) => value.trim())
      .filter((value) => FUNDAMENTALS_FIELDS.includes(value))
  )];
  return normalized.length > 0 ? normalized : [];
}

export function buildFundamentalsSelectClause({ fields = null, includeRaw = true } = {}) {
  const normalizedFields = normalizeFields(fields);
  const columns = ['ticker'];
  const sourceFields = normalizedFields && normalizedFields.length > 0
    ? normalizedFields
    : FUNDAMENTALS_FIELDS;
  for (const field of sourceFields) {
    columns.push(FUNDAMENTALS_FIELD_TO_COLUMN[field]);
  }
  if (includeRaw) columns.push('raw');
  return [...new Set(columns)].join(',');
}

export function projectFundamentalsEntry(entry, fields = null) {
  const normalizedFields = normalizeFields(fields);
  if (!entry || !normalizedFields || normalizedFields.length === 0) {
    return entry ? { ...entry } : null;
  }
  const projected = {};
  for (const field of normalizedFields) {
    if (field in entry) projected[field] = entry[field];
  }
  return projected;
}

function rowToEntry(r, options = {}) {
  if (!r) return null;
  const { fields = null, includeRaw = true } = options;
  const entry = {
    pctHeldByInst: r.pct_held_by_inst ?? null,
    qtrEarningsYoY: r.qtr_earnings_yoy ?? null,
    profitMargin: r.profit_margin ?? null,
    operatingMargin: r.operating_margin ?? null,
    industry: r.industry ?? null,
    sector: r.sector ?? null,
    companyName: r.company_name ?? null,
    fetchedAt: r.fetched_at ?? null,
  };
  const merged = includeRaw ? { ...entry, ...(r.raw || {}) } : entry;
  return projectFundamentalsEntry(merged, fields);
}

/** @returns {Promise<Record<string, object>>} */
export async function loadFundamentals(options = {}) {
  if (!isSupabaseConfigured()) throw new Error('Supabase required. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env');
  const {
    tickers = null,
    fields = null,
    includeRaw = fields == null,
  } = options;
  const normalizedTickers = normalizeTickers(tickers);
  const normalizedFields = normalizeFields(fields);
  if (Array.isArray(normalizedTickers) && normalizedTickers.length === 0) return {};
  const supabase = getSupabase();
  let query = supabase
    .from('fundamentals')
    .select(buildFundamentalsSelectClause({ fields: normalizedFields, includeRaw }));
  if (normalizedTickers && normalizedTickers.length > 0) {
    query = query.in('ticker', normalizedTickers);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const out = {};
  for (const r of data || []) {
    out[r.ticker] = rowToEntry(r, { fields: normalizedFields, includeRaw });
  }
  return out;
}

/** @param {Record<string, object>} data */
export async function saveFundamentals(data) {
  if (!isSupabaseConfigured()) throw new Error('Supabase required. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.');
  const supabase = getSupabase();
  const rows = Object.entries(data).map(([ticker, v]) => ({
    ticker,
    pct_held_by_inst: v?.pctHeldByInst ?? null,
    qtr_earnings_yoy: v?.qtrEarningsYoY ?? null,
    profit_margin: v?.profitMargin ?? null,
    operating_margin: v?.operatingMargin ?? null,
    industry: v?.industry ?? null,
    sector: v?.sector ?? null,
    company_name: v?.companyName ?? null,
    fetched_at: v?.fetchedAt ?? null,
    raw: v ?? null,
  }));
  const { error } = await supabase.from('fundamentals').upsert(rows, { onConflict: 'ticker' });
  if (error) throw new Error(error.message);
}
