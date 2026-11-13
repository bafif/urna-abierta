# Your first election

[Español](../es/primera-eleccion.md) · [Back to the README](../../README.en.md)

What to do from the moment the installer finishes until you erase the data, and what to do when something fails. What is between quotes
is what the app says, word for word, in English. How to create and maintain the server is in the [servers guide](servers.md), and what
the law asks, in the [personal data](personal-data.md) one.

Before using it in a real election, run a [drill](drill.md).

## 1. Getting in for the first time

The installer ends with “Your Urna Abierta is running”, the “Address” and the “Recovery key”. Keep the key before going on: it is the only
thing that opens your backups. “Open Urna Abierta” opens the app with the installation code already filled in.

In “Let’s create your account” you type your name and phone, tick “I understand that my party is responsible for the data loaded here
and for complying with the personal data law” and tap “Start”. That box is the acceptance of responsibility: the
[personal data](personal-data.md) guide explains it.

- **If you opened the address without that link,** the app also asks for the “Installation code”. It is on the server, in the line
  `URNA_SETUP_CODE` of `/opt/urna-abierta/.env`.
- **Only the first account is created this way.** Everyone else gets in with an invitation.
- **Do it in the browser you will use,** because your access stays in that browser. If you clear its data or lose it, only another person
  with the task “Coordinate with me” can send you a new invitation. That is why it pays to add a second trusted person with that task as
  soon as you build the team.

Your account has the coordination and system tasks, so you see everything below.

## 2. The party, the team and security

The home screen greets you and shows four steps: “Your party”, “Your team”, “Security” and “Your first election”. “Continue” takes you to
the next one. You can close it and go on another day: it remembers where you were.

**Your party.** “What is your party or group called?”. It can be changed later in **More**, **Your party**.

**Your team.** In “Who works with you?”, tap “Add someone”, type their name and phone, and choose what they will do:

| Button | Task | What they can do |
|---|---|---|
| “Watch a table” | Poll watcher | Sees only the roll of their table. Better added from the election, in step 6 |
| “Help several poll watchers” | District chief | Sees their tables and receives their alerts. Better added from “Districts”, in step 5 |
| “Note who votes for us” | Traffic light | Sets up the traffic light categories and notes one per person, sensitive ones included: each time they look at a sensitive one, it is logged |
| “See the numbers” | Statistics | Sees how many voted, never a name |
| “See more tasks”, “Coordinate with me” | Coordination | Builds elections and teams, and handles requests from people. The traffic light does not come with this task: if you want to do it too, add “Note who votes for us” to yourself |
| “See more tasks”, “Look after the system” | System | Users, security and backups. Does not see the roll |

When you tap “Invite”, “Send this to…” appears, with a code to scan and three ways to send the link: “Send by WhatsApp” (if you entered
the phone), “Share” or “Copy the link”. Each link works only once, only for that person, and expires after 14 days.

- **If it did not arrive or has expired,** in “Your team” tap the person and then “Send another invitation”. Whoever has not joined yet
  shows “has not joined yet”.
- **To take someone out,** “Remove from the team”. Their phone stops working the next time it connects.
- **What each task can do** is in “See permissions”, or in **More**, **Permissions**. They come with what is recommended: change them only
  if you have a reason. “Back to what is recommended” undoes the changes.

**Security.** “How delicate is your election?”. This is what each option changes:

| | “University or student union” | “Municipal or provincial” | “National” |
|---|---|---|---|
| The poll watcher sees the document | In full | Its last 3 digits | Its last 3 digits |
| Everyone except poll watchers confirms with a code | No | Yes | Yes |
| Poll watchers can see the traffic light of their table, if you turn it on | Yes | No | No |

With the code, the app shows “One more security step”: each person scans a code with an authenticator app, such as Google Authenticator
or Aegis, and types the six digits. That includes you. While a municipal, provincial or national election is open, the server applies at
least its level and does not let anyone lower it; once it is closed, the one you chose comes back. It is changed in **More**,
**Security**.

## 3. The election

Tap “Create an election”.

1. **“What election is it?”** Choose the type and type what you call it.
2. **“Which days is the vote?”** Tap each day on the calendar. If there are several, the ballot box is closed each night and poll watchers
   count the envelopes at the close of each day.
3. **“What is being voted?”** In “What is being elected”, the office or body; in “The lists, one per line”, the lists. If more than one
   thing is voted, “Something else is voted”. Blank, spoiled and contested votes are already there.
4. **“Create the election”.**

The election shows its steps: “Roll”, “Tables”, “Poll watchers”, “Voting”, “Vote count” and “Closing”. The button for what comes next is
always at the bottom.

## 4. The roll

