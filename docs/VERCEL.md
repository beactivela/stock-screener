# Vercel deployment

## Required environment variables

Set these in **Vercel → Project → Settings → Environment Variables** (Production and Preview if you use both):

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL (e.g. `https://xxxx.supabase.co`) |
| `SUPABASE_SERVICE_KEY` | **Service role** key from Supabase → Project Settings → API (required; bypasses RLS) |

Without these, the API cannot read or write data (scan results, tickers, bars, fundamentals, etc.). **Redeploy after adding or changing env vars.**

**Do not use the anon (publishable) key for the server.** The database uses Row Level Security on `public` tables with no policies for anon/authenticated clients, so PostgREST access with anon is denied. The Node API must use the service role. New projects: run `docs/supabase/migration-rls-and-api-hardening.sql` after schema setup ([supabase/README.md](./supabase/README.md)).

## API and Supabase compatibility

- **API routing:** The app uses specific handlers (`api/scan-results.js`, `api/scan.js`, `api/fundamentals.js`, `api/industry-trend.js`, `api/scan/progress.js`) and a catch-all `api/[[...path]].js` so all `/api/*` routes hit the same Express app with the same env.
- **Supabase:** All persistent data (tickers, scan results, bars cache, fundamentals, backtest snapshots, regime, trades, Opus45 cache) is read from/written to Supabase when `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are set. No `.env` file is deployed; Vercel injects these at runtime.
- **Writes on Vercel:** POST requests (e.g. Run Scan, fundamentals fetch) are allowed only when Supabase is configured; otherwise the API returns 503 with a message to set the env vars.
- **Read-only limits:** Industry data collection (`POST /api/industry-data/collect`) writes to disk and is disabled on Vercel (returns 503). Run it locally or point the frontend to an external API via `VITE_API_URL` if needed.

## Optional

- **`VITE_API_URL`:** If you run the API elsewhere (e.g. Railway), set this in Vercel env so the frontend calls that URL instead of same-origin `/api`. Leave empty to use the Vercel serverless API.
- **`CRON_SECRET`:** Required if you call `POST /api/cron/scan` from Supabase Cron or another scheduler; use a long random string and send it in the request (e.g. header or body) so the endpoint can verify the caller.
