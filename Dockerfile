# syntax=docker/dockerfile:1
# =============================================================================
# opshub — Production Dockerfile (multi-target)
# =============================================================================
# Targets:
#   api       → HTTP API server          (default)
#   worker    → Background job processor
#   migrator  → One-shot Drizzle migration runner (CI gate job)
#
# Build:
#   docker build --target api      -t opshub-api:latest .
#   docker build --target worker   -t opshub-worker:latest .
#   docker build --target migrator -t opshub-migrator:latest .
# =============================================================================

ARG NODE_VERSION=22
ARG ALPINE_VERSION=3.21
ARG PNPM_VERSION=10.33.2

# ── deps: all packages (dev+prod) for the builder ────────────────────────────
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS deps
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm config set store-dir /root/.local/share/pnpm/store && \
    HUSKY=0 pnpm install --frozen-lockfile

# ── prod-deps: production-only node_modules for runtime images ────────────────
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS prod-deps
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm config set store-dir /root/.local/share/pnpm/store && \
    pnpm install --frozen-lockfile --prod --ignore-scripts

# ── builder: compile the NestJS monorepo ─────────────────────────────────────
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS builder
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build:api
RUN pnpm build:worker

# ── api (default) ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS api
RUN apk upgrade --no-cache && apk add --no-cache tini && rm -rf /var/cache/apk/*
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=512"
ENV PORT=3000
ENV HOST=0.0.0.0
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist/apps/api ./dist/apps/api
COPY --from=builder /app/package.json ./
RUN addgroup --system --gid 1001 nodejs \
    && adduser  --system --uid 1001 nestjs \
    && chown -R nestjs:nodejs /app
USER nestjs
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/apps/api/apps/api/src/main.js"]
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget -qO- http://localhost:${PORT}/healthz || exit 1

# ── worker ────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS worker
RUN apk upgrade --no-cache && apk add --no-cache tini && rm -rf /var/cache/apk/*
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=256"
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder   /app/dist/apps/worker ./dist/apps/worker
COPY --from=builder   /app/package.json ./
RUN addgroup --system --gid 1001 nodejs \
    && adduser  --system --uid 1001 nestjs \
    && chown -R nestjs:nodejs /app
USER nestjs
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/apps/worker/apps/worker/src/main.js"]

# ── migrator (one-shot Drizzle migration runner) ─────────────────────────────
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS migrator
RUN apk upgrade --no-cache && apk add --no-cache tini && rm -rf /var/cache/apk/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/db ./db
COPY --from=builder /app/package.json ./
RUN addgroup --system --gid 1001 nodejs \
    && adduser  --system --uid 1001 migrator \
    && chown -R migrator:nodejs /app
USER migrator
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node_modules/.bin/tsx", "db/migrate.ts"]
