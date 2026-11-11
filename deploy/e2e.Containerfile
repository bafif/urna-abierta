# Browsers for the tests, on a base image from an allowed registry.
FROM docker.io/library/node:26-trixie
ARG PLAYWRIGHT_VERSION
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx -y playwright@${PLAYWRIGHT_VERSION} install --with-deps chromium webkit
