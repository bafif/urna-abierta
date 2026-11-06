FROM docker.io/library/node:24-alpine
WORKDIR /app
RUN corepack enable
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
