# Test on real phones

The one thing a computer cannot test is what a real phone does with the app: whether it keeps it after a restart,
whether it deletes it after several days, and whether it runs well on an old device. The test app uses invented people
and never sends a report by itself.

## What you need

An old Android phone and an iPhone. Both must open the app over HTTPS, except for Android over USB.

- **Android over USB, publishing nothing:**

  ```sh
  deploy/serve.sh
  adb reverse tcp:8090 tcp:8090
  ```

  With the app running on the computer, open `http://localhost:8090` in Chrome. For the phone, `localhost` counts as a
  secure connection.

- **iPhone (or any phone):** publish the `apps/web/build` folder on a site with HTTPS. Without a server the app uses the
  same invented roll and keeps items pending, which is enough for this test. If the folder sits under a path, build with
  `BASE_PATH=/path corepack pnpm --filter @urna-abierta/web build`.

## The steps

Do them on each phone. At the end of each day, under **Status**, tap **Copy report** and keep it.

| When | What to do | What must happen |
|---|---|---|
| Day 1, with signal | Install the app. On Android with **Install the app**; on iPhone with Share and **Add to Home Screen**. Open it from the icon | **Installed** says “yes” |
| Day 1 | Choose 350 people and tap **Prepare table** | **350 of 350 left**. Check whether **Protected storage** says “yes” |
| Day 1 | Turn on airplane mode, close the app and open it | It opens anyway, with the 350 people |
| Day 1 | Cross out 20 people quickly, search for `nunez` and cross out one more | Each tap responds without delay; the search finds “Núñez” |
| Day 1 | Restart the phone, without signal, and open the app | They remain crossed out, **Data intact** says “yes” |
| Day 1 | Under **Urgent alert**, enter a test number and report | Call, WhatsApp and SMS appear, and each button opens what it says |
| Day 1 | Go back to **Table**, leave it as it is, and turn airplane mode off | With a server: **Everything sent**. Without one: they stay pending |
| Day 4 | Open the app without signal | Everything is still there. This is the real length of a three-day election |
| Day 9 | Open the app without signal, not having opened it since day 4 | Everything is still there. This gets past Safari's 7-day rule |
| After | Repeat with 5000 people on the oldest phone | Crossing out and searching still work well |

## How to decide

- If everything is still there on day 9 on both phones, the web app is enough.
- If the iPhone deletes data while installed, or if **Protected storage** stays at “no” and data is also lost, it has to
  be packaged with Capacitor before going on.
- If crossing out takes more than 200 ms on the oldest phone, the interface has to get lighter.
