# Comprobar la descarga

[English](../en/verify-download.md) · [Volver a la instalación](instalacion.md)

Un instalador falso es la forma más fácil de robarle los datos a un partido. Mientras el instalador no esté firmado, estas dos
comprobaciones son la forma de saber que el archivo que bajaste es el que se armó en este repo.

Bajalo solamente de la [página de releases](https://github.com/bafif/urna-abierta/releases/latest). Hay un archivo para cada sistema:

| Sistema | Archivo |
|---|---|
| Windows | `urna-abierta-instalador-win32-x64.exe` |
| macOS con procesador Apple (M1 o posterior) | `urna-abierta-instalador-darwin-arm64` |
| macOS con procesador Intel | `urna-abierta-instalador-darwin-x64` |
| Linux | `urna-abierta-instalador-linux-x64` |

## El SHA-256

Es una huella del archivo: si cambia un solo byte, cambia toda. En la página del release, GitHub muestra el SHA-256 de cada archivo al
lado de su nombre, como `sha256:` y 64 letras y números.

Calculá el del archivo que bajaste, desde la carpeta donde está:

- **Windows,** en PowerShell: `Get-FileHash .\urna-abierta-instalador-win32-x64.exe -Algorithm SHA256`
- **macOS,** en la Terminal: `shasum -a 256 urna-abierta-instalador-darwin-arm64`
- **Linux:** `sha256sum urna-abierta-instalador-linux-x64`

Tiene que dar lo mismo que muestra GitHub, sin el `sha256:`. Windows lo muestra en mayúsculas: da igual. Si no coincide, no lo abras:
borralo y bajalo de nuevo desde la página de releases.

## La atestación

El SHA-256 dice que el archivo no cambió desde que se subió. La atestación dice además dónde se armó: en las máquinas de GitHub, con el
código de este repo y su proceso de publicación, y no en la computadora de nadie.

Hace falta la [GitHub CLI](https://cli.github.com/) y haber entrado con `gh auth login`. Desde la carpeta del archivo:

```sh
gh attestation verify urna-abierta-instalador-linux-x64 --repo bafif/urna-abierta
```

Cambiá el nombre por el de tu archivo. Tiene que terminar diciendo que la verificación salió bien (*Verification succeeded*). Si dice
otra cosa, no lo abras.

Las imágenes de los contenedores que baja el servidor también llevan su atestación, publicada junto a cada imagen.

## Los avisos del sistema

Comprobar la descarga no saca los avisos de Windows o macOS por un instalador sin firmar.
[Los avisos del sistema](instalacion.md#los-avisos-del-sistema) explica qué tocar en cada uno.
