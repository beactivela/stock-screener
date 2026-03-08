# Multi-stage: build frontend + run Node in production.
# Your server serves API + static files from dist/ when NODE_ENV !== 'development'.

# --- Stage 1: build frontend and install all deps (needed for build) ---
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests so we can cache this layer
COPY package.json package-lock.json* ./

# Install all deps (including devDependencies for TypeScript + Vite build)
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# --- Stage 2: production image (no devDependencies, no source maps) ---
FROM node:20-alpine AS runner

WORKDIR /app

# Run as non-root
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Copy only what's needed to run
COPY --from=builder /app/package.json /app/package-lock.json* ./
COPY --from=builder /app/server ./server
COPY --from=builder /app/dist ./dist

# Production deps only (smaller image)
RUN npm ci --omit=dev && npm cache clean --force

USER nodejs

# Server reads PORT from env; default 3001
ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "server/index.js"]
