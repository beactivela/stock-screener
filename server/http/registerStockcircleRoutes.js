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
import { buildStockcircleSummaryPayload } from '../stockcircle/buildSummaryPayload.js';
import { selectInvestorBySlug, selectInvestorsBySlugs } from '../stockcircle/selectInvestors.js';
import { sendJson } from './sendJson.js';

let stockcircleJob = { running: false, lastResult: null, lastStartedAt: null, lastFinishedAt: null };

export function registerStockcircleRoutes(app) {
  app.get('/api/stockcircle/summary', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'private, max-age=60, stale-while-revalidate=120');
      const payload = await buildStockcircleSummaryPayload();
      const status = payload.ok ? 200 : 503;
      sendJson(res, status, payload);
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === 'object' && e !== null && 'message' in e
            ? String(e.message)
            : String(e);
      sendJson(res, 500, { ok: false, error: msg || 'Summary failed' });
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

      const { data: investor, error: invErr } = await selectInvestorBySlug(supabase, slug);

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
        const { data: invs, error: invListErr } = await selectInvestorsBySlugs(supabase, slugs);
        if (invListErr) throw invListErr;
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
