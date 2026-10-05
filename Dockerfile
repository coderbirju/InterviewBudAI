# syntax=docker/dockerfile:1
#
# InterviewBudAI web app image (ADR 0011 D2). Used by compose.yaml; not
# published to a registry. Multi-stage:
#   build  — npm ci + npm run build (TypeScript packages + the React SPA)
#   deps   — production dependencies only (npm ci --omit=dev)
#   runtime — slim Node, non-root, built output only (no source, no .env)
#
# Node is pinned by version tag AND digest (charter §7.1). To bump: pick a new
# `24.x.y-bookworm-slim` tag (Node 24 LTS, ADR 0019) and its index digest
# from Docker Hub.
ARG NODE_IMAGE=node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
# Manifests first so the dependency layer caches across source edits.
COPY package.json package-lock.json .npmrc ./
COPY packages/cli/package.json packages/cli/
COPY packages/core/package.json packages/core/
COPY packages/curriculum/package.json packages/curriculum/
COPY packages/providers/package.json packages/providers/
COPY packages/storage/package.json packages/storage/
COPY packages/web/package.json packages/web/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY packages/cli/package.json packages/cli/
COPY packages/core/package.json packages/core/
COPY packages/curriculum/package.json packages/curriculum/
COPY packages/providers/package.json packages/providers/
COPY packages/storage/package.json packages/storage/
COPY packages/web/package.json packages/web/
# The CLI package is not copied into the runtime image: drop its workspace
# link so no dangling symlink ships. (React & co. are devDependencies of
# @ibai/web — only the SPA build uses them — so --omit=dev leaves them out.)
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && rm -f node_modules/@ibai/cli

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
# IBAI_CONTAINER=1 is what allows the 0.0.0.0 bind (the app refuses it
# otherwise). LAN isolation comes from Compose publishing on 127.0.0.1 only.
# The data dir is pinned to the /data bind mount; HOME is a writable dir that
# does not depend on the uid (Compose may override `user:`).
ENV NODE_ENV=production \
    IBAI_CONTAINER=1 \
    IBAI_BIND_HOST=0.0.0.0 \
    IBAI_DATA_DIR=/data \
    HOME=/home/app
WORKDIR /app
RUN mkdir -p /home/app /data \
    && chown node:node /data \
    && chmod 0700 /data \
    && chmod 1777 /home/app
# Built output + production deps only; owned by root, read-only to the app.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=build /app/packages/core/package.json packages/core/package.json
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/curriculum/package.json packages/curriculum/package.json
COPY --from=build /app/packages/curriculum/dist packages/curriculum/dist
COPY --from=build /app/packages/providers/package.json packages/providers/package.json
COPY --from=build /app/packages/providers/dist packages/providers/dist
COPY --from=build /app/packages/storage/package.json packages/storage/package.json
COPY --from=build /app/packages/storage/dist packages/storage/dist
COPY --from=build /app/packages/web/package.json packages/web/package.json
COPY --from=build /app/packages/web/dist packages/web/dist
COPY --from=build /app/packages/web/dist-ui packages/web/dist-ui
USER node
EXPOSE 4173
# Read-only endpoint on the listen port (Host 127.0.0.1:4173 is allowed for
# non-mutating requests only). Node's fetch: slim has no curl.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:4173/api/config').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Built server directly (not bin/start.mjs: no build at runtime).
CMD ["node", "packages/web/dist/server-bin.js"]
