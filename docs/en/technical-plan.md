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
watchers join with a link or a QR code. If a phone treats it badly, it can be packaged with Capacitor without a rewrite: on
Android that is cheap, and on iPhone it takes a Mac and a paid developer account.

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
- **People connect through the IP, with no domain.** Caddy gets a Let's Encrypt certificate for the IP, which lasts 6 days,
  and renews it by itself. A domain of your own is optional.
- **The IP must be fixed:** reserved IP on Oracle, Elastic IP on AWS, static IP on Google. The phone keeps its data tied to that
  address: if it changes, each poll watcher prepares the table again with the new link, and whatever had not been sent becomes
  unreachable. That is why moving to another server during the vote is not an option.
- **Backups leave encrypted and outside the account**, with a key only the party holds, because a free account can close.
- **The server is seasonal:** it is created a few weeks before and deleted after the data is purged.
- **Data and the law:** free servers are usually outside Argentina. The guide warns about it, and deciding is up to the
  party.

## Installation and landing page

This is a proposal. The landing page is a static page that presents the app and explains how to install it; there is nothing
to download to a computer and no version hosted by the project.

1. The party administrator creates a free cloud account and a server, following the guide on the landing page.
2. When creating the server, they paste a block of text into its startup field (“user data” on AWS and Oracle, “startup
   script” on Google). That installs everything by itself.
3. A few minutes later they open `https://<IP>`, and an assistant sets up the party: name, type of election, security values,
   their user and the liability notice.
4. From there they create the accounts and send each poll watcher their link or QR code.

I ruled out the other two options:

- **Desktop installer:** it needs signed versions for each system, and it would have to handle the party's cloud credentials.
- **Central web app with accounts:** the project would host the data of the parties, and the author would become a data
  processor. The plan rules that out from the start.

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

A phone with no space is the worst case, because writing to the database can break it and lose everything. The app checks when
it opens, when preparing the table and every 10 minutes, with a separate write. With no room it warns and blocks crossing out
until space is freed; if a write fails anyway, the person goes back to the list and the app says so. It never shows as saved
what was not saved.

The urgent alert is saved and sent. If it does not go out, it offers a call, WhatsApp and SMS, with the table and the type
of problem, and no voter data.

### Elections lasting several days

An election may last several days, so election day is not a single date:

- The local roll expires when the election closes, not after a fixed number of hours.
- Crossings out from one day still count on the following days.
- Poll watcher shifts are per day.
- The ballot box stays closed at night. At the end of each day it is opened, the envelopes are counted without opening them, and
  it is closed again with all of them inside. The app holds that count per table and per day, and warns the chief if it does not
  match the crossings out.
- The count of votes happens only once, at the end of the election.
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
- What a roll carries but does not change who may vote goes in `extra`, and poll watchers do not see it.
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

1. **Risk test:** Android emulator, OCR on real rolls and measuring at 1 GB.
2. **Core:** format and validator, import, tables, login, poll watcher view and basic permissions.
3. **Full election day:** irregularities, daily envelope count, count with photo, chief panel, schedule, several days and
   practice mode.
4. **Compliance:** traffic light, full permissions, audit, security profiles, legal tools, purge, installer, backups and
   server guides. This is also when a real iPhone gets tested, because there is a server with HTTPS by then.
5. **Dry run** with real people and invented data, including restoring a backup on another server.
6. **Landing page:** a static site, with no analytics, forms or cookies, to promote the app and guide whoever installs it.

## Stage 1 measurements

See [stage-1-results.md](stage-1-results.md).
