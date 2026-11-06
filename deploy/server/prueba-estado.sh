#!/bin/sh
# Runs «urna estado» against fakes of podman, curl, timedatectl and openssl, and checks what it says.
#   sh deploy/server/prueba-estado.sh
set -eu
urna=$(cd "$(dirname "$0")" && pwd)/urna
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin" "$work/home/copias" "$work/home/fotos"

# Every container is running. The server answers with FAKE_HEALTH, or not at all when it is empty.
cat >"$work/bin/podman" <<'EOF'
#!/bin/sh
[ "$1" = inspect ] && { echo running; exit 0; }
exit 1
EOF
cat >"$work/bin/curl" <<'EOF'
#!/bin/sh
[ -n "${FAKE_HEALTH:-}" ] || exit 7
printf '%s' "$FAKE_HEALTH"
EOF
printf '#!/bin/sh\necho yes\n' >"$work/bin/timedatectl"
# There is a certificate only when FAKE_CERT says until when.
cat >"$work/bin/openssl" <<'EOF'
#!/bin/sh
[ "$1" = x509 ] && [ -n "${FAKE_CERT:-}" ] && { echo "notAfter=$FAKE_CERT"; exit 0; }
exit 1
EOF
chmod +x "$work/bin/"*
touch "$work/home/copias/urna-20270101-000000.tar.gpg"

failures=0
# estado <name> <.env lines> [VAR=value…]: runs it, keeping what it says in $said.
estado() {
  name=$1 env=$2
  shift 2
  printf '%s\n' 'URNA_IMAGE_SERVER=ghcr.io/bafif/urna-abierta-server:v9.9.9' 'URNA_SITE=https://203.0.113.24' 'URNA_POD=otra' "$env" >"$work/home/.env"
  said=$(env PATH="$work/bin:$PATH" URNA_HOME="$work/home" URNA_RUN_AS_ROOT=si "$@" sh "$urna" estado 2>&1 || true)
}
says() {
  case "$said" in
    *"$1"*) ;;
    *) echo "FALLA $name: no dice «$1»"; printf '%s\n' "$said" | sed 's/^/    /'; failures=$((failures + 1)) ;;
  esac
}
never() {
  case "$said" in
    *"$1"*) echo "FALLA $name: dice «$1»"; printf '%s\n' "$said" | sed 's/^/    /'; failures=$((failures + 1)) ;;
  esac
}

bucket='URNA_S3_ENDPOINT=https://s3.ejemplo.test
URNA_S3_BUCKET=fotos-prueba'

cert='FAKE_CERT=Feb  1 00:00:00 2027 GMT'

# The first boot while the cloud's firewall keeps the ports closed: it is the certificate, not the server.
estado 'sin certificado todavía' ''
says 'espera el servidor responde: sin certificado no se le puede preguntar'
says 'FALLA  certificado: todavía no hay'
says 'abrí TCP 80 y 443, y UDP 443, en el firewall de la nube'
never 'podman logs'

estado 'sin respuesta, con bucket' "$bucket" "$cert"
says 'FALLA  el servidor responde: no contesta. Mirá lo último que dijo con «podman logs --tail 50 otra-server»'
never 'urna-server'
says 'espera fotos: según .env se guardan en el bucket fotos-prueba de https://s3.ejemplo.test, cifradas. El bucket no entra en la copia. Hasta que el servidor conteste, no se sabe si llegan'

estado 'sin respuesta, sin bucket' '' "$cert"
says "bien   fotos: en el disco, en $work/home/fotos, y entran en la copia"

estado 'sin respuesta, entrando como root' "$bucket" "$cert" URNA_FROM_ROOT=si
says "no contesta. Mirá lo último que dijo con «sudo runuser -u $(id -un) -- env XDG_RUNTIME_DIR=/run/user/$(id -u) HOME=$work/home podman logs --tail 50 otra-server»"

estado 'con respuesta, con bucket' "$bucket" "$cert" FAKE_HEALTH='{"ok":true,"photos":{"storage":"s3","working":true}}'
says 'bien   el servidor responde'
says 'bien   fotos: en el bucket fotos-prueba de https://s3.ejemplo.test, cifradas'
says 'bien   certificado hasta: Feb  1 00:00:00 2027 GMT'

estado 'el bucket no anda' "$bucket" "$cert" FAKE_HEALTH='{"ok":true,"photos":{"storage":"s3","working":false}}'
says 'FALLA  fotos: no se pueden guardar en el bucket fotos-prueba'
says '«podman logs --tail 50 otra-server»'

[ "$failures" = 0 ] && echo 'urna estado: todo como se espera.'
exit "$failures"
