# Drill

[Español](../es/simulacro.md) · [Back to the README](../../README.en.md)

Before using Urna Abierta in an election, run a drill with real people and invented data. Each of these points is something an automated
test cannot answer.

You need: an installed server, an invented roll, and at least six people with their own phones, two of whom have never seen the app.
Set aside two hours.

## Prepare

- [ ] Install on a new server, with the installer. Note how long it took.
- [ ] Build the invented roll: `deploy/serve.sh` does not work for this, because it uses a test database. Generate a CSV with invented
      names and documents starting with 99.
- [ ] Create the whole election from the app: party, team, days, lists, roll, tables.
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

## Recovering from a disaster

The most important part of the whole drill.

- [ ] Download a backup from the app.
- [ ] Delete the server, for real.
- [ ] Install a new one and restore the backup with the recovery key.
- [ ] Check that the election, the crossed-out names, the photos and the permissions are there. Measure how long it all took: that is your real recovery time.
- [ ] If the address changed, each poll watcher has to prepare the table again. Measure how long that takes with the whole team.

## Finishing

- [ ] Close the election and purge it. Check that no name is left: search for one in **Requests from people**.
- [ ] Delete the server. Check in the cloud console that nothing is left charging.

## What to write down

Where each person hesitated, how long each thing took and what broke. If a new person got stuck, the problem is the app's.
