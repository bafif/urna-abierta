#!/usr/bin/env bash
# Runs the installer from the source, with the images of the server and the app built here from the same code.
# Until a version is published there are no images to download, and this is how «Probar en esta computadora» works:
#   deploy/instalador.sh
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
tag=${URNA_IMAGENES:-desde-el-codigo}

echo 'Armando las imágenes del servidor y de la app. La primera vez tarda unos minutos…'
podman build -q -t "localhost/urna-server:$tag" -f "$root/deploy/server.Containerfile" "$root" >/dev/null
podman build -q -t "localhost/urna-web:$tag" -f "$root/deploy/web.Containerfile" "$root" >/dev/null
echo 'Listas. Estas imágenes están solo en esta computadora: sirven para probar acá, no para instalar en un servidor.'

export URNA_IMAGE_SERVER="localhost/urna-server:$tag" URNA_IMAGE_WEB="localhost/urna-web:$tag"
exec node "$root/apps/installer/src/main.ts"
