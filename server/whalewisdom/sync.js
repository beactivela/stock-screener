/**
 * WhaleWisdom filer sync: configured slugs → parse Nuxt payload → Supabase.
 */
import { getSupabase } from '../supabase.js';
import { fetchFilerPageHtml, filerPageUrl } from './fetchPages.js';
import { parseWhalewisdomFilerFromHtml } from './parseNuxtFiler.js';
import { getWhalewisdomFilersFromEnv } from './filerSlugs.js';

const BATCH = 300;

/**
 * @param {{ delayBetweenFilersMs?: number }} [opts]
 */
export async function runWhalewisdomSync(opts = {}) {
  const delayMs = opts.delayBetweenFilersMs ?? 600;
  const filers = getWhalewisdomFilersFromEnv();

  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, error: 'Supabase not configured (SUPABASE_URL + SUPABASE_SERVICE_KEY)' };
  }

  const { data: runRow, error: runErr } = await supabase
    .from('whalewisdom_sync_runs')
    .insert({
      status: 'running',
      filers_matched: filers.length,
      filers_fetched: 0,
    })
    .select('id')
    .single();

  if (runErr || !runRow) {
    return { ok: false, error: runErr?.message || 'failed to create sync run' };
  }

  const runId = runRow.id;
  const errors = [];
  let fetched = 0;
  const positionRows = [];

  for (const cfg of filers) {
    const slug = String(cfg.slug || '')
      .trim()
      .toLowerCase();
    if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
      errors.push({ slug, message: 'invalid filer slug' });
      continue;
    }

    try {
      const html = await fetchFilerPageHtml(slug);
      const parsed = parseWhalewisdomFilerFromHtml(html, slug);

      await supabase.from('whalewisdom_filers').upsert(
        {
          slug: parsed.slug,
          display_name: parsed.displayName,
          manager_name: cfg.managerName ?? null,
          ww_filer_id: parsed.wwFilerId,
          whalewisdom_url: filerPageUrl(slug),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'slug' }
      );

      for (const p of parsed.positions) {
        const raw =
          p.securityType && p.securityType !== 'SH' && p.securityType !== ''
            ? `WhaleWisdom top holdings snapshot · ${p.securityType}`
            : 'WhaleWisdom top holdings snapshot (SSR)';
        positionRows.push({
          sync_run_id: runId,
          filer_slug: parsed.slug,
          ticker: p.ticker,
          company_name: p.companyName,
          action_type: 'held',
          action_pct: null,
          quarter_label: parsed.quarterLabel,
          shares_held: null,
          shares_raw: null,
          position_value_usd: null,
          pct_of_portfolio: p.pctOfPortfolio,
          security_type: p.securityType,
          raw_snapshot: raw,
        });
      }

      fetched += 1;
    } catch (e) {
      errors.push({ slug, message: e instanceof Error ? e.message : String(e) });
    }

    await new Promise((r) => setTimeout(r, delayMs));
  }

  for (let i = 0; i < positionRows.length; i += BATCH) {
    const chunk = positionRows.slice(i, i + BATCH);
    const { error: insErr } = await supabase.from('whalewisdom_positions').insert(chunk);
    if (insErr) {
      await supabase
        .from('whalewisdom_sync_runs')
        .update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          error_message: insErr.message,
          filers_fetched: fetched,
        })
        .eq('id', runId);
      return { ok: false, error: insErr.message, runId, errors };
    }
  }

  const finishedAt = new Date().toISOString();
  await supabase
    .from('whalewisdom_sync_runs')
    .update({
      status: 'completed',
      finished_at: finishedAt,
      filers_fetched: fetched,
      error_message: errors.length ? JSON.stringify(errors) : null,
    })
    .eq('id', runId);

  return {
    ok: true,
    runId,
    filersMatched: filers.length,
    filersFetched: fetched,
    positionRows: positionRows.length,
    errors,
  };
}
