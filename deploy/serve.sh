#!/usr/bin/env bash
# Runs the test app with its server on http://localhost:8090, with invented people only.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
pod=urna-prueba
port=8090
podman build -q -t urna-server -f "$root/deploy/server.Containerfile" "$root" >/dev/null
podman build -q -t urna-web -f "$root/deploy/web.Containerfile" "$root" >/dev/null
podman pod rm -f "$pod" >/dev/null 2>&1 || true
podman pod create --name "$pod" -p "127.0.0.1:$port:$port" >/dev/null
podman run -d --pod "$pod" --name "$pod-db" -e POSTGRES_USER=urna -e POSTGRES_DB=urna -e POSTGRES_PASSWORD=prueba \
  docker.io/library/postgres:18-alpine >/dev/null
podman run -d --pod "$pod" --name "$pod-server" -e URNA_TEST_SERVER=fake-data-only \
  -e DATABASE_URL=postgres://urna:prueba@localhost:5432/urna urna-server >/dev/null
podman run -d --pod "$pod" --name "$pod-web" -e URNA_SITE=":$port" -e URNA_API=localhost:3000 urna-web >/dev/null
echo "Lista en http://localhost:$port. Para frenarla: podman pod rm -f $pod"
