/**
 * Load stockcircle_investors with multi-year performance columns when present.
 * Falls back to 1Y-only if the DB (or PostgREST schema cache) does not expose 3Y/5Y/10Y yet.
 */
const COLS_FULL =
  'slug, display_name, firm_name, performance_1y_pct, performance_3y_pct, performance_5y_pct, performance_10y_pct';
const COLS_MIN = 'slug, display_name, firm_name, performance_1y_pct';

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isMissingMultiYearPerformanceColumnError(err) {
  if (!err || typeof err !== 'object') return false;
  const o = /** @type {{ message?: string; details?: string; hint?: string; code?: string }} */ (err);
  const msg = [o.message, o.details, o.hint, o.code].filter(Boolean).join(' ');
  return (
    /performance_3y_pct|performance_5y_pct|performance_10y_pct/i.test(msg) &&
    (/does not exist|42703|column/i.test(msg) || /schema cache/i.test(msg))
  );
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string[]} slugs
 */
export async function selectInvestorsBySlugs(supabase, slugs) {
  if (!slugs?.length) return { data: [], error: null };
  const r = await supabase.from('stockcircle_investors').select(COLS_FULL).in('slug', slugs);
  if (r.error && isMissingMultiYearPerformanceColumnError(r.error)) {
    return supabase.from('stockcircle_investors').select(COLS_MIN).in('slug', slugs);
  }
  return r;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} slug
 */
export async function selectInvestorBySlug(supabase, slug) {
  const full = `${COLS_FULL}, updated_at`;
  const min = `${COLS_MIN}, updated_at`;
  const r = await supabase.from('stockcircle_investors').select(full).eq('slug', slug).maybeSingle();
  if (r.error && isMissingMultiYearPerformanceColumnError(r.error)) {
    return supabase.from('stockcircle_investors').select(min).eq('slug', slug).maybeSingle();
  }
  return r;
}
