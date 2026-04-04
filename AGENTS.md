# Agent memory (stock-screener)

Incremental notes from high-signal chat history. Authoritative project rules also live in Cursor rules and `frameworks.mdc`.

## Learned User Preferences

## Learned Workspace Facts

- Project conventions and stack notes for UI/planning work live in `frameworks.mdc` at the repo root (read it before assuming stack or workflow).
- StockCircle “expert holdings” work uses `server/stockcircle/` (HTML fetch/parse + unit tests/fixtures), Supabase DDL under `docs/supabase/` (e.g. `migration-stockcircle-experts.sql` and `migration-stockcircle-pct-of-portfolio.sql` for `pct_of_portfolio` on positions), read-only JSON routes in `server/http/registerStockcircleRoutes.js` (`/api/stockcircle/...`), a cron-protected sync route using shared `server/http/cronSecretAuth.js`, and an optional React page plus `scripts/run-stockcircle-sync.js` for manual runs.
- Drawdown-reversal research tooling lives in `server/drawdownReversalStudy.js` with CLI entry `scripts/run-drawdown-reversal-study.js`; artifacts and write-ups live under `docs/research/`.
- The bundled Traefik setup in `docker-compose.yml` expects `TRAEFIK_HOST` and `ACME_EMAIL` in the **project** `.env` so Compose can interpolate router labels; the `traefik.docker.network=stock-screener-net` label pins the backend; public HTTPS and ACME need host ports 80 and 443 reachable (not only the app’s published `HOST_PORT`).
