#!/usr/bin/env bash
# Measures the server inside a pod limited like a free cloud machine.
#   deploy/measure.sh <cpus> <memory> <results-file> <tables> [<tables> ...]
set -euo pipefail
cpus=$1; memory=$2; results=$3; shift 3
root=$(cd "$(dirname "$0")/.." && pwd)
pod=urna-medicion
port=8443
password=$(head -c 18 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9')

podman build -q -t urna-server -f "$root/deploy/server.Containerfile" "$root" >/dev/null
podman build -q -t urna-web -f "$root/deploy/web.Containerfile" "$root" >/dev/null
podman pod rm -f "$pod" >/dev/null 2>&1 || true
trap 'podman pod rm -f "$pod" >/dev/null 2>&1 || true' EXIT
podman pod create --name "$pod" --cpus "$cpus" --memory "$memory" --memory-swap "$memory" -p "127.0.0.1:$port:$port" >/dev/null
podman run -d --pod "$pod" --name "$pod-db" -e POSTGRES_USER=urna -e POSTGRES_DB=urna -e POSTGRES_PASSWORD="$password" \
  docker.io/library/postgres:18-alpine postgres -c shared_buffers=128MB -c max_connections=20 -c work_mem=4MB -c effective_cache_size=384MB >/dev/null
podman run -d --pod "$pod" --name "$pod-server" -e URNA_TEST_SERVER=fake-data-only -e PG_POOL_MAX=8 \
  -e DATABASE_URL="postgres://urna:$password@localhost:5432/urna" urna-server >/dev/null
podman run -d --pod "$pod" --name "$pod-web" -e URNA_SITE="https://localhost:$port" -e URNA_TLS="tls internal" -e URNA_API=localhost:3000 urna-web >/dev/null

for _ in $(seq 1 90); do
  curl -fsk "https://localhost:$port/api/health" >/dev/null 2>&1 && break
  sleep 1
done
if ! curl -fsk "https://localhost:$port/api/health" >/dev/null; then
  echo "El servidor no respondió:" >&2
  podman logs "$pod-server" 2>&1 | tail -n 20 >&2
  podman logs "$pod-web" 2>&1 | tail -n 5 >&2
  exit 1
fi

cgroup=/sys/fs/cgroup/$(podman pod inspect "$pod" --format '{{.CgroupPath}}')
memory_now() { awk '{printf "%.0f", $1 / 1048576}' "$cgroup/memory.current"; }
memory_peak() { awk '{printf "%.0f", $1 / 1048576}' "$cgroup/memory.peak"; }
oom_kills() { awk '$1 == "oom_kill" {print $2}' "$cgroup/memory.events"; }

idle=$(memory_now)
echo "{\"cpus\": \"$cpus\", \"memory\": \"$memory\", \"idle_mb\": $idle, \"memory_max\": \"$(cat "$cgroup/memory.max")\", \"cpu_max\": \"$(cat "$cgroup/cpu.max")\"}" | tee -a "$results"
run() {
  local line
  line=$(node "$root/tools/loadtest/src/index.ts" --url "https://localhost:$port" --run "r$RANDOM$RANDOM" "$@")
  echo "${line%\}}, \"cpus\": \"$cpus\", \"peak_mb\": $(memory_peak), \"oom_kills\": $(oom_kills)}" | tee -a "$results"
}
for tables in "$@"; do
  run --scenario steady --tables "$tables" --seconds 60 --votes-per-hour 120
  run --scenario storm --tables "$tables" --backlog 100 --jitter 30
  run --scenario storm --tables "$tables" --backlog 100 --jitter 0
done
