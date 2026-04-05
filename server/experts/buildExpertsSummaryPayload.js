/**
 * Combined summary for the Expert overlap UI: guru overlap + WhaleWisdom filers + FMP Congress.
 */
import { getSupabase } from '../supabase.js';
import { buildStockcircleSummaryPayload } from '../stockcircle/buildSummaryPayload.js';

/**
 * @returns {Promise<Record<string, unknown>>}
 */
export async function buildExpertsSummaryPayload() {
  try {
    return await buildExpertsSummaryPayloadInner();
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.message
        : typeof e === 'object' && e !== null && 'message' in e
          ? String(/** @type {{ message: unknown }} */ (e).message)
          : String(e);
    return {
      ok: false,
      error: msg || 'Experts summary failed',
      latestRun: null,
      popular: [],
      expertWeightsByTicker: {},
      gateway: { fmpCongress: null, fmpInstitutional: null },
      congressRecent: { senate: [], house: [] },
      whalewisdomFilers: [],
    };
  }
}

async function buildExpertsSummaryPayloadInner() {
  const base = await buildStockcircleSummaryPayload();
  if (!base.ok) {
    return {
      ...base,
      gateway: { fmpCongress: null, fmpInstitutional: null },
      congressRecent: { senate: [], house: [] },
      whalewisdomFilers: [],
    };
  }

  const supabase = getSupabase();
  if (!supabase) {
    return {
      ...base,
      gateway: { fmpCongress: null, fmpInstitutional: null },
      congressRecent: { senate: [], house: [] },
      whalewisdomFilers: [],
    };
  }

  let gateway = {
    fmpCongress: /** @type {Record<string, unknown> | null} */ (null),
    fmpInstitutional: /** @type {unknown} */ (null),
  };
  let congressRecent = { senate: /** @type {object[]} */ ([]), house: /** @type {object[]} */ ([]) };

  try {
    const { data: fmpRun, error: runErr } = await supabase
      .from('fmp_sync_runs')
      .select(
        'id, started_at, finished_at, fmp_congress_senate_rows, fmp_congress_house_rows, fmp_institutional_probe, status'
      )
      .eq('status', 'completed')
      .order('finished_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (runErr) throw runErr;

    if (fmpRun?.id) {
      gateway = {
        fmpCongress: {
          finishedAt: fmpRun.finished_at,
          senateRows: fmpRun.fmp_congress_senate_rows,
          houseRows: fmpRun.fmp_congress_house_rows,
        },
        fmpInstitutional: fmpRun.fmp_institutional_probe
          ? tryParseJson(fmpRun.fmp_institutional_probe)
          : null,
      };

      const { data: trades, error: tErr } = await supabase
        .from('fmp_congress_trades')
        .select(
          'chamber, symbol, disclosure_date, transaction_date, first_name, last_name, office, district, transaction_type, amount_range, asset_description, link'
        )
        .eq('sync_run_id', fmpRun.id)
        .order('disclosure_date', { ascending: false, nullsFirst: false });

      if (tErr) throw tErr;

      const list = trades || [];
      congressRecent = {
        senate: list.filter((r) => r.chamber === 'senate'),
        house: list.filter((r) => r.chamber === 'house'),
      };
    }
  } catch (e) {
    gateway = {
      fmpCongress: { error: e instanceof Error ? e.message : String(e) },
      fmpInstitutional: null,
    };
  }

  /** 13F / WhaleWisdom filers synced in parallel — blended into expert UI (no performance % in DB). */
  let whalewisdomFilers = [];
  try {
    const { data: wwRows, error: wwErr } = await supabase
      .from('whalewisdom_filers')
      .select('slug, display_name, manager_name')
      .order('manager_name', { ascending: true, nullsFirst: false });
    if (!wwErr && wwRows?.length) {
      whalewisdomFilers = wwRows.map((r) => ({
        slug: r.slug,
        displayName: r.display_name || r.slug,
        managerName: r.manager_name || '',
      }));
    }
  } catch {
    whalewisdomFilers = [];
  }

  return {
    ...base,
    gateway,
    congressRecent,
    whalewisdomFilers,
  };
}

function tryParseJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
