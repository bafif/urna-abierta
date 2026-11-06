# Prepares an Ubuntu or Debian machine and starts Urna Abierta. Runs as root, once.
# The installer puts the settings before this, so that it fits in one block. The `urna` script comes in the server image.
set -eu

home=/opt/urna-abierta
# Whoever runs this may be in a folder the user of the containers cannot enter.
cd /
# Each step says a key, and the installer shows it in the person's language. Words, so that a log still reads.
say() { printf 'urna-abierta: %s\n' "$*"; }

if ! command -v apt-get >/dev/null 2>&1; then
  say 'needs_debian' >&2
  exit 1
fi

# A machine created minutes ago may still be setting itself up, or updating, and holding apt. Over SSH it waits for
# cloud-init to finish; when this runs inside cloud-init, as pasted text, waiting for it would never end.
case "$0" in
  */var/lib/cloud/*) ;;
  *) if command -v cloud-init >/dev/null 2>&1; then say 'waiting_system'; timeout 900 cloud-init status --wait >/dev/null 2>&1 || true; fi ;;
esac
say 'packages'
export DEBIAN_FRONTEND=noninteractive
apt_get() { apt-get -o DPkg::Lock::Timeout=600 "$@"; }
# Updating the lists has its own lock, which the timeout above may not cover.
tries=1
until apt_get update -qq; do
  [ "$tries" -lt 10 ] || exit 1
  tries=$((tries + 1))
  sleep 20
done
apt_get install -y -qq podman uidmap slirp4netns passt gnupg curl openssl dbus-user-session >/dev/null

# Small free machines: a little swap avoids killing the database under a peak.
if [ "$(swapon --show | wc -l)" = 0 ] && [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 2000000 ] && [ -z "${URNA_NO_SWAP:-}" ]; then
  say 'swap'
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile && echo '/swapfile none swap sw 0 0' >>/etc/fstab || say 'swap_failed'
fi

# Oracle's Ubuntu images come with a firewall that only lets SSH in.
if command -v iptables >/dev/null 2>&1 && iptables -S INPUT 2>/dev/null | grep -q -- '-j REJECT'; then
  say 'firewall'
  iptables -I INPUT 1 -p tcp -m multiport --dports 80,443 -j ACCEPT
  iptables -I INPUT 1 -p udp --dport 443 -j ACCEPT
  command -v netfilter-persistent >/dev/null 2>&1 && netfilter-persistent save >/dev/null 2>&1 || true
fi

if ! id urna >/dev/null 2>&1; then
  useradd --create-home --home-dir "$home" --shell /bin/sh urna
fi
uid=$(id -u urna)
echo 'net.ipv4.ip_unprivileged_port_start=80' >/etc/sysctl.d/90-urna-abierta.conf
sysctl -q --system >/dev/null 2>&1 || sysctl -q -w net.ipv4.ip_unprivileged_port_start=80 >/dev/null 2>&1 || true
loginctl enable-linger urna 2>/dev/null || true
# The session of the user takes a moment to appear, and without systemd it never does.
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  [ -d "/run/user/$uid" ] && break
  sleep 1
done
[ -d "/run/user/$uid" ] || install -d -m 700 -o urna -g urna "/run/user/$uid"

# Without an address given, the machine asks what its public one is.
if [ "${URNA_SITE:-}" = auto ]; then
  ip=$(curl -4 -fsS --max-time 8 https://checkip.amazonaws.com || curl -4 -fsS --max-time 8 https://api.ipify.org)
  URNA_SITE=https://$(printf '%s' "$ip" | tr -d '[:space:]')
fi

# What nobody has to see is made here, not in the block that installs, which a cloud keeps where its console shows it:
# the database password and the key of the sealed fields. Installing again keeps those of the installation that is
# there, which its database and its sealed fields need.
kept() { sed -n "s/^$1=\([0-9a-f]\{1,\}\)\$/\1/p" "$home/.env" 2>/dev/null | head -n 1; }
POSTGRES_PASSWORD=$(kept POSTGRES_PASSWORD)
[ -n "$POSTGRES_PASSWORD" ] || POSTGRES_PASSWORD=$(openssl rand -hex 24)
URNA_FIELD_KEY=$(kept URNA_FIELD_KEY)
[ -n "$URNA_FIELD_KEY" ] || URNA_FIELD_KEY=$(openssl rand -hex 32)

umask 077
cat >"$home/.env" <<EOF
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
URNA_FIELD_KEY=$URNA_FIELD_KEY
URNA_BACKUP_KEY=$URNA_BACKUP_KEY
URNA_SETUP_CODE_HASH=$URNA_SETUP_CODE_HASH
URNA_TEMA=$URNA_TEMA
URNA_SITE=$URNA_SITE
URNA_CERT=$URNA_CERT
URNA_IMAGE_DB=$URNA_IMAGE_DB
URNA_IMAGE_SERVER=$URNA_IMAGE_SERVER
URNA_IMAGE_WEB=$URNA_IMAGE_WEB
# Fotos en un almacenamiento S3: si quedan vacías, van al disco. Después de cambiarlas, «urna reiniciar».
URNA_S3_ENDPOINT=${URNA_S3_ENDPOINT:-}
URNA_S3_BUCKET=${URNA_S3_BUCKET:-}
URNA_S3_REGION=${URNA_S3_REGION:-}
URNA_S3_ACCESS_KEY_ID=${URNA_S3_ACCESS_KEY_ID:-}
URNA_S3_SECRET_ACCESS_KEY=${URNA_S3_SECRET_ACCESS_KEY:-}
URNA_S3_PREFIX=${URNA_S3_PREFIX:-}
${URNA_EXTRA_ENV:-}
EOF
umask 022
mkdir -p "$home/copias" "$home/fotos" "$home/.config/systemd/user/default.target.wants" "$home/.config/systemd/user/timers.target.wants"

cat >"$home/.config/systemd/user/urna-abierta.service" <<EOF
[Unit]
Description=Urna Abierta
After=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
Environment=URNA_HOME=$home
ExecStart=$home/urna arrancar
ExecStop=$home/urna frenar
TimeoutStartSec=600

[Install]
WantedBy=default.target
EOF
cat >"$home/.config/systemd/user/urna-copia.service" <<EOF
[Unit]
Description=Copia de seguridad de Urna Abierta

[Service]
Type=oneshot
Environment=URNA_HOME=$home
ExecStart=$home/urna copia
EOF
cat >"$home/.config/systemd/user/urna-copia.timer" <<EOF
[Unit]
Description=Una copia cada 6 horas

[Timer]
OnCalendar=00/6:30
Persistent=true

[Install]
WantedBy=timers.target
EOF
ln -sf ../urna-abierta.service "$home/.config/systemd/user/default.target.wants/urna-abierta.service"
ln -sf ../urna-copia.timer "$home/.config/systemd/user/timers.target.wants/urna-copia.timer"
chown -R urna:urna "$home"
chmod 600 "$home/.env"

run_as_urna() { runuser -u urna -- env XDG_RUNTIME_DIR="/run/user/$uid" HOME="$home" URNA_HOME="$home" "$@"; }

if [ -n "${URNA_IMAGES_TAR:-}" ]; then
  say 'images_load'
  run_as_urna podman load -q -i "$URNA_IMAGES_TAR" >/dev/null
else
  say 'images_pull'
  run_as_urna podman pull -q "$URNA_IMAGE_DB" "$URNA_IMAGE_SERVER" "$URNA_IMAGE_WEB" >/dev/null
fi
# The commands of this version, from its image: «urna actualizar» brings the ones of the next.
run_as_urna podman run --rm --network none --entrypoint cat "$URNA_IMAGE_SERVER" /app/urna >"$home/urna"
chown urna:urna "$home/urna"
chmod 755 "$home/urna"
ln -sf "$home/urna" /usr/local/bin/urna

say 'starting'
# With a user session it starts through systemd, so that it comes back after a reboot.
started=no
if [ -d "/run/user/$uid" ] && run_as_urna systemctl --user daemon-reload 2>/dev/null; then
  run_as_urna systemctl --user enable --now urna-copia.timer >/dev/null 2>&1 || true
  if run_as_urna systemctl --user enable --now urna-abierta.service >/dev/null 2>&1; then started=yes; fi
fi
[ "$started" = yes ] || run_as_urna "$home/urna" arrancar
say "ready $URNA_SITE"
