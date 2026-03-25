# Hostinger VPS + Supabase (Docker)

**Supabase** = hosted Postgres + API (use your plan; Pro is common for production workloads).  
**Hostinger VPS** = Docker runs this app: **static UI + `/api/*`** in one container, long scans without serverless timeouts.

The browser talks to **same origin** (`/api/...`). Do **not** set `VITE_API_URL` for this setup.

---

## Typical wiring

| Piece | Role |
|--------|------|
| **Supabase** | Primary persistence when `SUPABASE_URL` + **`SUPABASE_SERVICE_KEY`** are set (scan runs, results, bars cache, etc.). RLS is enabled on app tables; the **anon** key cannot access that data via the Supabase API. |
| **Docker on VPS** | `stock-screener` container: Express + `dist/` SPA on port **3000** → mapped to **`HOST_PORT`** (default **8080**). |
| **Volume `screener-data`** | `/app/data` for JSON/bar file cache and fallbacks. |

### Env inside the container

Set in **`.env`** on the server (never commit):

- **`SUPABASE_URL`** — project URL  
- **`SUPABASE_SERVICE_KEY`** — **required** service role key for this app. It bypasses RLS so scans and cache writes work. The **anon** key is not sufficient: all `public` tables use RLS with no anon policies (see `docs/supabase/migration-rls-and-api-hardening.sql`). To use anon from a client you would need to add explicit RLS policies yourself.
- **`CRON_SECRET`** — long random string; required in **production** for `POST /api/cron/scan` and `POST /api/cron/run-scan` to work at all (unauthenticated cron is disabled when `NODE_ENV=production`).
- **`TRAEFIK_HOST`** — hostname in Traefik’s `Host(\`name\`)` router rule (TLS via Let’s Encrypt). **DNS must point at the VPS.**
- **`HOST_PORT`** — host port mapped to container **3000** (default `8080`). Use a **free** port if **3001** / **8080** are already used (e.g. by other stacks on the same VPS).

Optional:

- **`SCHEDULE_SCAN=1`** — in-process “every 24h” scan while the Node process runs. **Do not** enable this **and** an external scheduler (below) unless you want overlapping schedules; the server still **skips** if a scan is already running or within cooldown, but you can get unnecessary back-to-back triggers.

---

## Scheduled scans (pick one primary)

### A) VPS host cron → `localhost` (simplest to debug)

No public URL required. TLS not used on loopback.

1. Set **`CRON_SECRET`** in the app `.env` (same value the cron job will send).
2. On the host, install a cron entry (see **`deploy/host-cron.example`** — **weekdays only**: **4:38 PM** bars refresh and **5:12 PM** scan in **America/Chicago**).
3. Use **`scripts/trigger-scheduled-refresh-bars.sh`** then **`scripts/trigger-scheduled-scan.sh`** with env:
   - **`CRON_SECRET`**
   - **`CRON_BASE_URL`** = `http://127.0.0.1:PORT` where `PORT` is your **`HOST_PORT`** (e.g. `8080`).

Scheduled endpoints (same auth as scan): **`POST /api/cron/refresh-bars`** (alias **`/api/cron/fetch-prices`**) warms **`bars_cache`** for the scan universe; **`POST /api/cron/run-scan`** runs the full scan.

**`GET /api/cron/status`** (no auth) returns whether **`CRON_SECRET`** is set, resolved **`CRON_BASE_URL`** / **`HOST_PORT`**, and the `.env` file path — it never returns the secret.

### Verify over SSH (bars refresh → Yahoo → `bars_cache`)

From your laptop, SSH to the VPS (optional: a **`Host`** alias in **`~/.ssh/config`** with **`HostName`** + **`User`** so you can run e.g. `ssh my-vps '…'`).

On the server, use the same **`HOST_PORT`** as in **`docker-compose`** (published map to container **3000**; default **8080**, or another free port such as **8090**):

