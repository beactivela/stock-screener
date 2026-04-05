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
      quiverCongress: null,
      crossSourceTickers: {},
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
      quiverCongress: null,
      crossSourceTickers: {},
    };
  }

  const supabase = getSupabase();
  if (!supabase) {
    return {
      ...base,
      gateway: { fmpCongress: null, fmpInstitutional: null },
      congressRecent: { senate: [], house: [] },
      whalewisdomFilers: [],
      quiverCongress: null,
      crossSourceTickers: {},
    };
  }

  let gateway = {
    fmpCongress: /** @type {Record<string, unknown> | null} */ (null),
    fmpInstitutional: /** @type {unknown} */ (null),
  };
  let congressRecent = { senate: /** @type {object[]} */ ([]), house: /** @type {object[]} */ ([]) };
  /** @type {string | null} */
  let fmpRunIdForCross = null;

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
      fmpRunIdForCross = fmpRun.id;
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

  let quiverCongress = /** @type {Record<string, unknown> | null} */ (null);
  try {
    const { data: qRun, error: qErr } = await supabase
      .from('quiver_sync_runs')
      .select('id, finished_at')
      .eq('status', 'completed')
      .order('finished_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (qErr) throw qErr;
    if (qRun?.id) {
      const { data: mRows, error: mErr } = await supabase
        .from('quiver_politician_metrics')
        .select(
          'bioguide_id, perf_1y_pct, perf_3y_pct, perf_5y_pct, perf_10y_pct, strategy_start_date, fetched_at'
        )
        .eq('sync_run_id', qRun.id);
      if (mErr) throw mErr;

      const { data: idRows } = await supabase
        .from('congress_politician_identity')
        .select('bioguide_id, full_name');
      const nameByBio = new Map((idRows || []).map((r) => [r.bioguide_id, r.full_name]));

      const { data: tRows, error: tqErr } = await supabase
        .from('quiver_politician_trades')
        .select(
          'bioguide_id, transaction_date, filed_date, symbol, transaction_type, description, amount_range, chamber, excess_return_pct'
        )
        .eq('sync_run_id', qRun.id)
        .order('transaction_date', { ascending: false, nullsFirst: false })
        .limit(2000);
      if (tqErr) throw tqErr;

      /** @type {Record<string, object[]>} */
      const tradesByBio = {};
      for (const t of tRows || []) {
        const b = t.bioguide_id;
        if (!tradesByBio[b]) tradesByBio[b] = [];
        if (tradesByBio[b].length < 40) tradesByBio[b].push(t);
      }

      quiverCongress = {
        finishedAt: qRun.finished_at,
        runId: qRun.id,
        members: (mRows || []).map((m) => ({
          bioguideId: m.bioguide_id,
          fullName: nameByBio.get(m.bioguide_id) || m.bioguide_id,
          perf1yPct: m.perf_1y_pct,
          perf3yPct: m.perf_3y_pct,
          perf5yPct: m.perf_5y_pct,
          perf10yPct: m.perf_10y_pct,
          strategyStartDate: m.strategy_start_date,
          fetchedAt: m.fetched_at,
          recentTrades: tradesByBio[m.bioguide_id] || [],
        })),
      };
    }
  } catch {
    quiverCongress = null;
  }

  /** Per-ticker overlap with WhaleWisdom 13F snapshot + FMP Congress disclosures (for conviction multipliers). */
  let crossSourceTickers = {};
  try {
    crossSourceTickers = await buildCrossSourceTickersMap(supabase, base.popular, fmpRunIdForCross);
  } catch {
    crossSourceTickers = {};
  }

  return {
    ...base,
    gateway,
    congressRecent,
    whalewisdomFilers,
    quiverCongress,
    crossSourceTickers,
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Array<{ ticker?: string }>} popular
 * @param {string | null} fmpRunId
 */
async function buildCrossSourceTickersMap(supabase, popular, fmpRunId) {
  const upper = (t) => String(t || '').trim().toUpperCase();
  const out = /** @type {Record<string, { whalewisdom: boolean; congress: boolean }>} */ ({});
  const popList = popular || [];
  if (!popList.length) return out;

  const popSet = new Set();
  for (const p of popList) {
    const tk = upper(p.ticker);
    if (tk) popSet.add(tk);
  }

  const wwSet = new Set();
  try {
    const { data, error } = await supabase.from('v_whalewisdom_positions_latest').select('ticker').limit(20000);
    if (!error && data?.length) {
      for (const r of data) {
        const tk = upper(r.ticker);
        if (tk) wwSet.add(tk);
      }
    }
  } catch {
    // view / RLS — leave wwSet empty
  }

  const congressSet = new Set();
  if (fmpRunId) {
    try {
      const { data, error } = await supabase
        .from('fmp_congress_trades')
        .select('symbol')
        .eq('sync_run_id', fmpRunId)
        .limit(20000);
      if (!error && data?.length) {
        for (const r of data) {
          const tk = upper(r.symbol);
          if (tk) congressSet.add(tk);
        }
      }
    } catch {
      // ignore
    }
  }

  for (const tk of popSet) {
    out[tk] = {
      whalewisdom: wwSet.has(tk),
      congress: congressSet.has(tk),
    };
  }
  return out;
}

function tryParseJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
