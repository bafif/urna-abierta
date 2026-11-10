# How to contribute

[Español](CONTRIBUTING.md) · [Back to the README](README.en.md)

Thanks for wanting to join. Urna Abierta is a personal project of mine: before a big change, open an issue to talk it over, so you do not
work on something that cannot get in later. If you found a security flaw, do not open an issue: follow [SECURITY.en.md](SECURITY.en.md).

## Sign off every commit

There is no CLA: you hand nothing over to anyone, and your code stays under the same license as the rest, the
[AGPL-3.0-or-later](LICENSE). All that is asked is the [Developer Certificate of Origin](https://developercertificate.org/) (DCO): a line
at the end of each commit saying that you wrote that code, or that you have the right to contribute it under that license.

```sh
git commit -s
```

That adds `Signed-off-by: Your Name <you@email>`, with the name and email of your git configuration. If you do not want to publish your
email, use the one GitHub gives you, ending in `@users.noreply.github.com`. A pull request with commits without that line cannot be
accepted. If you forgot it, on your branch: `git rebase --signoff main` and then `git push --force-with-lease`.

## Tests

You need Node 24. The browser tests also need Podman.

```sh
corepack pnpm install
corepack pnpm test                                   # the unit tests of the whole repository
corepack pnpm check                                  # the types of every package, its tests included
node design/verificar-contraste.mjs                  # that every theme can be read
sh deploy/server/prueba-estado.sh                    # what «urna estado» says, in both languages, with fake podman and curl
node deploy/verificar-documentos.mjs                 # that every document has its pair in the other language, and its links lead somewhere
```

The server tests against a real database run only if you give them an empty Postgres. Without `TEST_DATABASE_URL`, they are skipped:

```sh
podman run -d --name urna-prueba-db -p 5432:5432 -e POSTGRES_USER=urna -e POSTGRES_PASSWORD=prueba -e POSTGRES_DB=urna \
  docker.io/library/postgres:18-alpine
TEST_DATABASE_URL=postgres://urna:prueba@localhost:5432/urna corepack pnpm test
```

The end-to-end tests build the containers with Podman and drive a browser or an Ubuntu machine:

| Command | What it tests |
|---|---|
| `deploy/e2e.sh` | The whole app, against a real Postgres, server and Caddy |
| `deploy/e2e-instalador.sh` | The installer, screen by screen, up to the first account |
| `node apps/installer/e2e/texto.ts` | The block to paste, exactly as the installer gives it, run by cloud-init as root on an Ubuntu's first boot, until the app answers at its address with a certificate and `urna estado` says everything is fine |
| `node apps/installer/e2e/servidor.ts` | The installation over SSH on two Ubuntu machines: the encrypted backup, updating, going back from a version that does not start, restoring on another server and rebooting |
| `deploy/e2e-lector.sh` | The roll reader, with the `urna-abierta-padrones` repository next to this one |

Every pull request runs on GitHub, each in its own job so that one that fails does not hide the others: the unit tests, the server's with
the same Postgres, both browser ones and the one for the block to paste. The SSH one takes much longer, so it runs on `main`, once a week
and before each release: if your change touches `deploy/server/` or the installer, run it yourself and say so in the pull request. The
reader's needs the other repository and does not run on GitHub.

## Languages

- **Code is in English:** names, comments, tests and commit messages.
- **What a person reads is in Spanish and English.** Every text of the app is in `apps/web/src/lib/i18n.svelte.ts`, in both languages,
  and the type check fails if one is missing. The installer's are in `apps/installer/ui/texts.js`. A test fails if a text is missing a
  language or if a screen writes Spanish of its own.
- **Documentation goes in `docs/es` and `docs/en`,** with the same structure. Files at the root have their English version next to them,
  like `README.en.md`. Each document links to its pair at the very top, and `node deploy/verificar-documentos.mjs` fails if one is missing.
- **The Spanish is from the River Plate, with voseo,** plain and short. Every promise comes with what makes it true, and limits are said
  as they are.
- **Each app starts in the language of the device:** Spanish if any of the languages the phone or computer prefers is Spanish,
  English otherwise. There is always a selector in sight, and what the person chooses wins.

## How work is done

- **Never real data.** Not in code, not in a test, not in an issue or a screenshot. For testing there are invented people:
  `node deploy/padron-inventado.mjs 350 > padron.csv`, or `deploy/serve.sh`.
- **A new or changed screen is approved before it is built.** Open an issue with the proposal: a screenshot or a sketch is enough.
- **Nothing leaves each party's server.** No telemetry, no third-party services from the app, and nothing that depends on a server of the
  project.
- **Each commit does one thing,** with an English subject shaped `Area: what changed`, for example `Rolls: read the header below a title`.
  The body says why.
