#!/usr/bin/env bash
# Runs the browser tests against the real containers: Postgres, server and Caddy.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
pod=${URNA_E2E_POD:-urna-e2e}
port=${URNA_E2E_PORT:-8090}
version=$(node -p "require('$root/apps/web/node_modules/@playwright/test/package.json').version")

podman build -q -t urna-e2e-browsers --build-arg PLAYWRIGHT_VERSION="$version" -f "$root/deploy/e2e.Containerfile" "$root/deploy" >/dev/null
podman build -q -t "urna-server:$pod" -f "$root/deploy/server.Containerfile" "$root" >/dev/null
podman build -q -t "urna-web:$pod" -f "$root/deploy/web.Containerfile" "$root" >/dev/null
podman pod rm -f "$pod" >/dev/null 2>&1 || true
trap 'podman pod rm -f "$pod" >/dev/null 2>&1 || true' EXIT
podman pod create --name "$pod" -p "127.0.0.1:$port:$port" >/dev/null
podman run -d --pod "$pod" --name "$pod-db" -e POSTGRES_USER=urna -e POSTGRES_DB=urna -e POSTGRES_PASSWORD=prueba \
  docker.io/library/postgres:18-alpine >/dev/null
podman run -d --pod "$pod" --name "$pod-server" -e URNA_TEST_SERVER=fake-data-only -e URNA_SETUP_CODE=codigo-de-prueba \
  -e DATABASE_URL=postgres://urna:prueba@localhost:5432/urna "urna-server:$pod" >/dev/null
podman run -d --pod "$pod" --name "$pod-web" -e URNA_SITE=":$port" -e URNA_API=localhost:3000 "urna-web:$pod" >/dev/null
for _ in $(seq 1 90); do
  curl -fs "http://localhost:$port/api/health" >/dev/null 2>&1 && break
  sleep 1
done
if ! curl -fs "http://localhost:$port/api/health" >/dev/null; then
  echo "El servidor no respondió:" >&2
  podman logs "$pod-server" 2>&1 | tail -n 20 >&2
  exit 1
fi

# With URNA_E2E_INFORME set to a folder, the report and the trace of each failure stay there, as GitHub keeps them.
# No arrays: the bash of macOS, 3.2, stops on an empty one under set -u.
output=/tmp/results
if [ -n "${URNA_E2E_INFORME:-}" ]; then
  mkdir -p "$URNA_E2E_INFORME"
  output=/informe/resultados
  set -- --reporter=list,html --trace retain-on-failure "$@"
fi
podman run --rm --network host --ipc host -v "$root:/work:ro" -w /work/apps/web \
  -e BASE_URL="http://localhost:$port" -e PLAYWRIGHT_HTML_OPEN=never \
  ${URNA_E2E_INFORME:+-v "$URNA_E2E_INFORME:/informe" -e PLAYWRIGHT_HTML_OUTPUT_DIR=/informe/html} \
  urna-e2e-browsers \
  npx playwright test --output "$output" "$@"
