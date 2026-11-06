#!/usr/bin/env bash
# Runs the roll reader of urna-abierta-padrones and goes through its four screens in a real browser.
#
# The reader comes from the checkout in URNA_PADRONES_DIR (by default, urna-abierta-padrones next
# to this repository), or is the command in URNA_LECTOR_CMD, to test the packaged program.
# With URNA_E2E_SALIDA set to a folder, a screenshot of every screen, light and dark, goes there.
# URNA_E2E_NOMBRE names the browser container, so that it can be found and removed.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
padrones=$(cd "${URNA_PADRONES_DIR:-$root/../urna-abierta-padrones}" && pwd)
work=$(mktemp -d)
version=$(node -p "require('$root/apps/web/node_modules/@playwright/test/package.json').version")

cleanup() {
  if [ -n "${lector:-}" ]; then
    kill "$lector" 2>/dev/null || true
    wait "$lector" 2>/dev/null || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT

podman build -q -t urna-e2e-browsers --build-arg PLAYWRIGHT_VERSION="$version" -f "$root/deploy/e2e.Containerfile" "$root/deploy" >/dev/null

# Invented people only, drawn by the reader's own test helpers.
mkdir "$work/padrones"
uv run --project "$padrones" python "$root/apps/web/e2e-lector/hacer-padron.py" "$padrones" "$work/padrones"

# The reader keeps its private copy of each PDF inside $work, which goes at the end.
if [ -n "${URNA_LECTOR_CMD:-}" ]; then
  TMPDIR="$work" URNA_NO_BROWSER=1 bash -c "exec $URNA_LECTOR_CMD" >"$work/salida.txt" &
else
  TMPDIR="$work" URNA_NO_BROWSER=1 uv run --project "$padrones" python -m urna_padrones.lector --no-browser >"$work/salida.txt" &
fi
lector=$!
for _ in $(seq 1 60); do
  grep -q '^http' "$work/salida.txt" 2>/dev/null && break
  sleep 1
done
url=$(grep -m1 '^http' "$work/salida.txt")

podman run --rm ${URNA_E2E_NOMBRE:+--name "$URNA_E2E_NOMBRE"} --network host --ipc host -v "$root:/work:ro" -v "$work/padrones:/padrones:ro" -w /work/apps/web \
  -e LECTOR_URL="$url" -e PLAYWRIGHT_HTML_OPEN=never \
  ${URNA_E2E_SALIDA:+-v "$URNA_E2E_SALIDA:/salida"} \
  urna-e2e-browsers \
  npx playwright test -c playwright.lector.config.ts --output /tmp/results "$@"
