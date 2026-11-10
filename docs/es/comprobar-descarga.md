# Comprobar la descarga

[English](../en/verify-download.md) · [Volver a la instalación](instalacion.md)

Un instalador falso es la forma más fácil de robarle los datos a un partido. Mientras el instalador no esté firmado, estas dos
comprobaciones son la forma de saber que el archivo que bajaste es el que se armó en este repo.

Bajalo solamente de la [página de releases](https://github.com/bafif/urna-abierta/releases/latest). Hay un archivo para cada sistema:

| Sistema | Archivo |
|---|---|
| Windows | `urna-abierta-instalador-windows.exe` |
| macOS con procesador Apple (M1 o posterior) | `urna-abierta-instalador-mac-apple.zip` |
| macOS con procesador Intel | `urna-abierta-instalador-mac-intel.zip` |
| Linux | `urna-abierta-instalador-linux.tar.gz` |

## El SHA-256

Es una huella del archivo: si cambia un solo byte, cambia toda. En la página del release, GitHub muestra el SHA-256 de cada archivo al
lado de su nombre, como `sha256:` y 64 letras y números.

Calculá el del archivo tal como lo bajaste, el `.zip` o el `.tar.gz` antes de descomprimirlo, desde la carpeta donde está:

- **Windows,** en PowerShell: `Get-FileHash .\urna-abierta-instalador-windows.exe -Algorithm SHA256`
- **macOS,** en la Terminal: `shasum -a 256 urna-abierta-instalador-mac-apple.zip`
- **Linux:** `sha256sum urna-abierta-instalador-linux.tar.gz`

Tiene que dar lo mismo que muestra GitHub, sin el `sha256:`. Windows lo muestra en mayúsculas: da igual. Si no coincide, no lo abras:
borralo y bajalo de nuevo desde la página de releases.

## La atestación

El SHA-256 dice que el archivo no cambió desde que se subió. La atestación dice además dónde se armó: en las máquinas de GitHub, con el
código de este repo y su proceso de publicación, y no en la computadora de nadie.

Hace falta la [GitHub CLI](https://cli.github.com/) y haber entrado con `gh auth login`. Desde la carpeta del archivo:

```sh
gh attestation verify urna-abierta-instalador-linux.tar.gz --repo bafif/urna-abierta
```

Cambiá el nombre por el de tu archivo. Tiene que terminar diciendo que la verificación salió bien (*Verification succeeded*). Si dice
otra cosa, no lo abras.

Las imágenes de los contenedores que baja el servidor también llevan su atestación, publicada junto a cada imagen.

## Los avisos del sistema

Comprobar la descarga no saca los avisos de Windows o macOS por un instalador sin firmar.
[Bajarlo y abrirlo](instalacion.md#bajarlo-y-abrirlo) explica qué tocar en cada uno.
