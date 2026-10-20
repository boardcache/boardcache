# boardCache, the web app, as a container: the same thing the desktop app
# is, served from a container instead of Electron. Boards live in the
# browser that opens it; sync, teams, AI and the Community go to the
# official boardCache server, exactly as the desktop app does. There is no
# server in this image and nothing to configure.
#
# The container speaks plain HTTP on 8080 and expects your own reverse proxy
# (nginx, Caddy, Traefik) on the host for TLS and the hostname, so one proxy
# can front several containers. No nginx inside.
#
#   docker build -t boardcache .
#   docker run -d -p 8080:8080 boardcache     → http://localhost:8080
#
# Point it at a different sync server (self-hosted servers are not
# published; this is for our own staging):
#   docker build --build-arg SYNC_SERVER=https://api.example.com -t boardcache .

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/client ./apps/client
# The build id is what the app's "Update ready" check compares against
# /version.json; a rebuilt image is a new id.
ARG BUILD_ID
ARG SYNC_SERVER=https://api.boardcache.com
RUN pnpm install --frozen-lockfile --filter @boardcache/client... \
 && id="${BUILD_ID:-$(date -u +%Y%m%d%H%M%S)}" \
 && VITE_BUILD_ID="$id" pnpm --dir apps/client build \
 && printf '{"build":"%s"}' "$id" > apps/client/dist/version.json \
 && printf '{\n  "syncServer": "%s"\n}\n' "$SYNC_SERVER" > apps/client/dist/config.json

# static-web-server: a few megabytes, static files only, SPA fallback and
# per-path cache headers from docker/sws.toml.
FROM ghcr.io/static-web-server/static-web-server:2-alpine
COPY docker/sws.toml /sws.toml
COPY --from=build /app/apps/client/dist /app
ENV SERVER_CONFIG_FILE=/sws.toml
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/health >/dev/null || exit 1
