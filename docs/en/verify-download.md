# Verifying the download

[Español](../es/comprobar-descarga.md) · [Back to the installation](installation.md)

A fake installer is the easiest way to steal a party's data. While the installer is not signed, these two checks are how you know that
the file you downloaded is the one built in this repository.

Download it only from the [releases page](https://github.com/bafif/urna-abierta/releases/latest). There is one file for each system:

| System | File |
|---|---|
| Windows | `urna-abierta-instalador-windows.exe` |
| macOS with an Apple processor (M1 or later) | `urna-abierta-instalador-mac-apple.zip` |
| macOS with an Intel processor | `urna-abierta-instalador-mac-intel.zip` |
| Linux (Debian, Ubuntu, Fedora, Arch and almost every other) | `urna-abierta-instalador-linux-x64.tar.gz` |
| Alpine Linux | `urna-abierta-instalador-linux-x64-musl.tar.gz` |

## The SHA-256

It is a fingerprint of the file: if a single byte changes, all of it changes. On the release page, GitHub shows the SHA-256 of each file
next to its name, as `sha256:` followed by 64 letters and digits.

Compute the one of the file as you downloaded it, the `.zip` or the `.tar.gz` before unpacking it, from the folder where it is:

- **Windows,** in PowerShell: `Get-FileHash .\urna-abierta-instalador-windows.exe -Algorithm SHA256`
- **macOS,** in Terminal: `shasum -a 256 urna-abierta-instalador-mac-apple.zip`
- **Linux:** `sha256sum urna-abierta-instalador-linux-x64.tar.gz`

It has to match what GitHub shows, without the `sha256:`. Windows shows it in capitals: that makes no difference. If it does not match, do
not open it: delete it and download it again from the releases page.

## The attestation

The SHA-256 says the file has not changed since it was uploaded. The attestation also says where it was built: on GitHub's machines,
from this repository's code and its release process, and not on anyone's computer.

You need the [GitHub CLI](https://cli.github.com/), logged in with `gh auth login`. From the file's folder:

```sh
gh attestation verify urna-abierta-instalador-linux-x64.tar.gz --repo bafif/urna-abierta
```

Change the name to your file's. It has to end by saying the verification succeeded (*Verification succeeded*). If it says anything else,
do not open it.

The container images the server downloads also carry their attestation, published next to each image.

## System warnings

Verifying the download does not remove the Windows or macOS warnings about an unsigned installer.
[Downloading and opening it](installation.md#downloading-and-opening-it) explains what to tap on each one.
