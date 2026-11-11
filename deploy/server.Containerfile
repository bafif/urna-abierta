FROM docker.io/library/node:26-alpine
# Ties the published image to the repository on GitHub.
LABEL org.opencontainers.image.source="https://github.com/bafif/urna-abierta" \
      org.opencontainers.image.description="Urna Abierta: the server" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"
WORKDIR /app
RUN npm install -g corepack@0.36.0 && corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/domain/package.json packages/domain/
COPY apps/server/package.json apps/server/
RUN COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile --prod --filter @urna-abierta/server...
COPY packages/domain/src packages/domain/src
COPY apps/server/src apps/server/src
# The commands of the server come with each version: the installation and «urna actualizar» take them from here.
COPY deploy/server/urna urna
# The build context may keep restrictive modes from the checkout.
RUN chmod -R a+rX /app
USER node
ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=256
CMD ["node", "apps/server/src/main.ts"]
