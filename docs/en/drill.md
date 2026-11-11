# Drill

[Español](../es/simulacro.md) · [Back to the README](../../README.en.md)

Before using Urna Abierta in an election, run a drill with real people and invented data. Each of these points is something an automated
test cannot answer.

You need: an installed server, an invented roll, and at least six people with their own phones, two of whom have never seen the app.
Set aside two hours.

## Prepare

- [ ] Install on a new server, with the installer. Note how long it took.
- [ ] Build the invented roll: `node deploy/padron-inventado.mjs 350 > roll.csv`. Do not use `deploy/serve.sh`, which is a test database.
- [ ] Create the whole election from the app: party, team, days, lists, roll, tables.
- [ ] Correct what was set up: move where a table ends by surname, move one person alone to another table, and review the doubtful rows.
- [ ] In **Change the details**, set the voting hours. From a poll watcher's card, give them a shift, an arrival time and a meeting point,
      and look at the **Schedule**: does it read well printed?
- [ ] Send the invitations through the channel you actually use.

## First use

- [ ] Two people who have never seen it open their link **with nobody explaining anything**. Do they reach the roll by themselves? Note where they hesitate.
- [ ] Try it on their own phones, with at least one iPhone and one old Android among them.
- [ ] On iPhone: add to home screen, and get in with the number.
- [ ] Try changing the theme and the language.

## Voting

- [ ] Everyone prepares the table with signal, and then turns on airplane mode.
- [ ] Cross out 30 people in a row, searching by surname and by number. One person dictates fast, as in a real line.
- [ ] Someone crosses out a person by mistake and undoes it.
- [ ] Two poll watchers of the same table cross out the same person, with no signal. Then signal returns: they have to stay crossed out once.
- [ ] Reboot a phone with no signal: everything has to still be there.
- [ ] Someone sends an alert with no signal: do they understand what to do? Do they call?
- [ ] Signal returns. The district chief sees the alert and resolves it.
- [ ] A table stays with no signal for half an hour: the chief has to see it as "no data".
- [ ] Turn off the server for 10 minutes in the middle of the vote, and turn it back on. Nobody should notice, except for what is left to send.

## Closing

- [ ] Each poll watcher counts the envelopes. One table enters a number that does not match: does the poll watcher notice? Does the chief see it?
- [ ] They enter the count one list at a time and take the photo of the sheet, with good and bad light.
- [ ] Two poll watchers enter different numbers at the same table: the chief has to choose which one stands.
- [ ] The chief's panel turns to the **Count**: a bar of how many tables loaded everything, and first those that need someone. With **See
      the totals** they see their district's results; coordination sees the whole party's and downloads the spreadsheet.
- [ ] A poll watcher corrects their count from the plan: the chief has to choose again.
- [ ] After the election closes, a poll watcher who was without signal sends their count. Their phone has to say it arrived late, and
      coordination sees it in **Things arrived after the close**, where they add it or discard it.

## Recovering from a disaster

The most important part of the whole drill.

- [ ] Download a backup from the app.
- [ ] Delete the server, for real.
- [ ] Install a new one and restore the backup with the recovery key.
- [ ] Check that the election, the crossed-out names, the photos and the permissions are there. Measure how long it all took: that is your real recovery time.
- [ ] If the address changed, each poll watcher has to prepare the table again. Measure how long that takes with the whole team.

## Law and security

How each tool is used is in the [personal data](personal-data.md) guide.

- [ ] A person asks for their data. In **Requests from people**, find them, tap “Download everything we hold”, correct their document,
      record a consent and erase their data. Measure how long each step took: the law's deadlines are 10 calendar days and 5 business
      days. Can what was downloaded be understood without explanation?
- [ ] The **Log** shows the search, the download, the correction, the consent and the erasure, with who did each.
- [ ] In the **Log**, type that person's surname: everything about them has to stay, with how many times their data was seen and changed.
      Download it as a spreadsheet.
- [ ] Record a consent for someone with a traffic light mark, then **They took their consent back**: their mark has to go right then.
- [ ] From “Note who votes for us”, create a traffic light category marked as sensitive and note someone with it. Whoever has that
      task sees it, and the log says “Looked at sensitive categories”. Nobody else must see it: not coordination, not a district
      chief, not statistics.
- [ ] Download the roll of a table by preparing it from a phone, and a backup from the app: the log has to say who did it.
- [ ] Switch security to “Municipal or provincial”. Everyone except poll watchers has to confirm with a code, and the poll watcher has to
      see only the last 3 digits of each document. Then switch back.
- [ ] Remove a person from the team: the next time their phone connects, it has to say “This phone no longer has access”.
- [ ] After closing the election, a poll watcher tries to cross someone out and to prepare the table again. Write down what happens:
      nothing they send may count.

## Finishing

- [ ] Close the election and purge it. Check that no name is left: search for one in **Requests from people**.
- [ ] Check that no document is left in the database. The invented roll's documents start with 9900, so this has to answer `0`:

      ```sh
      sudo runuser -u urna -- env XDG_RUNTIME_DIR=/run/user/$(id -u urna) HOME=/opt/urna-abierta \
        podman exec urna-db pg_dump -U urna urna | grep -cw '9900[0-9]\{4\}'
      ```

      If it gives more, it is a bug in the app: write it down and report it as the [security policy](../../SECURITY.en.md) says.
- [ ] Delete the backups from before the purge, on the server and on your computer, as [Backups](personal-data.md#backups) says.
- [ ] Delete the server. Check in the cloud console that nothing is left charging.

## What to write down

Where each person hesitated, how long each thing took and what broke. If a new person got stuck, the problem is the app's.
