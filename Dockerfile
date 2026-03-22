# syntax=docker/dockerfile:1
# Hostinger VPS / any Docker host: Express + Vite dist, NODE_ENV=production.
# Point SUPABASE_* + CRON_SECRET at runtime via docker-compose env_file (.env on the VPS).
# UI + API same origin — do not set VITE_API_URL for this image.
# One `npm ci`, then npm prune — avoids a second install in the final stage.
FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/dist ./dist
COPY server ./server

RUN mkdir -p data/bars \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 999 --gid nodejs nodejs \
  && chown -R nodejs:nodejs /app

USER nodejs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
