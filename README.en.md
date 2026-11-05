# Urna Abierta

[Español](README.md)

An open source app to organize poll watchers for any party, in any kind of election. The goal is that a student group
or a small party can watch an election easily, without depending on a huge organization.

Each party installs it on its own server. The project never touches any data: there is no central server, no hosting
and no telemetry.

## Status

It is in its first stage, where I test the riskiest parts before building the rest. What exists today is a test version
**without login and with invented people**. It is not ready for a real election and must not be used with real data.

- Poll watcher view without signal: cross out who voted, undo, and search without accents.
- Sync that neither loses nor duplicates anything, and does not depend on the clocks of the phones.
- Urgent alert with a fallback: call, WhatsApp or SMS.
- Interface in Spanish and English.

How to try it on a phone: [docs/en/phone-tests.md](docs/en/phone-tests.md). The plan is in
[docs/en/technical-plan.md](docs/en/technical-plan.md) and what has been measured so far in
[docs/en/stage-1-results.md](docs/en/stage-1-results.md).

## Development

You need Node 24 and Podman.

```sh
corepack pnpm install
corepack pnpm test           # without a database, the server tests are skipped
deploy/e2e.sh                # browser tests against the real containers
```

To also run the server tests, set `TEST_DATABASE_URL` to a test Postgres.

`deploy/measure.sh` measures how much the server takes within the limits of a small machine.

## The voter roll scanner

Turning scanned PDF rolls into the open format this app reads is the job of
the `urna-abierta-padrones` repository. Each one can be used on its own.

## License

[AGPL-3.0-or-later](LICENSE). If you modify the app and other people use it over a network, you must offer them the
source of your version.
