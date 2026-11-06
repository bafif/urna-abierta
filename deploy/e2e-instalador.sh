#!/usr/bin/env bash
# Runs the installer as it comes and goes through its screens in a real browser, up to the first administrator.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
# URNA_E2E_NAME and URNA_E2E_PORT let it run next to another copy, with images of its own.
name=${URNA_E2E_NAME:-urna-instalador-e2e}
port=${URNA_E2E_PORT:-8095}
work=$(mktemp -d)
version=$(node -p "require('$root/apps/web/node_modules/@playwright/test/package.json').version")

cleanup() {
  [ -n "${installer:-}" ] && kill "$installer" 2>/dev/null || true
  podman rm -f "$name-web" "$name-server" "$name-db" >/dev/null 2>&1 || true
  podman volume rm "$name-database" "$name-fotos" >/dev/null 2>&1 || true
  podman network rm "$name" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT
cleanup_before() { podman rm -f "$name-web" "$name-server" "$name-db" >/dev/null 2>&1 || true; podman volume rm "$name-database" "$name-fotos" >/dev/null 2>&1 || true; }
cleanup_before

podman build -q -t urna-e2e-browsers --build-arg PLAYWRIGHT_VERSION="$version" -f "$root/deploy/e2e.Containerfile" "$root/deploy" >/dev/null
podman build -q -t "localhost/urna-server:$name" -f "$root/deploy/server.Containerfile" "$root" >/dev/null
podman build -q -t "localhost/urna-web:$name" -f "$root/deploy/web.Containerfile" "$root" >/dev/null

URNA_NO_BROWSER=1 URNA_CONFIG_DIR="$work" URNA_LOCAL_NAME="$name" URNA_LOCAL_PORT="$port" \
  URNA_IMAGE_SERVER="localhost/urna-server:$name" URNA_IMAGE_WEB="localhost/urna-web:$name" \
  node "$root/apps/installer/src/main.ts" >"$work/salida.txt" &
installer=$!
for _ in $(seq 1 30); do
  grep -q '^http' "$work/salida.txt" 2>/dev/null && break
  sleep 1
done
url=$(grep '^http' "$work/salida.txt")

podman run --rm --network host --ipc host -v "$root:/work:ro" -w /work/apps/web \
  -e INSTALLER_URL="$url" -e PLAYWRIGHT_HTML_OPEN=never \
  ${URNA_E2E_SALIDA:+-v "$URNA_E2E_SALIDA:/salida"} \
  urna-e2e-browsers \
  npx playwright test -c playwright.installer.config.ts --output /tmp/results "$@"
