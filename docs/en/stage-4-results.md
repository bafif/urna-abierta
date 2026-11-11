# What was tested, and what is left

[Español](../es/resultados-etapa-4.md) · [Initial risks](stage-1-results.md) · [Back to the README](../../README.en.md)

Measurements with invented people. All of it can be repeated with the commands of each section.

## What is left to test

This needs a cloud account, a public address, another device or real people. Until it is tested, it is not proven:

| What | Why it is missing | What was done meanwhile |
|---|---|---|
| Creating servers on Oracle, AWS and Google | It takes an account on each | Tested against simulations of each API. The AWS signature matches its official test suite |
| A Let's Encrypt certificate for an IP | It takes a public address | Caddy understands the configuration. Tested with an internal certificate |
| A real free server | The same | Measured within those limits, on a desktop computer |
| The installer on Windows and macOS | It takes a computer with each system | On every change, GitHub Actions builds it, unpacks it and starts it on Windows, Linux and both Macs |
| A real iPhone | There is no emulator for Linux | Tested with WebKit, which reproduces neither the installation nor Safari's deletion after inactivity |
| Real people | That is the [drill](drill.md) | Nothing replaces it |

## The whole journey, in the browser

`deploy/e2e.sh`, against the real containers, on Android Chrome and iPhone WebKit: 46 tests pass, and 2 are skipped
because they only apply to one browser. The longest is an entire election: from creating it to erasing the names, with the
roll, the tables, each poll watcher with their link, the crossed-out names, the envelopes, the count, the photo of the sheet
and the coordinator's panel.

## Really installing it

`node apps/installer/e2e/servidor.ts`, on two Ubuntu machines in containers, with the real installation over SSH:

| Check | Result |
|---|---|
| Installs over SSH and starts | Yes |
| Uses the chosen theme, and the first administrator only gets in with the code | Yes |
| The backup lets no name be read, and it downloads from the app | Yes |
| With another key, the backup does not open | Yes |
| Restored on another server, everything is there, with the same sessions and sensitive categories readable | Yes |
| After a reboot, it comes back by itself | Yes |

`deploy/e2e-instalador.sh` goes through the installer's screens in a browser, from the first one to the first
administrator in the app: 7 of 7, in about 25 seconds.

## An Android phone

`apps/web/e2e-android/check.mjs`, on Chrome in an Android emulator: 14 of 14.

| Check | Result |
|---|---|
| Opens with no signal, from scratch | Yes |
| Survives a reboot and moving the clock 9 days ahead | Yes, with data intact |
| With no room, it warns and does not let you cross out. Once freed, everything continues | Yes |
| When signal returns, everything reaches the server | 26 of 26 operations |
| Crossing out with 350 people and a CPU 6 times slower (median / worst) | 26 ms / 84 ms |
| Crossing out with 5,000 people and a CPU 6 times slower (median / worst) | 35 ms / 77 ms |

## The server with 1 GB

`deploy/measure.sh`, in a pod limited to 1 GB of memory and a quarter of a processor, with Postgres, server and Caddy
inside, real TLS and one connection per phone. Each table has 350 people. Peak hour is 120 votes an hour per table and one
chief per 10 tables, who looks at their panel every 20 seconds. When signal returns, each table sends 100 pending
operations.

| Tables | Situation | Response (p95) | Table up to date (p95) | Retries | Lost or duplicated | Peak memory |
|---|---|---|---|---|---|---|
| 100 | Peak hour | 116 ms | | 0 | | 292 MB |
| 100 | Signal returns, spread over 30 s | 194 ms | 0.5 s | 0 | 0 | 325 MB |
| 100 | Signal returns, all at once | 9.1 s | 16 s | 9 | 0 | 372 MB |
| 200 | Peak hour | 107 ms | | 0 | | 453 MB |
| 200 | Signal returns, spread over 30 s | 1.2 s | 2.6 s | 0 | 0 | 461 MB |
| 200 | Signal returns, all at once | 9.9 s | 35 s | 164 | 0 | 463 MB |

At rest it uses 185 MB. It never ran out of memory in any run. Compared with
[stage 1](stage-1-results.md#server-with-1-gb-of-ram), which had no login, peak hour stays the same; when 200 tables
return at the very same instant it takes longer: 35 s against 21 s. That is the worst possible case, because real phones
spread their wait at random.

**Limits of this measurement:** it ran on a desktop computer limited to that CPU, with no real network latency. It has to
be repeated on a real free server before publishing a capacity figure.

## Decisions that came out of these tests

- **The photo of the sheet is stored on the phone as bytes,** not as a `Blob`: WebKit refuses to store a `Blob` in the
  browser's database.
- **The server remembers sessions and the election's status.** Without that, with login and 200 tables at peak hour, p95
  went from 85 ms to 2.2 s; with it, it stays at 107 ms.
- **A silent table is only flagged while voting is on and if it did not close its day.** Otherwise, at night every table
  would look silent.
- **The single executable is built with Node's official binary, on GitHub Actions.** With the Node some Linux
  distributions package, it crashes with a segmentation fault.
