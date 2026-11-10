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
# sudo: a minimal Debian may come without it, and the way in for later (urna-admin) needs it.
apt_get install -y -qq podman uidmap slirp4netns passt gnupg curl openssl dbus-user-session sudo >/dev/null

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

# The language «urna» answers in: the one of the installer, es or en. Empty, it follows the system's.
case "${URNA_IDIOMA:-}" in es | en) ;; *) URNA_IDIOMA='' ;; esac
if [ "$URNA_IDIOMA" = es ]; then
  backup_unit='Copia de seguridad de Urna Abierta' backup_timer='Una copia cada 6 horas'
else
  backup_unit='Urna Abierta backup' backup_timer='A backup every 6 hours'
fi

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
# Idioma de «urna»: es o en; vacío, el del sistema. Language of «urna»: es or en; empty, the system's.
URNA_IDIOMA=$URNA_IDIOMA
# Fotos en un almacenamiento S3: si quedan vacías, van al disco. Después de cambiarlas, «urna reiniciar».
# Photos in S3 storage: left empty, they go to disk. After changing them, «urna reiniciar».
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
ExecStart=$home/urna arrancar sin-esperar
ExecStop=$home/urna frenar
TimeoutStartSec=600

[Install]
WantedBy=default.target
EOF
cat >"$home/.config/systemd/user/urna-copia.service" <<EOF
[Unit]
Description=$backup_unit

[Service]
Type=oneshot
Environment=URNA_HOME=$home
ExecStart=$home/urna copia
EOF
cat >"$home/.config/systemd/user/urna-copia.timer" <<EOF
[Unit]
Description=$backup_timer

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

# A way in for later, to update the server or restore a copy, with the key of the access file the installer gave.
if [ -n "${URNA_ADMIN_KEY:-}" ]; then
  id urna-admin >/dev/null 2>&1 || useradd -m -s /bin/bash urna-admin
  install -d -m 700 -o urna-admin -g urna-admin /home/urna-admin/.ssh
  printf 'ssh-ed25519 %s urna-abierta\n' "$URNA_ADMIN_KEY" >/home/urna-admin/.ssh/authorized_keys
  chown urna-admin:urna-admin /home/urna-admin/.ssh/authorized_keys
  chmod 600 /home/urna-admin/.ssh/authorized_keys
  printf 'urna-admin ALL=(ALL) NOPASSWD:ALL\n' >/etc/sudoers.d/urna-admin
  chmod 440 /etc/sudoers.d/urna-admin
fi
# Whoever came in with root's password the first time: from now on, only keys. This file goes before the ones of the
# cloud, and the first value sshd reads is the one it keeps.
if [ "${URNA_SOLO_LLAVES:-}" = si ] && [ -n "${URNA_ADMIN_KEY:-}" ] && [ -d /etc/ssh/sshd_config.d ]; then
  printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\n' >/etc/ssh/sshd_config.d/10-urna-abierta.conf
  systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
fi

say 'starting'
# With a user session it starts through systemd, so that it comes back after a reboot.
if [ -d "/run/user/$uid" ] && run_as_urna systemctl --user daemon-reload 2>/dev/null; then
  run_as_urna systemctl --user enable --now urna-copia.timer >/dev/null 2>&1 || true
  run_as_urna systemctl --user enable --now urna-abierta.service >/dev/null 2>&1 || true
fi
# Starts what systemd did not, waits for it to answer and makes the first backup. A slow certificate, as while the
# cloud's firewall keeps 80 and 443 closed, stops nothing: everything keeps running, and «urna estado» says what is missing.
answered=0
run_as_urna "$home/urna" arrancar || answered=$?
case "$answered" in
  0) say "ready $URNA_SITE" ;;
  3) say "still_waiting $URNA_SITE" ;;
  *) exit 1 ;;
esac
