# Deploy to a VPS with Docker + GitHub

This app ships with a `Dockerfile` and `docker-compose.yml`. You can deploy by **SSHing to the server** and running a script, or trigger a **GitHub Actions** workflow that SSHs in for you.

## What you need

- A VPS with **Docker Engine** and **`docker compose`** (Compose V2 plugin).
- The repo pushed to **GitHub**.
- A **`.env`** on the server (never commit real secrets). Copy from `.env.example` and fill values.

## One-time: prepare the server

1. **Install Docker** (if not already): follow [Docker’s docs](https://docs.docker.com/engine/install/) for your OS (Ubuntu is common on VPS hosts).

2. **Allow your user to run Docker** (recommended):

   ```bash
   sudo usermod -aG docker "$USER"
   ```

   Log out and back in (or `newgrp docker`), then `docker compose version` should work **without** `sudo`.

3. **Clone the repo** (pick a path and stick to it — it must match `VPS_DEPLOY_PATH` if you use Actions):

   ```bash
   sudo mkdir -p /opt/stock-screener
   sudo chown "$USER:$USER" /opt/stock-screener
   cd /opt/stock-screener
   git clone https://github.com/YOUR_ORG/stock-screener.git .
   ```

   For a **private** repo, use SSH clone or a [personal access token](https://github.com/settings/tokens) with HTTPS.

4. **Environment file**

   ```bash
   cp .env.example .env
   nano .env
   ```

5. **Firewall** (if you use `ufw`):

   ```bash
   sudo ufw allow OpenSSH
   sudo ufw allow 3001/tcp   # or only 80/443 if you reverse-proxy to 3001
   sudo ufw enable
   ```

6. **First deploy** from the repo root:

   ```bash
   ./scripts/vps-deploy.sh
   ```

   The app listens on **port 3001** inside the container (mapped to the host). Check: `curl -I http://127.0.0.1:3001/`

For HTTPS and a domain, put **Caddy** or **nginx** in front and proxy to `127.0.0.1:3001`.

## Deploy from your laptop (manual)

After you `git push`:

```bash
ssh your-user@your-server
cd /opt/stock-screener   # your clone path
./scripts/vps-deploy.sh
```

`--no-git` skips `git pull` if you only want to rebuild:

```bash
./scripts/vps-deploy.sh --no-git
```

## Deploy via GitHub Actions (push a button)

1. On the server, complete the **one-time** steps above so the clone exists and `./scripts/vps-deploy.sh` works when you SSH in manually.

2. **SSH key for GitHub → VPS** (deploy key style):

   - On your **laptop**, generate a key used only for this deploy (no passphrase is easier for Actions; protect the repo secrets instead):

     ```bash
     ssh-keygen -t ed25519 -f ./github-deploy-vps -C "github-actions-stock-screener"
     ```

   - Append **`github-deploy-vps.pub`** to the server user’s `~/.ssh/authorized_keys`:

     ```bash
     ssh your-user@your-server "mkdir -p ~/.ssh && chmod 700 ~/.ssh"
     cat github-deploy-vps.pub | ssh your-user@your-server "cat >> ~/.ssh/authorized_keys"
     ```

   - Test: `ssh -i github-deploy-vps your-user@your-server` should log in without a password.

3. In GitHub: **Repository → Settings → Secrets and variables → Actions → New repository secret**

   | Name | Value |
   |------|--------|
   | `VPS_HOST` | Server hostname or IP |
   | `VPS_USER` | SSH login name |
   | `VPS_SSH_KEY` | **Full** contents of **`github-deploy-vps`** (private key), including `BEGIN`/`END` lines |
   | `VPS_DEPLOY_PATH` | Absolute path to the clone, e.g. `/opt/stock-screener` |

   Optional:

   | Name | Value |
   |------|--------|
   | `VPS_DOCKER_USE_SUDO` | `true` only if that user **must** use `sudo docker compose` (prefer `docker` group instead) |

4. **Run the workflow:** **Actions → Deploy to VPS → Run workflow** (choose branch, usually `main`).

The workflow runs `git pull` on the server and `docker compose up -d --build`. First build can take several minutes.

## Troubleshooting

| Issue | What to try |
|--------|-------------|
| Actions: SSH fails | Check `VPS_HOST`, user, port 22 open, key pasted with newlines intact |
| Actions: timeout during build | VPS or network slow; workflow allows 30m for the remote command |
| `docker: permission denied` | Add user to `docker` group, or set `VPS_DOCKER_USE_SUDO` to `true` |
| `git pull` fails | Resolve conflicts locally; server should track `main` with no local edits |
| App not reachable from browser | Open firewall for 3001 or use a reverse proxy; check `docker compose ps` and logs |

## Files involved

- `Dockerfile` — production image (Node 20, Vite build, `node server/index.js`)
- `docker-compose.yml` — service, port `3001:3001`, loads `.env`
- `scripts/vps-deploy.sh` — pull + build + health check on the server
- `.github/workflows/deploy-vps.yml` — SSH deploy from GitHub Actions
