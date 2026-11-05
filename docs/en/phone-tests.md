# Testing on a phone, from a computer

[Español](../es/pruebas-en-telefonos.md)

Nothing has to be published. The test app uses invented people and never sends a report by itself.

## Seeing it at phone size

```sh
deploy/serve.sh
```

It gives you a link per role. Open the poll watcher's in the browser of the computer and turn on device mode with F12. This is good
for trying the interface, not for learning what a real phone does.

## Android, on an emulator

```sh
deploy/android-emulator.sh
```

The first time it downloads about 5.5 GB and accepts the licenses of the Android SDK. A window opens with the phone: in its
Chrome, open the link `deploy/serve.sh` gave you. To cut the signal, turn on airplane mode and run:

```sh
~/.local/share/urna-abierta/android-sdk/platform-tools/adb reverse --remove-all
```

This is needed because the emulator reaches the app through a tunnel that airplane mode does not cut.

It can also run entirely without a window. It tests no signal, a restart, the clock moved 9 days ahead, an almost full disk
and a slow phone:

```sh
deploy/android-emulator.sh --headless
ADB=~/.local/share/urna-abierta/android-sdk/platform-tools/adb node apps/web/e2e-android/check.mjs results.json
```

## iPhone

There is no iPhone emulator for Linux: Apple's only runs on a Mac. The WebKit tests are the closest thing, but they reproduce
neither the installation nor the Safari rule that deletes a site's data after 7 days of use without visiting it.

That is why the iPhone gets tested with a server with HTTPS, where opening the link is enough. **That test is pending.** Meanwhile, the
risk is limited: a three-day election, with the table prepared the day before, does not reach those 7 days. If it still
loses data, what was sent remains on the server and the poll watcher prepares the table again.

At that point, these are the steps:

| When | What to do | What must happen |
|---|---|---|
| Day 1, with signal | Open the link, tap **Prepare the table**, follow the steps to add it to the home screen and open it from the icon | It gets in with the number it showed. In **Settings**, **Installed** says “yes” |
| Day 1 | Tap **Prepare the table** | In **Settings**, check whether **Protected storage** says “yes” |
| Day 1 | Turn on airplane mode, close the app and open it | It opens anyway |
| Day 1 | Cross out 20 people and restart the phone | They remain crossed out and **Data intact** says “yes” |
| Day 9 | Open it, not having opened it before | Everything is still there |

## How to decide

- If everything is still there on the iPhone on day 9, the web app is enough.
- If it deletes the data while installed, the choice is between packaging it, which takes a Mac and a paid account, or telling
  people to prepare the table the day before on an iPhone.
- If crossing out takes more than 200 ms on a slow phone, the interface has to get lighter.