Tap “Upload the roll”, choose the file and look at what the app understood before tapping “Load it”. Which files work and how a scanned
PDF is read is in [Loading the roll](installation.md#loading-the-roll).

If “N people of the roll need a look” appears, tap it: correct what is wrong or tap “It is fine”.

It is best to upload the final roll before poll watchers prepare their table. If you correct it or upload it again afterwards, the change
reaches the phones that already prepared it the next time they have signal, and the poll watcher sees “The roll of your table was
updated.”. Uploading it again does not undo what you corrected, nor bring back whoever was erased on request.

## 5. Tables and districts

If the roll already had tables, this step is done. If not, the app says “We propose N tables”, by surname: change “People per table” if
needed and tap “That works”. Then tap each table to change its “Name” or fill in “Where it is”, and “Done”.

**Districts.** With few tables you do not need them. Otherwise, in the election tap “Districts”, type the “District name” and tap “Add
district”. Tap the district to choose its tables (a table it already has, tapped again, leaves the district) and to change its name.
“Add its chief”, or “Change the chief” if it has one, shows your team first; “Add someone new” invites them. A district has one chief: the
previous one stays in your team, without that task. While you prepare the election, “Delete the district” takes it out, and its tables are
left with no district. Each chief sees only the tables of their district.

## 6. Poll watchers

Tap “See the poll watchers”. The app says how many tables are missing one. Tap a table without a poll watcher: your team comes first,
starting with the poll watchers who have no table yet. Choose someone and tap “Assign…”. If the person is not in the team yet, tap “Add
someone new”, type who goes and tap “Invite”. If the election lasts several days, you choose which days they go: each day can be a
different person. A table that already has a poll watcher can be tapped too, to take them off (“Take off this table”) or to add another.

When everyone is in, “Invite the poll watchers” makes a new invitation for each poll watcher who has not joined yet: send them one by one
with “Send by WhatsApp”, or all together with “Copy them all”.

Ask poll watchers, one or two days before and with signal, to:

- open their link and tap “Start”;
- tap “Prepare the table”, which downloads the roll to the phone so it works without signal;
- try “Practice”, with invented people;
- on iPhone, add the app to the home screen and get in with the number they get from **Settings**, “Install on the iPhone”. It works for
  15 minutes and only once.

In “Your team” you see who “has not joined yet”.

## 7. Election day

Before starting, download a backup in **More**, **Backups**, and another one each night.

Tap “Open the vote”. From then on, “See how it goes” shows first the tables that need something:

- “urgent alert”: a poll watcher said something is wrong. Tap the table, call them, and once it is solved tap “It is resolved”. With the
  app open, on any screen, a new alert makes the phone vibrate, beeps and shows on the app's icon;
- “envelopes do not match”: when counting the envelopes, the number did not match the crossed-out names;
- “no data”: the table has not sent anything for a while. It may just be missing signal: call the poll watcher.

If all is well, it says “All is well”. “Numbers” shows how many voted, with no names.

## 8. Vote count and closing

When voting ends, “Move to the vote count”. Voting cannot be opened again. Each poll watcher enters the votes one list at a time and takes
the photo of the tally sheet.

If two poll watchers enter different numbers at the same table, “two different vote counts” appears: talk to the table and tap “This one
stands” on the right one.

Before closing, check table by table that the count and the photo are there, and that poll watchers see “Everything arrived”. Then tap
“Close the election”: what arrives later is kept apart and does not count. From then on, poll watchers and chiefs no longer see the roll;
each phone deletes it as soon as it has sent everything, and the poll watcher sees “The election is over. Thank you”.

## 9. Erasing the data

With the election closed, “Erase personal data” erases names, documents, traffic light marks and who voted. Totals remain. It cannot be
undone. What is kept, what happens to the backups and how to delete them is in
[Purging after the election](personal-data.md#purging-after-the-election).

Then remove from the team whoever no longer needs it, and if the server was only for this election, follow
[When the election is over](servers.md#when-the-election-is-over).

## When something fails

A poll watcher without connection keeps working: everything is saved on their phone and sent by itself when signal returns. If something
urgent does not go out, they call: there is no need to wait for the app.

### The server does not answer

You notice because nobody can get in, phones pile up items “not sent” and the panel shows every table with “no data”.

1. Open the address from a computer with internet. If it does not load, the problem is the server.
2. Connect over SSH and run `sudo urna estado`. Each line says `ok`, `note`, `wait` or `FAIL`, and what to do. A `note` is not a
   failure: it is worth knowing, but everything works. It answers in the language of the installer, or in the server's (see
   [Maintaining it](servers.md#maintaining-it)); in Spanish those words are `bien`, `aviso`, `espera` and `FALLA`:

   | It says | What to do |
   |---|---|
   | `FAIL   db`, `server` or `web: it is …` | `sudo urna arrancar` |
   | `FAIL   the server answers: it does not answer` | Look at what the server said last, with the command below |
   | `FAIL   disk: N MB left` | Download the latest backup from the app and delete old backups from `/opt/urna-abierta/copias` |
   | `FAIL   backups: there is no recent one` | `sudo urna copia` |
   | `FAIL   backups in the bucket` | `sudo urna copia`, and look at what it says. [Backups off the server](servers.md#backups-off-the-server) explains it |
   | `FAIL   clock` | `sudo timedatectl set-ntp true`. Without the right time, the certificate and the codes fail |
   | `FAIL   certificate`, and `wait   the server answers: without a certificate` | Open ports 80 and 443 in the cloud, as the [servers guide](servers.md#without-giving-the-installer-any-key) says. Everything keeps running, and the certificate arrives by itself; if the ports were closed for long it can take hours, and `urna reiniciar` asks for it again at once |
   | `FAIL   photos` | [Photos in S3 storage](servers.md#photos-in-s3-storage) explains it |

   To see what the server said last:

   ```sh
   sudo runuser -u urna -- env XDG_RUNTIME_DIR=/run/user/$(id -u urna) HOME=/opt/urna-abierta podman logs --tail 50 urna-server
   ```

   If `urna arrancar` or `urna reiniciar` say “The server stops right after it starts”, they show why. It is almost always a value in
   `/opt/urna-abierta/.env`: fix it and run `sudo urna reiniciar`.
3. If you cannot connect over SSH, check in the cloud console that the machine is on, and restart it from there. Everything comes back by
   itself after a restart. Oracle may reclaim free machines that are not used, and the AWS free account closes when the plan ends.
4. If the machine is lost, install a new one and restore the latest backup, as [Maintaining it](servers.md#maintaining-it) says. If the
   address changes, each poll watcher has to prepare the table again, and what they had not sent stays on their phone with no way out.
   That is why moving servers during the vote is not a good idea.

### A phone does not sync

The poll watcher sees “N not sent. It stays saved and goes out by itself when there is signal.” While it waits, nothing is lost.

1. **Check that it has signal.** In **Settings**, “Status of this phone”, “Connection now”. Try mobile data instead of Wi-Fi, or the other
   way round.
2. **If the other phones send and this one does not,** it may say “This phone no longer has access”: it was removed from the team or its
   invitation was used elsewhere. Send another one from “Your team” and have them tap “I have another invitation”. What was not sent stays
   saved.
3. **If no phone sends,** it is the server: see the section above.
4. **If it says it is running out of space,** they delete photos or videos and tap “Try again”. Meanwhile, they write on paper.
5. **They must never delete the app or the browser data** with items not sent: that does get lost.
6. If the election is already closed, what arrives later is kept apart and does not count.

In **Settings**, “Copy report” builds a technical report of the phone, with no data about any person, that the poll watcher can send you.

### A photo does not go up

The photo stays saved on the phone until it arrives, and counts among what is left to send. The chief sees “A photo of the tally sheet was
announced, but it has not arrived yet. It appears by itself when it does.”

1. The poll watcher leaves the app open for a while with signal. A photo weighs much more than a crossed-out name, and with weak signal it
   takes time. If the phone says “The server did not accept the photo of the tally sheet. Take it again.”, they take another one: the
   rest keeps going out.
2. If no phone's photo goes up, run `sudo urna estado` and look at the `fotos` and `disco` lines.
3. Meanwhile, they take another photo of the sheet with the phone's camera and send it to their chief by WhatsApp. The one in the app keeps
   waiting and gets in by itself.

### The browser warns that the connection is not private

Do not tell anyone to go on anyway. That warning may be someone in the middle, and the app carries names and documents.

- **Right after installing,** the certificate may take a few minutes. Once it is there, `sudo urna estado` says `certificado hasta:` and a
  date.
- **With ports 80 and 443 closed,** the certificate is neither issued nor renewed. The one for an IP address lasts about 6 days and renews
  by itself, so if someone closes a port, it starts warning a few days later.
- **If it warns on a single phone,** check that its date and time are automatic. If it is very old, it may not recognize the certificate:
  have them use another phone.
- **If it warns on all of them,** run `sudo urna estado` and look at the `hora` and `certificado` lines. If you changed the address, or use
  your own domain, check that it points to the server.

### Someone cannot get in

- **“That link was already used or has expired”:** send them another invitation from “Your team”.
- **On iPhone, the installed app starts empty:** in Safari, **Settings**, “Install on the iPhone”, and the number it shows is typed in the
  installed app.
- **“That code is not right”** when confirming with the authenticator app: it is almost always the phone's time. Have them set it to
  automatic.
- **You lost your own access:** another person with “Coordinate with me” sends you a new invitation. If nobody else has that task, there
  is no way back in from the app.

## Limits of this version

A new version may solve some of them: check its notes.

- With the app closed or the phone locked, an urgent alert does not beep: while people vote, keep it open.
