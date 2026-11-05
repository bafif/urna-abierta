# Technical plan

[Español](../es/plan-tecnico.md)

## Stack

| Piece | Choice |
|---|---|
| Client | A single PWA with Svelte 5 and SvelteKit, with no server rendering |
| Data on the phone | IndexedDB with Dexie |
| Server | TypeScript on Node, with Fastify |
| Database | Postgres, with a versioned SQL schema |
| Tally sheet photos | Server disk; S3 compatible as an option |
| Installation | `compose` with app, Postgres and Caddy (automatic TLS) |
| Scanner | Python CLI, with local text recognition |

I chose a PWA to avoid depending on app stores or a central account: each party serves it from its own domain, and poll
watchers join with a link or a QR code. If real phones treat it badly, it can be packaged with Capacitor without a rewrite.

## Servers

The app aims to run on a free server, without depending on any service specific to one cloud: only Linux, containers and
disk. The installation guide covers three options, in this order:

1. **Oracle Cloud Always Free:** the only one that is free with no time limit (ARM, equivalent to 2 OCPUs and 12 GB). It
   may reclaim idle instances.
2. **AWS free plan:** for a single election, because the account closes after 6 months or when the credits run out.
3. **Google Cloud Free Tier:** it charges for the IPv4 address (about USD 3.65 a month) and only has regions in the
   United States.

These plans change often. Each guide carries the date it was checked and links to the official pages.

- **The minimum is 1 GB of RAM with a shared CPU**, on `amd64` and `arm64`, with prebuilt images.
- **The server name cannot change.** The phone keeps its data tied to the address of the app. A domain of your own allows
  moving to another provider without phones losing anything.
- **Backups leave encrypted and outside the account**, with a key only the party holds, because a free account can close.
- **The server is seasonal:** it is created a few weeks before and deleted after the data is purged.
- **Data and the law:** free servers are usually outside Argentina. The guide warns about it, and deciding is up to the
  party.

## Without signal, and sync

Everything is saved on the phone first, and the screen responds without waiting for the network. With signal, “Prepare
table” downloads the roll of that table, without addresses. Each action is an operation with its own identifier, and
sending it again duplicates nothing.

| Data | Rule |
|---|---|
| Crossing out | A person voted if there is an uncancelled mark. An undo cancels only the marks that phone saw, so a simultaneous mark by another poll watcher stands |
| Irregularity | Only added; the chief changes its state |
| Count | Each entry is a new version and is never merged. If two entries differ, the chief decides |
| Tally sheet photo | Identified by its SHA-256 |
| Roll, schedule, permissions, traffic light | Edited only with signal |

No rule depends on the clock of a phone. Each table numbers its operations under a lock on its row, because with one global
sequence a reader can miss rows that commit out of order. What arrives late, or from a revoked phone, goes to quarantine for
review instead of being discarded.

The urgent alert is saved and sent. If it does not go out, it offers a call, WhatsApp and SMS, with the table and the type
of problem, and no voter data.

### Elections lasting several days

An election may last several days, so election day is not a single date:

- The local roll expires when the election closes, not after a fixed number of hours.
- Crossings out from one day still count on the following days.
- Poll watcher shifts are per day.
- The panel must not treat a table as finished because night has fallen.

## Roles and permissions

Each permission is assigned as user + role + scope (election, district, school or table), and may expire. Permissions are a
fixed list; roles are editable combinations. The server checks every request and delivers only what that user may see.

- A poll watcher sees only their table and does not download the traffic light, unless the party enables it in a low-risk
  election.
- The technical administrator does not see political data through their role; seeing it takes a permission that gets
  logged.
- Whoever does statistics sees only aggregates, in groups of 5 people or more, and their role expires by itself.
- Sensitive categories of the traffic light need a separate permission and are encrypted per field. That protects disk
  copies and backups, though not a running server, where the key is.
- The audit log cannot be edited.
- Poll watchers join with a single-use invitation and a PIN; other roles, with a passkey or a password and TOTP.

## Roll format

A `.padron` file is a ZIP with `manifest.json`, `units.jsonl` (the hierarchy) and `electors.jsonl` (one person per line). The
specification is published in the scanner repository, under CC0.

- Only `id` and `full_name` are required, and `table` is optional: real rolls arrive without tables assigned.
- There is no field for political data: the traffic light lives only in the app.
- Doubtful rows are imported flagged for review; they are never silently dropped.
- Examples in the repository carry invented data only.

## Languages

Everything goes in Spanish and English, with Spanish as the main language. The interface has a selector, and English is
chosen, never guessed. The code is in English.

## License

- App and scanner: `AGPL-3.0-or-later`.
- Format specification: `CC0-1.0`.
- Contributions: DCO, no CLA.
- `LEGAL.md`, with a liability notice in Spanish in addition to the official English text. A lawyer reviews it before
  publishing.

## Stages

1. **Risk test:** real phones, OCR on real rolls and measuring at 1 GB.
2. **Core:** format and validator, import, tables, login, poll watcher view and basic permissions.
3. **Full election day:** irregularities, count with photo, chief panel, schedule, several days and practice mode.
4. **Compliance:** traffic light, full permissions, audit, security profiles, legal tools, purge, installer, backups and
   server guides.
5. **Dry run** with real people and invented data, including moving to another provider live.
6. **Landing page:** a static site, with no analytics, forms or cookies, for whoever installs the server.

## Stage 1 measurements

See [stage-1-results.md](stage-1-results.md).
