/**
 * WhaleWisdom filer sync: read APIs + cron trigger (parallel to StockCircle).
 */
import { validateCronSecret } from './cronSecretAuth.js';
import { getSupabase } from '../supabase.js';
import { runWhalewisdomSync } from '../whalewisdom/sync.js';
import { WHALEWISDOM_BASE } from '../whalewisdom/fetchPages.js';

let whalewisdomJob = { running: false, lastResult: null, lastStartedAt: null, lastFinishedAt: null };

const TICKER_IN_CHUNK = 120;

export function registerWhalewisdomRoutes(app) {
  app.get('/api/whalewisdom/summary', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'private, max-age=60, stale-while-revalidate=120');
      const supabase = getSupabase();
      if (!supabase) {
        return res.status(503).json({ ok: false, error: 'Supabase not configured' });
      }

      const { data: runs, error: runErr } = await supabase
        .from('whalewisdom_sync_runs')
        .select('id, started_at, finished_at, status, filers_matched, filers_fetched, error_message')
        .eq('status', 'completed')
        .order('finished_at', { ascending: false, nullsFirst: false })
        .limit(1);

      if (runErr) throw runErr;
      const latestRun = runs?.[0] ?? null;

      const { data: overlap, error: ovErr } = await supabase
        .from('v_whalewisdom_ticker_overlap')
        .select('ticker, filer_count')
        .order('filer_count', { ascending: false })
        .limit(500);

      if (ovErr) throw ovErr;

      /** @type {Record<string, Array<Record<string, unknown>>>} */
      let weightsByTicker = {};

      if (latestRun?.id && overlap?.length) {
        const tickersUpper = [
          ...new Set(overlap.map((p) => String(p.ticker || '').trim().toUpperCase()).filter(Boolean)),
        ];
        const allPos = [];
        for (let i = 0; i < tickersUpper.length; i += TICKER_IN_CHUNK) {
          const chunk = tickersUpper.slice(i, i + TICKER_IN_CHUNK);
          const { data: part, error: posErr } = await supabase
            .from('whalewisdom_positions')
            .select(
              'ticker, filer_slug, pct_of_portfolio, position_value_usd, action_type, company_name, security_type, quarter_label'
            )
            .eq('sync_run_id', latestRun.id)
            .in('ticker', chunk);
          if (posErr) throw posErr;
          allPos.push(...(part || []));
        }

        const slugs = [...new Set(allPos.map((p) => p.filer_slug))];
        const { data: filerRows } = await supabase
          .from('whalewisdom_filers')
          .select('slug, display_name, manager_name')
          .in('slug', slugs);

        const filerBySlug = Object.fromEntries((filerRows || []).map((f) => [f.slug, f]));

        const byTicker = new Map();
        for (const p of allPos) {
          const tk = String(p.ticker || '').trim().toUpperCase();
          if (!byTicker.has(tk)) byTicker.set(tk, []);
          byTicker.get(tk).push(p);
        }

        for (const [tk, plist] of byTicker) {
          weightsByTicker[tk] = plist.map((p) => {
            const frow = filerBySlug[p.filer_slug];
            return {
              filerSlug: p.filer_slug,
              firmName: frow?.display_name || p.filer_slug,
              managerName: frow?.manager_name ?? null,
              pctOfPortfolio: p.pct_of_portfolio,
              positionValueUsd: p.position_value_usd,
              actionType: p.action_type,
              companyName: p.company_name,
              securityType: p.security_type,
              quarterLabel: p.quarter_label,
            };
          });
        }
      }

      const { data: filerList } = await supabase.from('whalewisdom_filers').select('*').order('display_name');

      res.json({
        ok: true,
        latestRun,
        overlap: overlap ?? [],
        weightsByTicker,
        filers: filerList ?? [],
        sourceBaseUrl: WHALEWISDOM_BASE,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/whalewisdom/filer/:slug', async (req, res) => {
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

      const { data: filer, error: fErr } = await supabase
        .from('whalewisdom_filers')
        .select('slug, display_name, manager_name, ww_filer_id, whalewisdom_url, updated_at')
        .eq('slug', slug)
        .maybeSingle();

      if (fErr) throw fErr;
      if (!filer) {
        return res.status(404).json({ ok: false, error: 'Filer not found — run a WhaleWisdom sync first' });
      }

      const { data: positions, error: posErr } = await supabase
        .from('v_whalewisdom_positions_latest')
        .select(
          'ticker, company_name, pct_of_portfolio, position_value_usd, action_type, action_pct, quarter_label, shares_held, security_type, raw_snapshot'
        )
        .eq('filer_slug', slug)
        .order('pct_of_portfolio', { ascending: false, nullsFirst: false });

      if (posErr) throw posErr;

      res.json({
        ok: true,
        filer,
        positions: positions ?? [],
        links: {
          whalewisdom: filer.whalewisdom_url || `${WHALEWISDOM_BASE}/filer/${slug}`,
        },
        note:
          'Positions are parsed from WhaleWisdom’s server-rendered “top holdings” block. For the full 13F line-up, open WhaleWisdom or use their API.',
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/cron/whalewisdom-sync', async (req, res) => {
    if (!validateCronSecret(req, res)) return;
    if (whalewisdomJob.running) {
      return res.status(202).json({ ok: true, message: 'WhaleWisdom sync already in progress' });
    }

    whalewisdomJob.running = true;
    whalewisdomJob.lastStartedAt = new Date().toISOString();
    whalewisdomJob.lastResult = null;

    (async () => {
      try {
        const result = await runWhalewisdomSync();
        whalewisdomJob.lastResult = result;
        console.log('WhaleWisdom sync finished:', result);
      } catch (e) {
        console.error('WhaleWisdom sync failed:', e);
        whalewisdomJob.lastResult = { ok: false, error: e.message };
      } finally {
        whalewisdomJob.running = false;
        whalewisdomJob.lastFinishedAt = new Date().toISOString();
      }
    })();

    res.status(202).json({
      ok: true,
      started: true,
      message: 'WhaleWisdom sync started in background',
    });
  });
}
