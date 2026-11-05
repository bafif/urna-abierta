# Stage 1 results

[Español](../es/resultados-etapa-1.md)

## Sync and app

- On the crossing out rules: 500 random histories, with operations out of order and repeated, always give the same result.
- Against Postgres: with 12 phones writing at once, a reader never skips an operation.
- In a browser, with Chromium and WebKit on mobile profiles, against the real containers and with the network cut: it opens
  without signal, keeps what was marked on reload, syncs on return, respects another poll watcher's mark and offers the
  urgent alert fallback.
- The app weighs 72 KB compressed.

WebKit on Linux is not Safari on an iPhone. The Android emulator and what is left for the iPhone are in
[this guide](phone-tests.md).

## Android, on an emulator

With real Chrome 124, inside an Android 15 emulator, and the signal cut with airplane mode:

| Situation | Result |
|---|---|
| Opening without signal, from scratch | It opens, with the 350 people |
| Restarting the phone, without signal | Everything stays crossed out and unsent |
| Clock moved 9 days ahead, without opening it | Everything stays |
| Disk full, as a user would leave it | It warns and blocks crossing out; the data stays intact |
| Freeing space | The warning goes away by itself in 44 s |
| Signal returns | Everything reaches the server: 24 of 24 |
| Little space, but enough (813 MB) | Works normally, with no false alarms |
| Crossing out with 350 people, CPU 6 times slower | 24 ms median, 78 ms at worst |
| Crossing out with 5000 people, CPU 6 times slower | 28 ms median, 183 ms at worst |

**What this test found:** on a phone with no space, writing to the database breaks it. The screen showed the person crossed out
without having saved it, and after freeing space the database came back empty: the roll and whatever had not been sent were
lost. Without writes, however, nothing is lost. That is why the app now checks for space with a separate write, and stops
crossing out until there is room.

**Limits:** an emulator is not an old phone. Without Google services the app could not be installed, and without installing,
Chrome did not protect the storage; even so, it deleted nothing in this test. A full day of battery was not tested either.

## Server with 1 GB of RAM

Measured in a pod limited with cgroups, with Postgres, server and Caddy inside, and real TLS with one connection per phone.
At rest it uses about 130 MB. The sync column is how long 95% of tables take to catch up.

| CPU | Tables | Situation | Response (p95) | Table caught up (p95) | Retries | Lost or duplicated | Peak memory |
|---|---|---|---|---|---|---|---|
| 0.25 | 10 | Peak hour | 26 ms | | 0 | | 138 MB |
| 0.25 | 50 | Peak hour | 28 ms | | 0 | | 160 MB |
| 0.25 | 200 | Peak hour | 85 ms | | 0 | | 216 MB |
| 0.25 | 200 | Signal returns, spread over 30 s | 776 ms | 2.2 s | 0 | 0 | 228 MB |
| 0.25 | 200 | Signal returns, all at once | 9.4 s | 21 s | 29 | 0 | 329 MB |
| 1 | 500 | Peak hour | 22 ms | | 0 | | 278 MB |
| 1 | 500 | Signal returns, spread over 30 s | 68 ms | 0.15 s | 0 | 0 | 302 MB |
| 1 | 500 | Signal returns, all at once | 6.4 s | 11 s | 0 | 0 | 507 MB |

Peak hour is 120 votes per hour at each table, plus one chief watching every 10 tables. When signal returns, each table sends
100 pending operations. Losses are checked on a sample of 25 tables per run, also sending one batch again to confirm it does
not duplicate.

**Limits of this measurement:** it ran on a desktop computer limited to that CPU, without the latency of a real network. It
has to be repeated on a real free server before publishing a capacity figure.

## Text recognition

I tested on two real scanned rolls, of 89 and 56 pages, that share people. As they are independent scans, their errors are
independent too: crossing them measures quality just by counting, without anyone reading the data. Everything ran in a space
with no network access.

| Engine | Documents that match | Names nearly equal (≥90%) | File numbers that match |
|---|---|---|---|
| Tesseract by columns | 90.5% | 88% | 84% |
| RapidOCR in Spanish, cutting each cell down to its ink | **98.4%** | **97.6%** | **96.7%** |

RapidOCR stayed, with an Apache-2.0 license and no system dependencies. Documents that do not match (1.6%) include people
really present in only one roll, so this is a ceiling on the error of both files together.

- **Completeness:** all 145 pages were read. Compared with the numbering of the roll itself, nobody is missing from one and
  1 person is missing from the other.
- **To review:** the scanner flags between 13% and 14% of rows, mostly for doubtful file numbers.
- **Still to improve:** names match exactly in 88.6%. Most differences are a single letter, between thin letters such as
  `i`, `l` and `t`.
- **First use:** the model downloads from `modelscope.cn` and weighs 47 MB. The download sends no data, but it should ship
  with the scanner so that nothing depends on that site.

A manual check is still missing: this comparison cannot see an error repeated identically in both scans.
