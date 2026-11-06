# Technical plan

[Español](../es/plan-tecnico.md)

## Stack

| Piece | Choice |
|---|---|
| Client | A single PWA with Svelte 5 and SvelteKit, with no server rendering |
| Data on the phone | IndexedDB with Dexie |
| Server | TypeScript on Node, with Fastify |
| Database | Postgres, with a versioned SQL schema |
| Tally sheet photos | Server disk, or S3-compatible storage, where they arrive encrypted (see [servers](servers.md)) |
| Installation | A rootless Podman pod with app, Postgres and Caddy (automatic TLS), which a script leaves running on Ubuntu or Debian |
| Installer | A single executable for Windows, macOS and Linux, published on GitHub Releases. It is Node with its files inside: it opens its screens in the browser, shares the themes with the app, and could be tested end to end |
| Scanner | A roll reader in Python for scanned PDFs, which runs on the computer with local text recognition |

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

**Pending: backups with a public key.** Today the server encrypts each backup with the recovery key, so it holds it in its `.env` and
in the cloud's *user data*, which anyone with access to that account can read; the servers guide says how to delete it or change the
key. The alternative is to encrypt backups to a public key, for instance with `age` or GPG, whose private half is the key shown to the
party: the server and the cloud would keep only the public half, which opens nothing, and restoring would ask for the private one. It
changes the backup format, how earlier backups are restored and what the installer does, so it is left to decide.

## Installation and landing page

The landing page is a static page that presents the app and links to a GitHub release, with a desktop installer for Windows,
macOS and Linux. There is no version hosted by the project: it would hold the data of the parties, and I would become a data
processor.

The installer asks for everything technical once, so that the app starts directly with the party:

1. **Where it will live.** Four options, and all of them have to work:

   | Option | What it does | For whom |
   |---|---|---|
   | Create a new server | With an Oracle, AWS or Google credential, used once and never stored | Most people |
   | I already have a server | Connects over SSH with an address and a key | Whoever already has one, with any provider |
   | Paste a text | Gives a block to paste into the startup field when creating the server | Whoever prefers not to give the installer a credential |
   | Try it on this computer | Runs everything locally | Whoever wants to look at it before deciding |

2. **How to read rolls.** On that computer, which is recommended; with their own AI, pasting their key; or later.
3. **How it looks.** All the themes, with a preview in light and dark.
4. **Install.** It ends with the address, a recovery key for the backups, and opening the app.

### Signing

My name may appear in a signature. What must not get out is my address or anything about my machines.

- **Everything is built and signed on GitHub Actions**, on its machines and never on mine. That way the installer carries no
  paths or computer names, and the timestamp service never sees my IP.
- **A signature sends nothing:** it is a seal inside the file. All it can reveal is what the certificate says.

| System | What is published | What the person installing sees |
|---|---|---|
| Windows | Unsigned. Once there is a release, I apply for the free signature of SignPath Foundation, whose certificate is in the foundation's name and carries none of my data | SmartScreen warns until it is signed: “More info” and “Run anyway” |
| macOS | In a `.zip`, which keeps the permission to run it. Ad-hoc signature, which identifies nobody. If the warning has to go: Developer ID and notarization, for USD 99 a year | macOS blocks it the first time: Settings, Privacy & Security, “Open Anyway” |
| Linux | One executable in a `.tar.gz`, which keeps the permission to run it | No warning |

I rule out the Certum open source certificate, because it publishes the city and province, and Microsoft Artifact Signing, which
for individuals is only available in the United States and Canada.

Since an unsigned installer is easy to fake, each release publishes its SHA-256 and a GitHub attestation, which ties it to the
repository and the build process. The guide explains each warning, with screenshots, so that nobody skips them blindly. How a version is released, in [Releasing a version](releasing.md).

## Design

The guide is that someone who barely uses a phone can use it alone, for the first time. The proposal can be seen in
`design/index.html`.

- **One screen, one question, one main button.** There are no menus.
- **A default plan.** The home screen is a line of stations: what happened, where you are and what comes next. Each role has its
  own, and the current step explains what to do.
- **First the party, then each election.** Whoever administers sets up the party, the team and the security once. Then they create
  an election whenever needed, because the same party uses the app several times a year.
- **Roles in words.** You choose “look after a table”, not a table of permissions, which can still be adjusted.

### Themes

A theme is a data file, and a party can create its own: colors for light and dark mode, fonts, shapes, and a few recipes, such as
how to cross out or what panels are made of. `design/verificar-contraste.mjs` rejects what cannot be read: text must reach 7:1,
thinking of older eyes.

| Theme | Idea |
|---|---|
| Aula | The default: a ruled notebook by day and a blackboard by night, with a typeface made for low vision |
| Vidrio | Translucent panels over sky blue and white; the most demanding on a cheap phone |
| Feria | One color per task, so that you can say over the phone “tap the green one” |
| Tablero | No ornaments: the number rules, like a results board |
| Mate | The calmest: round shapes, and whoever voted moves aside with a tick |

