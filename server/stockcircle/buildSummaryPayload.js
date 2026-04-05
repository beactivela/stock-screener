/**
 * Shared payload for GET /api/stockcircle/summary and GET /api/experts/summary (overlap matrix).
 */
import { getSupabase } from '../supabase.js';
import { dedupeDbRowsForExpertColumn } from './dedupeExperts.js';
import { selectInvestorsBySlugs } from './selectInvestors.js';

/** PostgREST caps `.in('ticker', …)` — chunk when joining popularity metadata to ticker lists. */
const TICKER_IN_CHUNK = 120;
/** Page size for `range()` when loading all positions for a sync run. */
const POSITIONS_PAGE = 1000;

/**
 * @returns {Promise<{ ok: boolean, latestRun: object | null, popular: object[], expertWeightsByTicker: Record<string, object[]>, error?: string }>}
 */
export async function buildStockcircleSummaryPayload() {
  try {
    return await buildStockcircleSummaryPayloadInner();
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.message
        : typeof e === 'object' && e !== null && 'message' in e
          ? String(/** @type {{ message: unknown }} */ (e).message)
          : String(e);
    return {
      ok: false,
      error: msg || 'StockCircle summary failed',
      latestRun: null,
      popular: [],
      expertWeightsByTicker: {},
    };
  }
}

async function buildStockcircleSummaryPayloadInner() {
  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, error: 'Supabase not configured', latestRun: null, popular: [], expertWeightsByTicker: {} };
  }

  const { data: runs, error: runErr } = await supabase
    .from('stockcircle_sync_runs')
    .select('id, started_at, finished_at, status, investors_matched, investors_fetched, error_message')
    .eq('status', 'completed')
    .order('finished_at', { ascending: false, nullsFirst: false })
    .limit(1);

  if (runErr) throw runErr;
  const latestRun = runs?.[0] ?? null;

  /** @type {Array<{ ticker: string, buying_firms: number, selling_firms: number }>} */
  let popular = [];

  /** @type {Record<string, Array<Record<string, unknown>>>} */
  let expertWeightsByTicker = {};

  if (latestRun?.id) {
    /** Load every position in the latest run (not only top-N “popular” tickers) so experts and consensus see full overlap. */
    const allPos = [];
    for (let from = 0; ; from += POSITIONS_PAGE) {
      const { data: part, error: posErr } = await supabase
        .from('stockcircle_positions')
        .select(
          'ticker, investor_slug, pct_of_portfolio, position_value_usd, action_type, action_pct, company_name'
        )
        .eq('sync_run_id', latestRun.id)
        .order('id', { ascending: true })
        .range(from, from + POSITIONS_PAGE - 1);
      if (posErr) throw posErr;
      if (!part?.length) break;
      allPos.push(...part);
      if (part.length < POSITIONS_PAGE) break;
    }

    const tickersUpper = [
      ...new Set(allPos.map((p) => String(p.ticker || '').trim().toUpperCase()).filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b));

    /** Merge `buying_firms` / `selling_firms` from the view when present (chunked `.in`). */
    const popMeta = new Map();
    for (let i = 0; i < tickersUpper.length; i += TICKER_IN_CHUNK) {
      const chunk = tickersUpper.slice(i, i + TICKER_IN_CHUNK);
      if (chunk.length === 0) continue;
      const { data: popRows, error: popErr } = await supabase
        .from('v_stockcircle_ticker_popularity')
        .select('ticker, buying_firms, selling_firms')
        .in('ticker', chunk);
      if (popErr) throw popErr;
      for (const row of popRows || []) {
        const tk = String(row.ticker || '')
          .trim()
          .toUpperCase();
        if (tk) popMeta.set(tk, row);
      }
    }

    popular = tickersUpper.map((tk) => {
      const row = popMeta.get(tk);
      return {
        ticker: tk,
        buying_firms: row?.buying_firms ?? 0,
        selling_firms: row?.selling_firms ?? 0,
      };
    });
    popular.sort((a, b) => {
      const bf = Number(b.buying_firms) || 0;
      const af = Number(a.buying_firms) || 0;
      if (bf !== af) return bf - af;
      return String(a.ticker).localeCompare(String(b.ticker));
    });

    const slugs = [...new Set(allPos.map((p) => p.investor_slug))];
    /** PostgREST rejects `.in('slug', [])` — empty array causes 400 / server errors. */
    let invRows = [];
    if (slugs.length > 0) {
      const { data: invData, error: invErr } = await selectInvestorsBySlugs(supabase, slugs);
      if (invErr) throw invErr;
      invRows = invData || [];
    }

    const invBySlug = Object.fromEntries(invRows.map((i) => [i.slug, i]));

    const byTicker = new Map();
    for (const p of allPos) {
      const tk = String(p.ticker || '').trim().toUpperCase();
      if (!byTicker.has(tk)) byTicker.set(tk, []);
      byTicker.get(tk).push(p);
    }

    for (const [tk, plist] of byTicker) {
      const rows = dedupeDbRowsForExpertColumn(plist);
      expertWeightsByTicker[tk] = rows.map((p) => {
        const inv = invBySlug[p.investor_slug];
        return {
          investorSlug: p.investor_slug,
          firmName: inv?.firm_name || p.investor_slug,
          displayName: inv?.display_name || p.investor_slug,
          performance1yPct: inv?.performance_1y_pct ?? null,
          performance3yPct: inv?.performance_3y_pct ?? null,
          performance5yPct: inv?.performance_5y_pct ?? null,
          performance10yPct: inv?.performance_10y_pct ?? null,
          pctOfPortfolio: p.pct_of_portfolio,
          positionValueUsd: p.position_value_usd,
          actionType: p.action_type,
          actionPct: p.action_pct,
          companyName: p.company_name,
        };
      });
    }
  }

  return {
    ok: true,
    latestRun,
    popular,
    expertWeightsByTicker,
  };
}
