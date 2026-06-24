# Loop API — multi-stage build (§15.2)
FROM node:20-alpine AS builder
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.4.0 --activate

# Copy workspace config first for layer caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/types/package.json packages/types/
COPY packages/observability/package.json packages/observability/
COPY packages/state/package.json packages/state/
COPY packages/secrets/package.json packages/secrets/
COPY packages/versioning/package.json packages/versioning/
COPY packages/connectors/package.json packages/connectors/
COPY packages/llm/package.json packages/llm/
COPY packages/egress/package.json packages/egress/
COPY packages/workflow-authoring/package.json packages/workflow-authoring/
COPY packages/engine/package.json packages/engine/
COPY packages/triggers/package.json packages/triggers/
COPY apps/api/package.json apps/api/
COPY apps/sandbox/package.json apps/sandbox/
COPY apps/control-plane/package.json apps/control-plane/

RUN pnpm install --frozen-lockfile || pnpm install

# Copy source
COPY tsconfig.base.json tsconfig.json ./
COPY packages/ packages/
COPY apps/ apps/

RUN pnpm build

# ─── Runtime ──────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
RUN apk add --no-cache git dumb-init
WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/types/dist ./packages/types/dist
COPY --from=builder /app/packages/types/package.json ./packages/types/
COPY --from=builder /app/packages/observability/dist ./packages/observability/dist
COPY --from=builder /app/packages/observability/package.json ./packages/observability/
COPY --from=builder /app/packages/state/dist ./packages/state/dist
COPY --from=builder /app/packages/state/package.json ./packages/state/
COPY --from=builder /app/packages/secrets/dist ./packages/secrets/dist
COPY --from=builder /app/packages/secrets/package.json ./packages/secrets/
COPY --from=builder /app/packages/versioning/dist ./packages/versioning/dist
COPY --from=builder /app/packages/versioning/package.json ./packages/versioning/
COPY --from=builder /app/packages/connectors/dist ./packages/connectors/dist
COPY --from=builder /app/packages/connectors/package.json ./packages/connectors/
COPY --from=builder /app/packages/llm/dist ./packages/llm/dist
COPY --from=builder /app/packages/llm/package.json ./packages/llm/
COPY --from=builder /app/packages/egress/dist ./packages/egress/dist
COPY --from=builder /app/packages/egress/package.json ./packages/egress/
COPY --from=builder /app/packages/workflow-authoring/dist ./packages/workflow-authoring/dist
COPY --from=builder /app/packages/workflow-authoring/package.json ./packages/workflow-authoring/
COPY --from=builder /app/packages/engine/dist ./packages/engine/dist
COPY --from=builder /app/packages/engine/package.json ./packages/engine/
COPY --from=builder /app/packages/triggers/dist ./packages/triggers/dist
COPY --from=builder /app/packages/triggers/package.json ./packages/triggers/
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/turbo.json ./

# Create data directories
RUN mkdir -p /var/lib/loop/git && chown -R node:node /var/lib/loop

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://localhost:3000/health || exit 1

USER node
ENV NODE_ENV=production
ENV LOOP_DATA_DIR=/var/lib/loop
ENV LOOP_DB_PATH=/var/lib/loop/loop.db

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/api/dist/server.js"]
