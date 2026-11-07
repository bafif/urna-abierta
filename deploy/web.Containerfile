FROM --platform=$BUILDPLATFORM docker.io/library/node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/domain/package.json packages/domain/
COPY apps/web/package.json apps/web/
RUN COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile --filter @urna-abierta/web...
COPY packages/domain/src packages/domain/src
COPY apps/web apps/web
# The legal text of this version goes inside the app, to be read without going online.
COPY LEGAL.md LEGAL.en.md ./
RUN pnpm --filter @urna-abierta/web build

FROM docker.io/library/caddy:2-alpine
# Ties the published image to the repository on GitHub.
LABEL org.opencontainers.image.source="https://github.com/bafif/urna-abierta" \
      org.opencontainers.image.description="Urna Abierta: the app and its web server" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/build /srv
