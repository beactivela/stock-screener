# Supabase (Database)

All application data and cache are stored in Supabase. The app reads from and writes to the database; there is no file-based JSON storage for runtime data. This directory contains the schema and setup instructions.

## Quick start

1. **Supabase project** (e.g. `ksnneoomyrvmzukwxmqg`) at [supabase.com](https://supabase.com).

2. **Run the schema** — either:

   **Option A: npm script (recommended)**
   - Add to `.env`: `SUPABASE_DB_PASSWORD=your_database_password`  
     (Use this if your password has special chars like @ # : — the script encodes it correctly.)
   - Or full URI: `DATABASE_URL=postgresql://postgres:PASSWORD@db.ksnneoomyrvmzukwxmqg.supabase.co:5432/postgres`
   - Run: `npm run migrate:supabase`

   **Option B: SQL Editor**
   - Open project → SQL Editor → New query
   - Paste contents of `schema.sql` → Run
   - If you use learning / agents features, run `learning-schema.sql` and any other `migration-*.sql` files your deployment needs (see table below), **then** run `migration-rls-and-api-hardening.sql`.

3. **Add env vars** to `.env`:
   ```
   SUPABASE_URL=https://ksnneoomyrvmzukwxmqg.supabase.co
   SUPABASE_SERVICE_KEY=your_service_role_key
   ```
   Get these from Project Settings → API. Use **service_role** for full server-side access (bypasses RLS).

4. **Security (RLS)** — After schema is applied, run `migration-rls-and-api-hardening.sql` once (SQL Editor). That enables Row Level Security on all `public` tables and fixes `SECURITY DEFINER` views so the **anon** key cannot read your data. The Node server **must** use `SUPABASE_SERVICE_KEY` (not anon) or queries will return empty / fail.

5. **Test connection**:
   ```bash
   node -e "
   import('./server/supabase.js').then(m => {
     const sb = m.getSupabase();
     console.log('Supabase configured:', !!sb);
     if (sb) sb.from('tickers').select('count').then(r => console.log('Test:', r));
   });
   ```

## SQL migrations (reference)

| File | Purpose |
|------|---------|
| `schema.sql` | Core tables (tickers, scans, bars, regime, trades, …) |
| `learning-schema.sql` | Learning / failure-analysis tables (run after `schema.sql` if you use that stack) |
| `migration-rls-and-api-hardening.sql` | **Security:** enable RLS on all `public` tables, `security_invoker` views, fix `update_market_conditions` `search_path`. Run **once** per project after schema is in place. |
| `migration-options-backtest.sql` | Options backtest persistence tables; now enables RLS as part of creation |
| `migration-options-backtest-rls.sql` | One-time hardening patch for projects where options backtest tables were created before RLS was added |
| `migration-revoke-public-api-grants.sql` | Optional extra hardening: revoke default `anon`/`authenticated` grants on `public` tables, views, and functions when only `service_role` should access the API |
| Other `migration-*.sql` | Feature-specific deltas (Opus scores, WFO, archive, etc.) |

Idempotent patterns (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) are used where possible; the RLS migration is safe to re-run for **new tables only** if you repeat the `DO` block—see comments at the bottom of `migration-rls-and-api-hardening.sql`.

## Security notes & linter

- **[Database Linter](https://supabase.com/docs/guides/database/database-linter)** (Dashboard → Advisors): after hardening, you may see **INFO** [RLS enabled but no policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) on each table. That is expected: anon has no access until you add policies.
- For stricter least-privilege hardening, run `migration-revoke-public-api-grants.sql` to remove the default `anon` / `authenticated` grants entirely. That matches this app's server-only `service_role` access pattern.
- Never expose **`SUPABASE_SERVICE_KEY`** in the browser or in a public repo. The Vite app does not initialize Supabase; only the Node server uses the client in `server/supabase.js`.

## Schema overview (data in DB)

| Table | Purpose |
|-------|---------|
| `tickers` | Scan universe (one row per ticker) |
| `fundamentals` | Cached Yahoo fundamentals per ticker (cache in DB) |
| `scan_runs` + `scan_results` | Scan metadata + per-ticker results |
| `bars_cache` | OHLCV time series per ticker (cache in DB) |
| `opus45_signals_cache` | Cached Opus4.5 signal output (cache in DB) |
| `trades` | Trade journal |
| `trade_stats` | Denormalized trade stats |
| `industry_cache` | Industry caches (keyed); cache in DB |
| `industry_yahoo_returns` | Legacy (unused); industry returns now from TradingView API |
| `backtest_snapshots` | Historical scan snapshots |
| `backtest_results` | Forward return backtest results |
| `regime_bars` | Regime bar data |
| `regime_models`, `regime_current`, `regime_backtest` | HMM regime state |
| `opus45_weights` | Learned signal weights |
| `adaptive_strategy_params` | Strategy params |

All caches (bars, fundamentals, industry, opus45 signals, etc.) are persisted in these tables; nothing is stored in JSON files at runtime.

## Scheduled scan (Supabase Cron)

To run the full VCP scan **every 24 hours after 5 PM CST**, use Supabase’s Cron to call your API.

1. **Deploy your API** somewhere that can run the scan (e.g. Docker on a VPS per [DEPLOY_HOSTINGER_VPS.md](../DEPLOY_HOSTINGER_VPS.md), Railway, or Render). Note the public base URL (e.g. `https://screener.yourdomain.com`).

2. **Set a cron secret** in your app’s env (and in Supabase if you store it there):
   ```bash
   CRON_SECRET=your-random-secret-string
   ```

3. **Create the Cron job in Supabase**  
   Dashboard → **Integrations** → **Cron** → **Create a new job** (or [Cron Jobs](https://supabase.com/dashboard/project/_/integrations/cron/jobs)).

   - **Schedule:** 5 PM CST = **23:00 UTC** → cron expression: `0 23 * * *`  
     (CST is UTC-6; during CDT use the same 23:00 UTC for “after market close”.)
   - **Type:** HTTP request  
   - **URL:** `https://YOUR_API_BASE_URL/api/cron/scan`  
   - **Method:** POST  
   - **Headers:**  
     - `Content-Type: application/json`  
     - `Authorization: Bearer YOUR_CRON_SECRET`  
       (Use the same value as `CRON_SECRET` in your app.)

   If your Supabase project has **pg_net** enabled, you can instead define the job in SQL:

   ```sql
   select cron.schedule(
     'daily-scan-5pm-cst',
     '0 23 * * *',
     $$
     select net.http_post(
       url := 'https://YOUR_API_BASE_URL/api/cron/scan',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'Authorization', 'Bearer ' || current_setting('app.cron_secret', true)
       ),
       body := '{}',
       timeout_milliseconds := 10000
     ) as request_id;
     $$
   );
   ```
   (Store the secret in Vault or an `app.cron_secret` setting instead of hardcoding.)

4. **Auth:** In **production** (`NODE_ENV=production`, including Docker on a VPS), `CRON_SECRET` **must** be set or the cron endpoints return 503. In local development you may omit it to call `POST /api/cron/scan` or `POST /api/cron/run-scan` without auth (not recommended if the dev server is reachable on a network).

The `/api/cron/scan` endpoint returns **202 Accepted** immediately and runs the scan in the background so the Cron request does not time out.

### Option B: Edge Function (paste into Dashboard)

Use an Edge Function so the API URL and secret live only in Supabase secrets. Create the function in the Dashboard, then schedule it with Cron.

1. **Dashboard** → **Edge Functions** → **Create a new function** → name it `trigger-scan`.

2. **Set secrets** (Dashboard → Project Settings → Edge Functions → Secrets):
   - `SCAN_API_URL` = your API base URL, e.g. `https://your-app.railway.app` (no trailing slash)
   - `CRON_SECRET` = same value as `CRON_SECRET` in your app’s env

3. **Paste this code** as the function body (replace the default):

```ts
/**
 * Trigger daily VCP scan. Set secrets: SCAN_API_URL, CRON_SECRET
 */
const SCAN_API_URL = Deno.env.get("SCAN_API_URL");
const CRON_SECRET = Deno.env.get("CRON_SECRET");

Deno.serve(async (_req: Request) => {
  if (!SCAN_API_URL?.trim()) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "SCAN_API_URL not set. Add it in Edge Function secrets.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const base = SCAN_API_URL.replace(/\/$/, "");
  const url = `${base}/api/cron/scan`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CRON_SECRET ? { Authorization: `Bearer ${CRON_SECRET}` } : {}),
      },
      body: JSON.stringify({ triggeredAt: new Date().toISOString() }),
    });

    const status = res.status;
    let body: unknown;
    const text = await res.text();
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }

    return new Response(
      JSON.stringify({
        ok: status >= 200 && status < 400,
        status,
        apiResponse: body,
      }),
      {
        status: status >= 400 ? status : 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Failed to call scan API",
        detail: message,
      }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
});
```

4. **Deploy** the function (Dashboard or `supabase functions deploy trigger-scan`).

5. **Schedule it:** Dashboard → **Integrations** → **Cron** → **Create job**  
   - **Schedule:** `0 23 * * *` (5 PM CST = 23:00 UTC)  
   - **Type:** Supabase Edge Function  
   - **Function:** `trigger-scan`

The same code lives in `supabase/functions/trigger-scan/index.ts` in this repo.
