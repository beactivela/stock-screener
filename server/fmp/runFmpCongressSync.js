/**
 * Pull latest Senate + House disclosure rows from FMP stable API into Supabase.
 * Plan limits often cap `limit` at 25 per request — see FMP_CONGRESS_LIMIT (max 25).
 */
import { getSupabase } from '../supabase.js';
import { fmpStableGet } from './fmpClient.js';

const BATCH = 200;

function clampLimit(n) {
  /** FMP free/basic tiers often allow max 25 per senate-latest / house-latest request. */
  const maxCap = Number.isFinite(Number(process.env.FMP_CONGRESS_MAX_LIMIT))
    ? Math.min(100, Math.floor(Number(process.env.FMP_CONGRESS_MAX_LIMIT)))
    : 25;
  const x = Number.isFinite(n) ? Math.floor(n) : maxCap;
  return Math.min(maxCap, Math.max(1, x));
}

/**
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<{ ok: boolean, runId?: string, senateRows?: number, houseRows?: number, error?: string, skipped?: boolean, reason?: string }>}
 */
export async function runFmpCongressSync(opts = {}) {
  if (!process.env.FMP_API_KEY?.trim()) {
    return { ok: true, skipped: true, reason: 'FMP_API_KEY not set' };
  }

  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, error: 'Supabase not configured (SUPABASE_URL + SUPABASE_SERVICE_KEY)' };
  }

  const limit = clampLimit(opts.limit ?? (Number(process.env.FMP_CONGRESS_LIMIT) || 25));

  const { data: runRow, error: runErr } = await supabase
    .from('fmp_sync_runs')
    .insert({
      status: 'running',
      label: 'experts-unified',
    })
    .select('id')
    .single();

  if (runErr || !runRow) {
    return { ok: false, error: runErr?.message || 'failed to create fmp_sync_runs row' };
  }

  const runId = runRow.id;

  try {
    const [senateRes, houseRes] = await Promise.all([
      fmpStableGet('/senate-latest', { limit }),
      fmpStableGet('/house-latest', { limit }),
    ]);

    if (!senateRes.ok || !Array.isArray(senateRes.data)) {
      throw new Error(senateRes.errorText || 'senate-latest failed');
    }
    if (!houseRes.ok || !Array.isArray(houseRes.data)) {
      throw new Error(houseRes.errorText || 'house-latest failed');
    }

    /** @param {string} chamber */
    function mapRow(chamber, row) {
      return {
        sync_run_id: runId,
        chamber,
        symbol: row.symbol ?? null,
        disclosure_date: row.disclosureDate ?? null,
        transaction_date: row.transactionDate ?? null,
        first_name: row.firstName ?? null,
        last_name: row.lastName ?? null,
        office: row.office ?? null,
        district: row.district ?? null,
        owner: row.owner ?? null,
        asset_description: row.assetDescription ?? null,
        asset_type: row.assetType ?? null,
        transaction_type: row.type ?? null,
        amount_range: row.amount ?? null,
        comment: row.comment ?? null,
        link: row.link ?? null,
        capital_gains_over_200: row.capitalGainsOver200USD ?? null,
        raw_json: row,
      };
    }

    const senateRows = (senateRes.data || []).map((r) => mapRow('senate', r));
    const houseRows = (houseRes.data || []).map((r) => mapRow('house', r));
    const all = [...senateRows, ...houseRows];

    for (let i = 0; i < all.length; i += BATCH) {
      const chunk = all.slice(i, i + BATCH);
      const { error: insErr } = await supabase.from('fmp_congress_trades').insert(chunk);
      if (insErr) throw new Error(insErr.message);
    }

    const finishedAt = new Date().toISOString();
    await supabase
      .from('fmp_sync_runs')
      .update({
        status: 'completed',
        finished_at: finishedAt,
        fmp_congress_senate_rows: senateRows.length,
        fmp_congress_house_rows: houseRows.length,
      })
      .eq('id', runId);

    return {
      ok: true,
      runId,
      senateRows: senateRows.length,
      houseRows: houseRows.length,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase
      .from('fmp_sync_runs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        error_message: msg,
      })
      .eq('id', runId);
    return { ok: false, error: msg, runId };
  }
}

/**
 * Best-effort probe for 13F / institutional endpoints (often premium-only).
 * Does not persist rows; records intent on the next fmp_sync_runs if you extend later.
 *
 * @returns {Promise<{ ok: boolean, status?: string, detail?: string }>}
 */
export async function runFmpInstitutionalOwnershipProbe() {
  if (!process.env.FMP_API_KEY?.trim()) {
    return { ok: true, status: 'skipped', detail: 'no FMP_API_KEY' };
  }
  const res = await fmpStableGet('/institutional-ownership/latest', { limit: 1, page: 0 });
  if (res.ok && Array.isArray(res.data)) {
    return { ok: true, status: 'available', detail: `rows ${res.data.length}` };
  }
  return {
    ok: true,
    status: 'subscription_or_plan',
    detail: res.errorText?.slice(0, 200) || `http ${res.status}`,
  };
}
