# Releasing a version

[Español](../es/publicar.md) · [Back to the technical plan](technical-plan.md)

A version is released with a tag that starts with `v`, like `v0.1.0`. GitHub Actions does everything else
(`.github/workflows/release.yml`), in this order, and each step waits for the previous one:

1. **The tests.** Those of every change, plus the installation over SSH on two Ubuntu machines. If any fails, nothing is built.
2. **The images** of the server and the app, for x86 and ARM, with the version's tag and their attestation. `latest` is not touched
   yet.
3. **A draft release,** a single one for both languages. Its notes say what to download, in Spanish and English
   (`.github/release-notes.md`), above the list of changes GitHub writes.
4. **The installers** for Windows, macOS (Apple and Intel) and Linux (glibc and musl). Each one is unpacked and started as a person would, and it has to
   show its screens and say its version before it is uploaded to the draft, with its SHA-256 and its attestation.
5. **Publishing.** First it checks that the images can be pulled without an account, for both architectures, as every server pulls
   them. Only then does `latest` point to this version, and the release stops being a draft.

The published files have names a person recognizes: `urna-abierta-instalador-windows.exe`, `urna-abierta-instalador-mac-apple.zip`,
`urna-abierta-instalador-mac-intel.zip`, `urna-abierta-instalador-linux-x64.tar.gz` (any Linux with glibc 2.28 or newer) and
`urna-abierta-instalador-linux-x64-musl.tar.gz` (Alpine, built in an Alpine container). The macOS and Linux ones are compressed because that
way they keep the permission to run, which the browser drops when it downloads a bare file.

## The first time: making the images public

GitHub creates every new package as private, and a server cannot pull a private image. On the first version, step 5 will fail with
“cannot be pulled without an account”. It has to be done only once, for each of the two packages:

1. On GitHub, your profile, **Packages**, `urna-abierta-server`.
2. **Package settings**, **Change visibility**, **Public**, and confirm with the package's name.
3. The same with `urna-abierta-web`.
4. On the run that failed, **Re-run failed jobs**.

After that they stay public, and the next versions are released by themselves.

## After releasing

`urna actualizar` on each server looks for the latest published version on the releases page. Before announcing a new version, try
it on a test server with `sudo urna actualizar vX.Y.Z`.
