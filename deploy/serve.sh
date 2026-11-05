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
for _ in $(seq 1 60); do
  curl -fs "http://localhost:$port/api/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fs -X POST -H 'content-type: application/json' -d '{"size":350,"tables":2}' "http://localhost:$port/api/test/seed" \
  | node -e '
    const seed = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
    const link = (token) => `http://localhost:'"$port"'/#invitacion=${token}`;
    console.log(`Fiscal:       ${link(seed.tables[0].invitations[0])}`);
    for (const [role, token] of Object.entries(seed.links)) console.log(`${role.padEnd(13)} ${link(token)}`);
  '
echo "Lista en http://localhost:$port, con personas inventadas. Cada link sirve una vez. Para frenarla: podman pod rm -f $pod"