All the themes are included, with Aula preselected. They are chosen with a preview at two moments: in the installer, the one the whole party sees when
joining; and the first time someone opens the app, on a phone or a computer, where they can change it for themselves with one tap.

Fonts travel with the app, because it has to work without signal, and all of them are under the OFL.

## Without signal, and sync

Everything is saved on the phone first, and the screen responds without waiting for the network. With signal, “Prepare
table” downloads the roll of that table, without addresses, and with a random identifier for each person, never their
document. If the roll changes afterwards, the phone downloads it again by itself when it has signal, and what was crossed out
stays. Each action is an operation with its own identifier, and sending it again duplicates nothing.

| Data | Rule |
|---|---|
| Crossing out | A person voted if there is an uncancelled mark. An undo cancels only the marks that phone saw, so a simultaneous mark by another poll watcher stands |
| Irregularity | Only added; the chief changes its state |
| Count | Each entry is a new version and is never merged. If two entries differ, the chief decides |
| Tally sheet photo | Identified by its SHA-256 |
| Roll, schedule, permissions, traffic light | Edited only with signal |

No rule depends on the clock of a phone: the day comes from the server's clock, in the election's time zone. Each table numbers
its operations under a lock on its row, because with one global sequence a reader can miss rows that commit out of order. What
arrives after the close goes to quarantine for review instead of being discarded, except marks that arrive after the purge,
which are dropped. A revoked phone stops sending, and what it had stays saved on it.

A phone with no space is the worst case, because writing to the database can break it and lose everything. The app checks when
it opens, when preparing the table and every 10 minutes, with a separate write. With no room it warns and blocks crossing out
until space is freed; if a write fails anyway, the person goes back to the list and the app says so. It never shows as saved
what was not saved.

The urgent alert is saved and goes out first, on its own, without waiting for what is queued. If it does not go out within a
few seconds, it offers a call, WhatsApp and SMS, with the table and the type
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
- An invitation gets whoever has it in as that person. Someone who does not manage the team, such as a chief, invites only
  poll watchers of the tables they see, if their role gives them nothing the chief lacks; anyone else is invited by whoever
  manages the team. A phone that came in with a chief's link does not turn on the second step for someone who never did:
  that takes a link from whoever manages the team.
- Sensitive categories of the traffic light need a separate permission and are encrypted per field. That protects a
  dump of the database taken without the `.env`. It does not protect a copy of the whole disk or the backups, which carry
  the key, nor a running server.
- Erasing a person or purging an election also replaces their roll id, which is often the DNI. The audit log names each
  person by a random reference, never by that id, and that reference is replaced too on erasing or purging: what the log
  already said, a sensitive mark included, does not lead to the row. Until the purge, the erased row stays at its table
  and with its order number, and keeps the random identifier phones know it by, so that the poll watcher can cross it
  out and the totals add up. Its new id comes from the old one with the field key, so that the same roll loaded again,
  and a phone prepared before the random identifiers, know it: whoever has that key, which backups carry, can try every
  DNI until theirs matches, in minutes. The purge replaces those ids and the random identifiers with new random ones and
  clears the order numbers.
- The audit log cannot be edited. The one change made to it is the update that replaces the roll ids the first versions
  wrote in it with random references, one per person, and the log records that it was done.
- Each person gets in with a single-use invitation, which becomes a credential for that device. The municipal and national profiles
  also ask for a TOTP code on each device, except for poll watchers, who only see their table.
- On iPhone, the installed app starts with its own empty storage: it gets in with an 8-digit number, single-use and valid for 15 minutes.

## Roll format

A `.padron` file is a ZIP with `manifest.json`, `units.jsonl` (the hierarchy) and `electors.jsonl` (one person per line). The
specification is published in the scanner repository, under CC0.

- Only `id` and `full_name` are required, and `table` is optional: real rolls arrive without tables assigned.
- What a roll carries but does not change who may vote goes in `extra`, and poll watchers do not see it.
- There is no field for political data: the traffic light lives only in the app.
- Doubtful rows are imported flagged for review; they are never silently dropped.
- The app also loads an Excel (`.xlsx`) or CSV spreadsheet: it turns it into a `.padron` in the browser, with the same rules, and does
  not read the columns it does not know. A scanned PDF goes through the roll reader first, on the computer.
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
2. **Core:** visual design, approved before building the screens; format and validator, import, tables, login, poll watcher
   view and basic permissions.
3. **Full election day:** irregularities, daily envelope count, count with photo, chief panel, schedule, several days and
   practice mode.
4. **Compliance:** traffic light, full permissions, audit, security profiles, legal tools, purge, installer, backups and
   installer with its four options, backups and server guides. This is also when a real iPhone gets tested, because there is a
   server with HTTPS by then.
5. **Dry run** with real people and invented data, including restoring a backup on another server.
6. **Landing page:** a static site, with no analytics, forms or cookies, to promote the app and link to the installer.

## Measurements

See [stage-1-results.md](stage-1-results.md) and [stage-4-results.md](stage-4-results.md), which also lists what is left to test.