```bash
# 1) Cron entries calling the trigger scripts (paths vary: /opt/... or /root/.../stock-screener)
sudo grep -R "refresh-bars\|fetch-prices\|trigger-scheduled" /etc/cron.d /etc/crontab /var/spool/cron 2>/dev/null
sudo cat /etc/cron.d/stock-screener 2>/dev/null

# 2) App hints — secret set, loopback URL the scripts should use
curl -sS "http://127.0.0.1:${HOST_PORT:-8080}/api/cron/status"

# 3) After a weekday cron run, this log should show JSON from curl (e.g. "Universe bars refresh started", scan "started")
sudo tail -50 /var/log/stock-screener-cron.log

# 4) Optional: when the background job finishes, stdout may include "Cron bars refresh finished"
docker logs stock-screener 2>&1 | grep -i "Cron bars refresh" | tail -30

# 5) One-shot manual test (CRON_SECRET must match container .env)
# curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" \
#   "http://127.0.0.1:${HOST_PORT:-8080}/api/cron/fetch-prices"
```

**Working production shape:** `/etc/cron.d/stock-screener` with **`CRON_TZ=America/Chicago`**, weekdays **16:38** → **`trigger-scheduled-refresh-bars.sh`**, **17:12** → **`trigger-scheduled-scan.sh`**, each line loading **`CRON_SECRET`** + **`CRON_BASE_URL`** via **`.cron-env`** *or* **`bash -lc 'set -a; source /path/to/stock-screener/.env; set +a; exec …/trigger-….sh'`**.

If (1) shows no lines, install from **`deploy/host-cron.example`**, **`chmod +x`** both trigger scripts, and align **`CRON_BASE_URL`** with **`HOST_PORT`**.

```bash
chmod +x scripts/trigger-scheduled-scan.sh
# root-only file, e.g. /opt/stock-screener/.cron-env
#   export CRON_SECRET='...'
#   export CRON_BASE_URL='http://127.0.0.1:8080'
```

### B) Supabase `pg_cron` + `pg_net` (or DB Webhook)

Single dashboard for “when did this fire.” Use **HTTPS** and the **same** `CRON_SECRET`.

- **URL:** `POST https://your-domain.com/api/cron/run-scan`  
  (alias: `/api/cron/scan`)
- **Header:** `Authorization: Bearer <CRON_SECRET>`  
  or **`x-cron-secret: <CRON_SECRET>`**

Store the secret only in Supabase vault / job config, not in the repo.

**Do not** run A and B on the same schedule unless you intend redundant triggers; rely on server-side skip logic and spacing.

---

## Operational notes

- **TLS:** Public schedulers should hit **`https://`** and validate certificates. Internal host cron can use **`127.0.0.1`** without TLS.
- **Idempotency:** If a scan runs longer than the cron interval, the next call gets **202** with `Scan already in progress` or a cooldown skip — no parallel full scans from this lock.
- **Secrets:** `CRON_SECRET` and Supabase keys live in **VPS `.env`** (and Supabase job config), not git.

---

## 1. VPS prerequisites

- Ubuntu 22.04+ (or similar) with SSH  
- Docker Engine + Compose plugin:

```bash
sudo apt update && sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update && sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker "$USER"
# log out and back in
```

---

## 2. App on the server

```bash
git clone https://github.com/YOUR_USER/stock-screener.git
cd stock-screener
cp .env.example .env
nano .env   # SUPABASE_*, CRON_SECRET (for any scheduled trigger), etc.
```

```bash
docker compose up -d --build
curl -s "http://127.0.0.1:${HOST_PORT:-8080}/api/health"
# Manual scan trigger (requires CRON_SECRET in production):
curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer YOUR_CRON_SECRET" \
  "http://127.0.0.1:${HOST_PORT:-8080}/api/cron/run-scan"
```

---

