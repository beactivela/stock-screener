/**
 * Full StockCircle sync: best investors (performance filter) → portfolio pages → Supabase.
 */
import { getSupabase } from '../supabase.js';
import { parseBestInvestorsFromHtml, filterByMinPerformance } from './parseBestInvestors.js';
import { fetchBestInvestorsHtml, fetchAllPortfolioPages, fetchPerformancePageHtml } from './fetchPages.js';
import { parsePerformancePageHtml } from './parsePerformancePage.js';
import { dedupeParsedPositionsByTicker } from './dedupeExperts.js';

const BATCH = 300;

/** Enough top performers for ticker overlap (same symbol bought/sold by multiple experts). */
const DEFAULT_OVERLAP_INVESTORS = 40;
/** Deep enough per portfolio to catch names beyond page 1 without multi-hour full scrapes. */
const DEFAULT_OVERLAP_PAGES = 30;
const FULL_SYNC_MAX_PAGES = 500;

/**
 * Re-fetch attempts when portfolio or DB write fails (transient HTTP, rate limits).
 * Override with STOCKCIRCLE_INVESTOR_RETRIES (default 3 = up to 3 tries per expert).
 */
function investorAttemptCount() {
  const n = parseInt(String(process.env.STOCKCIRCLE_INVESTOR_RETRIES || '3'), 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(8, n) : 3;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Scrape one investor: portfolios + performance + upsert investor + append position rows.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ slug: string, displayName: string, firmName: string, performance1yPct: number | null }} inv
 * @param {string} runId
 * @param {Array<Record<string, unknown>>} positionRows
 * @param {Array<{ slug?: string, phase?: string, message: string }>} errors
 * @param {{ delayBetweenPortfolioPagesMs: number, maxPortfolioPages: number }} pageOpts
 */
async function ingestOneInvestor(supabase, inv, runId, positionRows, errors, pageOpts) {
  const positions = await fetchAllPortfolioPages(inv.slug, {
    delayMs: pageOpts.delayBetweenPortfolioPagesMs,
    maxPages: pageOpts.maxPortfolioPages,
  });

  let performance1yPct = inv.performance1yPct;
  let performance3yPct = null;
  let performance5yPct = null;
  let performance10yPct = null;
  try {
    const perfHtml = await fetchPerformancePageHtml(inv.slug);
    const parsed = parsePerformancePageHtml(perfHtml);
    if (parsed.performance1yPct != null) performance1yPct = parsed.performance1yPct;
    performance3yPct = parsed.performance3yPct;
    performance5yPct = parsed.performance5yPct;
    performance10yPct = parsed.performance10yPct;
  } catch (e) {
    errors.push({
      slug: inv.slug,
      phase: 'performance',
      message: e instanceof Error ? e.message : String(e),
    });
  }

  const { error: upErr } = await supabase.from('stockcircle_investors').upsert(
    {
      slug: inv.slug,
      display_name: inv.displayName,
      firm_name: inv.firmName,
      performance_1y_pct: performance1yPct,
      performance_3y_pct: performance3yPct,
      performance_5y_pct: performance5yPct,
      performance_10y_pct: performance10yPct,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'slug' }
  );
  if (upErr) {
    throw new Error(`stockcircle_investors upsert: ${upErr.message}`);
  }

  const uniquePositions = dedupeParsedPositionsByTicker(positions);
  for (const p of uniquePositions) {
    positionRows.push({
      sync_run_id: runId,
      investor_slug: inv.slug,
      ticker: p.ticker,
      company_name: p.companyName,
      action_type: p.actionType,
      action_pct: p.actionPct,
      quarter_label: p.quarterLabel,
      shares_held: p.sharesHeld,
      shares_raw: p.sharesRaw,
      position_value_usd: p.positionValueUsd,
      pct_of_portfolio: p.pctOfPortfolio,
      raw_last_transaction: p.rawLastTransaction,
    });
  }
}

/**
 * @param {{
 *   minPerformance1yPct?: number,
 *   delayBetweenPortfoliosMs?: number,
 *   delayBetweenPortfolioPagesMs?: number,
 *   maxInvestors?: number,
 *   maxPortfolioPages?: number,
 * }} [opts]
 */
