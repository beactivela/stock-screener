# Deploy stock-screener to Hostinger VPS with Docker

## One-time setup on the VPS

1. **SSH into your Hostinger VPS** (use the IP and user from Hostinger panel):
   ```bash
   ssh root@YOUR_VPS_IP
   # or: ssh u123456789@YOUR_VPS_IP  (if Hostinger gave you a user)
   ```

2. **Install Docker** (if not already installed):
   ```bash
   curl -fsSL https://get.docker.com | sh
   # Optional: install Docker Compose v2 (often bundled as `docker compose`)
   ```

3. **Create app directory and clone repo** (or you’ll push code from your machine; see “Push from your machine” below):
   ```bash
   mkdir -p /var/www/stock-screener
   cd /var/www/stock-screener
   git clone https://github.com/YOUR_USER/stock-screener.git .
   ```

4. **Create `.env` on the VPS** (copy from `.env.example` and fill in secrets):
   ```bash
   cp .env.example .env
   nano .env   # set SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY, etc.
   ```

## Deploy / update (on the VPS)

From `/var/www/stock-screener`:

```bash
# Pull latest code (if you deploy via git)
git pull

# Build and run with Docker Compose
docker compose build --no-cache
docker compose up -d

# Check logs
docker compose logs -f
```

App will be at **http://YOUR_VPS_IP:3001**. Open port **3001** in Hostinger’s firewall if needed.

## Push from your machine (alternative to git pull on VPS)

From your **local** repo (Mac/Linux):

1. Set your VPS host in a variable (or add to `~/.ssh/config`):
   ```bash
   export VPS="root@YOUR_VPS_IP"
   ```

2. Sync code and run Docker on the VPS:
   ```bash
   ./scripts/deploy-hostinger.sh
   ```

The script uses `rsync` to copy the repo (excluding `node_modules`, `.git`, etc.) and runs `docker compose up -d --build` on the VPS. Create `.env` on the VPS once (step 4 above); the script does not overwrite `.env`.

## Env vars the app expects (see `.env.example`)

- **Supabase (recommended on VPS):** `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- **Optional:** `ANTHROPIC_API_KEY`, `CRON_SECRET`, `SCHEDULE_SCAN=1`, `PORT=3001`

## Useful commands on VPS

```bash
# Restart after changing .env
docker compose up -d

# Rebuild after code changes
docker compose up -d --build

# Stop
docker compose down

# Logs
docker compose logs -f app
```

## Reverse proxy (optional, for HTTPS and port 80)

To serve on port 80/443 with HTTPS, put Nginx or Caddy on the VPS and proxy to `localhost:3001`. Example with Caddy:

```bash
# Install Caddy, then Caddyfile:
# yourdomain.com { reverse_proxy localhost:3001 }
```

Then point your domain’s A record to the VPS IP.