## 3. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 8080/tcp   # or 80/443 if you proxy
sudo ufw enable
```

---

## 4. HTTPS + domain (for users and Supabase HTTP triggers)

### Hostinger VPS with Traefik (Docker provider)

When Traefik already handles **80/443** with **`letsencrypt`** and **`exposedbydefault=false`**:

1. Set **`TRAEFIK_HOST`** in `.env` (DNS **A** record → this VPS).
2. `docker compose` applies **labels** on `stock-screener` (`websecure`, `certresolver=letsencrypt`).
3. Smoke test on the server:

   ```bash
   curl -sk https://127.0.0.1/api/health -H "Host: $TRAEFIK_HOST"
   ```

   Expect `{"ok":true,...}`.

Keep **`HOST_PORT`** (e.g. **8090**) for **localhost** and **`CRON_BASE_URL`** in `scripts/trigger-scheduled-scan.sh`.

### Without Traefik: Caddy or Nginx

Point DNS **A** record to the VPS. Reverse-proxy to `127.0.0.1:HOST_PORT`.

Example **Caddy**:

```text
yourdomain.com {
  reverse_proxy 127.0.0.1:8080
}
```

---

## 5. Updates

### A) Classic: git + rebuild on the VPS

```bash
cd stock-screener
git pull
docker compose up -d --build
```

### B) GHCR image + Watchtower (GitHub is source of truth)

Flow: **GitHub Actions** builds and pushes **`ghcr.io/<owner>/<repo>:latest`** with **`GIT_COMMIT=<sha>`** in the image. The app compares that env to GitHub’s default branch and shows **“New on GitHub”** when they differ. **Watchtower** (optional Compose profile) polls the registry and recreates the labeled container when the digest changes.

1. **Workflow:** `.github/workflows/docker-publish.yml` — runs on **`workflow_dispatch`** and on **`push` to `main`** (filtered paths). Ensure **Actions** and **Packages** are enabled for the repo.
2. **PAT on the VPS** (server-side only; never in the browser bundle):
   - **`GITHUB_REPO`** = `owner/repo`
   - **`GITHUB_TOKEN`** = classic PAT with **`repo`** (or fine-grained: **Contents: Read**, **Actions: Write**) so the server can call the Actions dispatch API.
   - **`GITHUB_DEFAULT_BRANCH`** = `main` (or your default)
3. **Trigger auth:** **`DEPLOY_SECRET`** (recommended) or reuse **`CRON_SECRET`**. The production UI asks for this once when you click **Build & deploy**; it is sent as **`Authorization: Bearer …`**.
4. **Image on the VPS:** set **`DEPLOY_IMAGE=ghcr.io/<owner>/<repo>:latest`** in `.env` and use the override file:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.ghcr.override.yml pull
   docker compose -f docker-compose.yml -f docker-compose.ghcr.override.yml up -d
   ```

   If Compose still insists on a local **`build:`**, delete that block on the server-only compose copy or maintain a tiny prod compose that only sets **`image`** + **`pull_policy: always`**. Private GHCR packages require **`docker login ghcr.io`** on the host (or a pull secret).

5. **Watchtower (optional):**

   ```bash
   docker compose --profile watchtower up -d
   ```

   Only containers with label **`com.centurylinklabs.watchtower.enable=true`** are updated (already set on **`stock-screener`** in this repo).

---

## 6. Data

- **Supabase:** primary when configured.  
- **Volume `screener-data`:** Docker named volume → `/app/data` in the container.

```bash
docker volume inspect stock-screener_screener-data
```

### Scan shows VCP / MAs but RS, Signal Agent, Lance, Opus are blank

Usually **short `bars_cache` history**: VCP needs ~60 daily bars; IBD-style RS needs **253+** trading days in the slice. Old caches (e.g. ~6 months) satisfied the first but not the second.

**Fix in app:** scans ignore short cache for long windows; **`getCachedBars` also drops poisoned in-memory entries** so a stale short slice is not reused for ~24h. Refetch repopulates Supabase.

**On the VPS after deploy:** run **Run Scan** again (expect more Yahoo traffic on the first run). Optional one-off: set **`SCAN_SKIP_CACHE=1`** in the container env, run a scan, then remove it so normal caching resumes.

**If `git pull` fails** with “local changes would be overwritten”: your server copy has edited tracked files (`Dockerfile`, `server/index.js`, etc.). Stash or commit them, then pull, then **`docker compose build --no-cache`** once so the image is not stuck on old `COPY` layers.

**Verify API (on the VPS):** after a full scan, `curl -sS 'http://127.0.0.1:8080/api/scan-results?cb=1' | head -c 2000` — the first `results` entry should include **`relativeStrength`** (a number) and **`signalSetups`** (array), not only `lastClose` / `pattern`.

**Verify in Supabase (SQL):** for a ticker that looked broken, `jsonb_array_length(results)` on `bars_cache` for `interval = '1d'` should be **≥ 253** after a full fetch.