export async function runStockcircleSync(opts = {}) {
  const minPct = opts.minPerformance1yPct ?? 20;
  const delayPf = opts.delayBetweenPortfoliosMs ?? 500;
  const delayPages = opts.delayBetweenPortfolioPagesMs ?? 550;

  const fullSync = process.env.STOCKCIRCLE_FULL_SYNC === '1';

  let maxInvestors = opts.maxInvestors;
  if (maxInvestors === undefined && process.env.STOCKCIRCLE_MAX_INVESTORS) {
    maxInvestors = parseInt(process.env.STOCKCIRCLE_MAX_INVESTORS, 10);
  }
  if (!fullSync) {
    if (!Number.isFinite(maxInvestors) || maxInvestors <= 0) {
      maxInvestors = DEFAULT_OVERLAP_INVESTORS;
    }
  } else if (!Number.isFinite(maxInvestors) || maxInvestors <= 0) {
    maxInvestors = undefined;
  }

  let maxPortfolioPages = opts.maxPortfolioPages;
  if (maxPortfolioPages === undefined && process.env.STOCKCIRCLE_MAX_PORTFOLIO_PAGES) {
    maxPortfolioPages = parseInt(process.env.STOCKCIRCLE_MAX_PORTFOLIO_PAGES, 10);
  }
  if (!fullSync) {
    if (!Number.isFinite(maxPortfolioPages) || maxPortfolioPages <= 0) {
      maxPortfolioPages = DEFAULT_OVERLAP_PAGES;
    }
  } else if (!Number.isFinite(maxPortfolioPages) || maxPortfolioPages <= 0) {
    maxPortfolioPages = FULL_SYNC_MAX_PAGES;
  }

  const pageOpts = {
    delayBetweenPortfolioPagesMs: delayPages,
    maxPortfolioPages: Number.isFinite(maxPortfolioPages) && maxPortfolioPages > 0 ? maxPortfolioPages : 500,
  };

  const supabase = getSupabase();
  if (!supabase) {
    return { ok: false, error: 'Supabase not configured (SUPABASE_URL + SUPABASE_SERVICE_KEY)' };
  }

  let bestHtml;
  try {
    bestHtml = await fetchBestInvestorsHtml();
  } catch (e) {
    return { ok: false, error: `best-investors fetch: ${e.message}` };
  }

  const allInvestors = parseBestInvestorsFromHtml(bestHtml);
  let selected = filterByMinPerformance(allInvestors, minPct);
  if (Number.isFinite(maxInvestors) && maxInvestors > 0) {
    selected = selected.slice(0, maxInvestors);
  }

  const { data: runRow, error: runErr } = await supabase
    .from('stockcircle_sync_runs')
    .insert({
      status: 'running',
      investors_matched: selected.length,
      investors_fetched: 0,
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

  const maxAttempts = investorAttemptCount();

  for (const inv of selected) {
    let ok = false;
    let lastMsg = '';
    for (let attempt = 1; attempt <= maxAttempts && !ok; attempt++) {
      try {
        await ingestOneInvestor(supabase, inv, runId, positionRows, errors, pageOpts);
        fetched += 1;
        ok = true;
      } catch (e) {
        lastMsg = e instanceof Error ? e.message : String(e);
        if (attempt < maxAttempts) {
          const backoff = Math.min(60_000, 2500 * attempt ** 2);
          await sleep(backoff);
        } else {
          errors.push({ slug: inv.slug, message: lastMsg, attempts: maxAttempts });
        }
      }
    }

    await sleep(delayPf);
  }

  for (let i = 0; i < positionRows.length; i += BATCH) {
    const chunk = positionRows.slice(i, i + BATCH);
    const { error: insErr } = await supabase.from('stockcircle_positions').insert(chunk);
    if (insErr) {
      await supabase
        .from('stockcircle_sync_runs')
        .update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          error_message: insErr.message,
          investors_fetched: fetched,
        })
        .eq('id', runId);
      return { ok: false, error: insErr.message, runId, errors };
    }
  }

  const finishedAt = new Date().toISOString();
  await supabase
    .from('stockcircle_sync_runs')
    .update({
      status: 'completed',
      finished_at: finishedAt,
      investors_fetched: fetched,
      error_message: errors.length ? JSON.stringify(errors) : null,
    })
    .eq('id', runId);

  return {
    ok: true,
    runId,
    investorsMatched: selected.length,
    investorsFetched: fetched,
    positionRows: positionRows.length,
    errors,
  };
}
