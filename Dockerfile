# syntax=docker/dockerfile:1
# Hostinger VPS / any Docker host: Express + Vite dist, NODE_ENV=production.
# Point SUPABASE_* + CRON_SECRET at runtime via docker-compose env_file (.env on the VPS).
# UI + API same origin — do not set VITE_API_URL for this image.
# One `npm ci`, then npm prune — avoids a second install in the final stage.
FROM node:22-bookworm-slim AS builder
WORKDIR /app

ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=$GIT_COMMIT

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runner
WORKDIR /app

ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=$GIT_COMMIT
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/dist ./dist
COPY server ./server
COPY docker-entrypoint.sh ./docker-entrypoint.sh

# TradingAgents (Python): same layout as local `npm run install:tradingagents` — venv at /app/.venv-tradingagents
# Build context must include submodule: `git submodule update --init --recursive` before `docker compose build`.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    python3-pip \
    build-essential \
  && rm -rf /var/lib/apt/lists/*

COPY vendor/TradingAgents ./vendor/TradingAgents
COPY scripts/tradingagents ./scripts/tradingagents
COPY requirements-tradingagents.txt ./requirements-tradingagents.txt

RUN test -f vendor/TradingAgents/pyproject.toml || (echo "ERROR: vendor/TradingAgents missing. Run: git submodule update --init --recursive" >&2; exit 1) \
  && python3 -m venv .venv-tradingagents \
  && .venv-tradingagents/bin/pip install --no-cache-dir --upgrade pip setuptools wheel \
  && .venv-tradingagents/bin/pip install --no-cache-dir -r requirements-tradingagents.txt

RUN mkdir -p data/bars eval_results \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 999 --gid nodejs nodejs \
  && chmod +x /app/docker-entrypoint.sh \
  && chown -R nodejs:nodejs /app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server/index.js"]
