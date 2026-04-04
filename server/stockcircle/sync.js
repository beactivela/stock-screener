/**
 * Full StockCircle sync: best investors (performance filter) → portfolio pages → Supabase.
 */
import { getSupabase } from '../supabase.js';
import { parseBestInvestorsFromHtml, filterByMinPerformance } from './parseBestInvestors.js';
import { fetchBestInvestorsHtml, fetchAllPortfolioPages } from './fetchPages.js';
import { dedupeParsedPositionsByTicker } from './dedupeExperts.js';

const BATCH = 300;

/** Enough top performers for ticker overlap (same symbol bought/sold by multiple experts). */
const DEFAULT_OVERLAP_INVESTORS = 40;
/** Deep enough per portfolio to catch names beyond page 1 without multi-hour full scrapes. */
const DEFAULT_OVERLAP_PAGES = 30;
const FULL_SYNC_MAX_PAGES = 500;

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
  const delayPages = opts.delayBetweenPortfolioPagesMs ?? 400;

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

  for (const inv of selected) {
    try {
      const positions = await fetchAllPortfolioPages(inv.slug, {
        delayMs: delayPages,
        maxPages: Number.isFinite(maxPortfolioPages) && maxPortfolioPages > 0 ? maxPortfolioPages : 500,
      });
      fetched += 1;

      await supabase.from('stockcircle_investors').upsert(
        {
          slug: inv.slug,
          display_name: inv.displayName,
          firm_name: inv.firmName,
          performance_1y_pct: inv.performance1yPct,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'slug' }
      );

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
    } catch (e) {
      errors.push({ slug: inv.slug, message: e.message });
    }

    await new Promise((r) => setTimeout(r, delayPf));
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
