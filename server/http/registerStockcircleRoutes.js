/**
 * StockCircle expert sync: read APIs + cron trigger.
 */
import { validateCronSecret } from './cronSecretAuth.js';
import { getSupabase } from '../supabase.js';
import { runStockcircleSync } from '../stockcircle/sync.js';
import {
  fetchMetaDescription,
  stockcirclePerformanceUrl,
  stockcirclePortfolioUrl,
} from '../stockcircle/stockcircleMeta.js';
import { STOCKCIRCLE_BASE } from '../stockcircle/fetchPages.js';
import { dedupeDbRowsForExpertColumn } from '../stockcircle/dedupeExperts.js';

let stockcircleJob = { running: false, lastResult: null, lastStartedAt: null, lastFinishedAt: null };

/** PostgREST caps unfiltered selects (~1000 rows). Chunk `.in('ticker', …)` to load weights for all popular symbols. */
const TICKER_IN_CHUNK = 120;

export function registerStockcircleRoutes(app) {
  app.get('/api/stockcircle/summary', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'private, max-age=60, stale-while-revalidate=120');
      const supabase = getSupabase();
      if (!supabase) {
        return res.status(503).json({ ok: false, error: 'Supabase not configured' });
      }

      const { data: runs, error: runErr } = await supabase
        .from('stockcircle_sync_runs')
        .select('id, started_at, finished_at, status, investors_matched, investors_fetched, error_message')
        .eq('status', 'completed')
        .order('finished_at', { ascending: false, nullsFirst: false })
        .limit(1);

      if (runErr) throw runErr;
      const latestRun = runs?.[0] ?? null;

      const { data: popular, error: popErr } = await supabase
        .from('v_stockcircle_ticker_popularity')
        .select('ticker, buying_firms, selling_firms')
        .order('buying_firms', { ascending: false })
        .limit(500);

      if (popErr) throw popErr;

      /** @type {Record<string, Array<Record<string, unknown>>>} */
      let expertWeightsByTicker = {};

      if (latestRun?.id && popular?.length) {
        const tickersUpper = [
          ...new Set(popular.map((p) => String(p.ticker || '').trim().toUpperCase()).filter(Boolean)),
        ];
        const allPos = [];
        for (let i = 0; i < tickersUpper.length; i += TICKER_IN_CHUNK) {
          const chunk = tickersUpper.slice(i, i + TICKER_IN_CHUNK);
          const { data: part, error: posErr } = await supabase
            .from('stockcircle_positions')
            .select(
              'ticker, investor_slug, pct_of_portfolio, position_value_usd, action_type, action_pct, company_name'
            )
            .eq('sync_run_id', latestRun.id)
            .in('ticker', chunk);
          if (posErr) throw posErr;
          allPos.push(...(part || []));
        }

        const slugs = [...new Set(allPos.map((p) => p.investor_slug))];
        const { data: invRows } = await supabase
          .from('stockcircle_investors')
          .select('slug, display_name, firm_name, performance_1y_pct')
          .in('slug', slugs);

        const invBySlug = Object.fromEntries((invRows || []).map((i) => [i.slug, i]));

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
              pctOfPortfolio: p.pct_of_portfolio,
              positionValueUsd: p.position_value_usd,
              actionType: p.action_type,
              actionPct: p.action_pct,
              companyName: p.company_name,
            };
          });
        }
      }

      res.json({
        ok: true,
        latestRun,
        popular: popular ?? [],
        expertWeightsByTicker,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/stockcircle/investor/:slug', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'private, max-age=120, stale-while-revalidate=300');
      const slug = String(req.params.slug || '')
        .trim()
        .toLowerCase();
      if (!/^[a-z0-9-]+$/.test(slug)) {
        return res.status(400).json({ ok: false, error: 'Invalid slug' });
      }

      const supabase = getSupabase();
      if (!supabase) {
        return res.status(503).json({ ok: false, error: 'Supabase not configured' });
      }

      const { data: investor, error: invErr } = await supabase
        .from('stockcircle_investors')
        .select('slug, display_name, firm_name, performance_1y_pct, updated_at')
        .eq('slug', slug)
        .maybeSingle();

      if (invErr) throw invErr;
      if (!investor) {
        return res.status(404).json({ ok: false, error: 'Expert not found — run a StockCircle sync first' });
      }

      const { data: positions, error: posErr } = await supabase
        .from('v_stockcircle_positions_latest')
        .select(
          'ticker, company_name, pct_of_portfolio, position_value_usd, action_type, action_pct, quarter_label, shares_held, shares_raw, raw_last_transaction'
        )
        .eq('investor_slug', slug)
        .order('pct_of_portfolio', { ascending: false, nullsFirst: false });

      if (posErr) throw posErr;

      const [aboutBlurb, performanceBlurb] = await Promise.all([
        fetchMetaDescription(stockcirclePortfolioUrl(slug)),
        fetchMetaDescription(stockcirclePerformanceUrl(slug)),
      ]);

      res.json({
        ok: true,
        investor,
        positions: positions ?? [],
        links: {
          portfolio: stockcirclePortfolioUrl(slug),
          performance: stockcirclePerformanceUrl(slug),
          bestInvestors: `${STOCKCIRCLE_BASE}/best-investors`,
        },
        aboutBlurb,
        performanceBlurb,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/stockcircle/positions', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'private, max-age=60, stale-while-revalidate=120');
      const ticker = String(req.query.ticker || '')
        .trim()
        .toUpperCase();
      if (!ticker) {
        return res.status(400).json({ ok: false, error: 'Missing ticker query param' });
      }

      const supabase = getSupabase();
      if (!supabase) {
        return res.status(503).json({ ok: false, error: 'Supabase not configured' });
      }

      const { data, error } = await supabase
        .from('v_stockcircle_positions_latest')
        .select(
          'ticker, investor_slug, company_name, action_type, action_pct, quarter_label, shares_held, position_value_usd, pct_of_portfolio, raw_last_transaction'
        )
        .eq('ticker', ticker)
        .order('position_value_usd', { ascending: false, nullsFirst: false });

      if (error) throw error;

      const rows = data ?? [];
      const slugs = [...new Set(rows.map((r) => r.investor_slug))];
      let investors = {};
      if (slugs.length) {
        const { data: invs } = await supabase
          .from('stockcircle_investors')
          .select('slug, display_name, firm_name, performance_1y_pct')
          .in('slug', slugs);
        investors = Object.fromEntries((invs || []).map((i) => [i.slug, i]));
      }

      res.json({ ok: true, ticker, rows, investors });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/cron/stockcircle-sync', async (req, res) => {
    if (!validateCronSecret(req, res)) return;
    if (stockcircleJob.running) {
      return res.status(202).json({ ok: true, message: 'StockCircle sync already in progress' });
    }

    stockcircleJob.running = true;
    stockcircleJob.lastStartedAt = new Date().toISOString();
    stockcircleJob.lastResult = null;

    (async () => {
      try {
        const result = await runStockcircleSync();
        stockcircleJob.lastResult = result;
        console.log('StockCircle sync finished:', result);
      } catch (e) {
        console.error('StockCircle sync failed:', e);
        stockcircleJob.lastResult = { ok: false, error: e.message };
      } finally {
        stockcircleJob.running = false;
        stockcircleJob.lastFinishedAt = new Date().toISOString();
      }
    })();

    res.status(202).json({
      ok: true,
      started: true,
      message: 'StockCircle sync started in background',
    });
  });
}
