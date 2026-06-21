# Dockerfile for Routa.js Next.js web application
# Uses multi-stage build for a minimal production image.
# Standalone output bundles all required files into .next/standalone/.

FROM node:22-alpine AS base

# ── Stage 1: install dependencies ────────────────────────────────────────
FROM base AS deps

# native add-ons (better-sqlite3) need build tools
RUN apk add --no-cache libc6-compat python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/desktop/package.json ./apps/desktop/package.json
COPY packages/office-render/package.json ./packages/office-render/package.json
COPY scripts/install ./scripts/install
COPY tools/hook-runtime ./tools/hook-runtime
COPY patches ./patches
RUN npm ci --legacy-peer-deps \
  --fetch-retries=5 \
  --fetch-retry-mintimeout=20000 \
  --fetch-retry-maxtimeout=120000 \
  --fetch-timeout=300000

# ── Stage 2: database schema migrator ────────────────────────────────────
FROM base AS migrator
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

USER node

CMD ["npm", "run", "db:push"]

# ── Stage 3: build ───────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build in standalone mode and compile SQLite chunk modules for runtime use.
# `build:docker` sets ROUTA_DESKTOP_STANDALONE=1 (output: standalone) and then
# runs scripts/build-docker.mjs to esbuild the SQLite TS sources into the
# standalone chunks directory so ROUTA_DB_DRIVER=sqlite works at runtime.
RUN npm run build:docker

# ── Stage 4: production runner ────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
# Default to SQLite; override DATABASE_URL to use Postgres.
ENV ROUTA_DB_DRIVER=sqlite
ENV ROUTA_DB_PATH=/app/data/routa.db

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# git is required at runtime: the /api/clone route shells out to
# `git clone`/`git pull`/`git fetch` via execSync. ca-certificates is
# needed so git can verify TLS for https://github.com/... clone URLs.
# (openssh is intentionally omitted — only HTTPS clone URLs are used.)
RUN apk add --no-cache git ca-certificates

# Standalone server + static assets
COPY --from=builder /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Data directory for SQLite database
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
