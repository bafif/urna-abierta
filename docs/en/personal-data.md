# Personal data

[Español](../es/datos-personales.md) · [Back to the README](../../README.en.md)

> **Draft.** A lawyer has to review it before you rely on it. It is not legal advice: it sums up the law and explains what the app does,
> so that you reach that consultation with clear questions. The law is Argentine and its official text is in Spanish.

This guide is for whoever runs Urna Abierta in a party. It says what Law 25.326 asks, which tool in the app serves each purpose, and how
far each one goes.

**Your party is the one responsible.** The project hosts no data and has no access to your server. Whoever installs the app accepts it on
the first screen, with the box “I understand that my party is responsible for the data loaded here and for complying with the personal
data law”. What is loaded, who sees it, where the server is and when it is erased is up to the party. The
[legal information](../../LEGAL.en.md) has the rest.

## What data the app keeps

| What | Where it comes from | Who sees it |
|---|---|---|
| Roll: name, document, student number, order number, table and address, if the file has them | The file you upload | Coordination sees everything. The poll watcher sees only their table until the election is closed and, depending on security, the full document or its last 3 digits. Their phone knows each person by a random identifier, never by their document |
| Who voted and at what time | The poll watchers' phones | The poll watcher of that table, and coordination when handling a request. Everyone else sees only how many |
| Traffic light: one category per person | Whoever notes down in the traffic light | Whoever has that task. Sensitive categories, only whoever has the separate permission |
| Consent: date and how it was given | You enter it | Coordination |
| Team: name and phone of each person, and their devices | You enter it when adding someone | Coordination and system |
| Log: who did what and when | The server, by itself | Coordination and system |
| Photos of the tally sheets | The poll watchers | The chief of that table and coordination |
| Backups: all of the above | The server, every 6 hours. If you set up S3 storage, they also go there | Whoever holds the recovery key |

The server checks every request and hands over only what that person may see. What each task can do is in **More**, **Permissions**.

## What the law asks

- **Sensitive data.** Political opinions and affiliation are sensitive data (art. 2). Nobody is obliged to give them, and the law forbids
  building files that reveal them, except a political organization's register of its own members (art. 7). A traffic light that notes
  whom a person votes for records a political opinion.
- **Consent.** It has to be free, express and informed, in writing or by an equivalent means (art. 5). It is not needed for a list
  limited to name, document, tax or social security number, occupation, date of birth and address (art. 5, sec. 2, c). The
  [AAIP guide for electoral purposes](https://www.boletinoficial.gob.ar/detalleAviso/primera/208934/20190605)
  (Resolution 86/2019) allows processing political opinions with the consent of the person.
- **Inform when asking for data.** What it is used for, who is responsible, whether the person may refuse and how to exercise their
  rights (art. 6).
- **The person's rights.** To access what is held about them (art. 14), clearly and free of codes (art. 15), and to ask for it to be
  corrected or erased (art. 16). It is free (art. 19).
- **Deadlines.** For access, 10 calendar days from the person's formal request (art. 14). To correct or erase, 5 business days from
  receiving the request (art. 16).
- **Security and confidentiality.** Whoever is responsible has to protect the data (art. 9), and whoever sees it has to keep it secret
  (art. 10). The AAIP published recommended security measures in Resolution 47/2018.
- **Erase what is no longer needed.** Data is destroyed once it is no longer needed for the purpose it was collected for (art. 4, sec. 7).
- **Servers in another country.** International transfer is restricted (art. 12). Free servers are usually outside Argentina: the
  [legal information](../../LEGAL.en.md#personal-data-in-argentina) explains it.
- **Registering the database.** A data file is lawful when it is registered (arts. 3 and 21).

The full text is in [Law 25.326](https://www.argentina.gob.ar/normativa/nacional/ley-25326-64790). The AAIP explains people's rights on
[its page](https://www.argentina.gob.ar/aaip/datospersonales/derechos).

## Registering the database with the AAIP

It is done online, in Trámites a Distancia (TAD), in two steps: first the responsible party is registered, then the database.

1. **The responsible party.** [Inscribir un responsable de bases de datos personales privadas](https://www.argentina.gob.ar/servicio/inscribir-un-responsable-de-bases-de-datos-personales-privadas).
   At the end you get a responsible party code: keep it, because any later procedure asks for it.
2. **The database.** [Registrar bases de datos personales privadas](https://www.argentina.gob.ar/registrar-bases-de-datos-personales-privadas).

Every procedure of the registry, including changes and deregistration, is on
[Trámites ante el Registro Nacional de Bases de Datos Personales](https://www.argentina.gob.ar/aaip/datospersonales/tramites).
That page asks for a tax login (clave fiscal) to register a legal entity. The forms, the documents to attach and whether there is any fee
may change: confirm them there before you start. This guide does not copy them, so that it does not go out of date.

Before you start, it helps to have written down:

- what the database is for (organizing the poll watchers of an election, and the traffic light if you use it);
- what data it holds, with the table above;
- where the server is: the provider and the country;
- who has access: the app's tasks and how many people have each one;
- what security measures it has: those in [Security of the installation](#security-of-the-installation);
- when it is erased: the date you will purge.

Questions for the lawyer:

- If the party or group has no legal personality, as many student groups do, who registers as the responsible party?
- Is the database private, or public non-state?
- If the same server is used for several elections, is it one database or one per election?

## Handling a person's request

It is in **More**, **Requests from people**, and whoever has the task “Coordinate with me” sees it. Every search, download, correction or
erasure goes into the **Log**, with who did it and when.

1. **Check who is asking.** The app does not: ask for their ID in person or through a channel you trust. Giving someone's data to another
   person is worse than not answering.
2. **Find them.** Type at least three letters of the surname, or the document, and tap “Search”. It searches every election that was not
   purged, and shows up to 25 people, each with their election. If they appear in several elections, handle each one.
3. **If they ask to see their data.** Tap “Download everything we hold”. A page downloads, in the language of the screen, to send or
   print: their roll data, where they vote, whether they voted, their traffic light category, their consent and their rights. Deadline:
   10 calendar days.
4. **If they ask to correct it.** In “Correct their data”, change the name or the document and tap “Save the correction”. Deadline: 5
   business days.
5. **If they ask to erase it.** Tap “Erase their data” and confirm. Their name, document, student number, address, consent and traffic
   light mark are erased. The row stays anonymous, as “Borrado a pedido” (erased on request), so that the table's totals still add up.
   Deadline: 5 business days.
6. **Answer them in writing,** with the date. The app's log keeps that it was done, but not what you answered.

Three things to keep in mind:

- **The page covers a single election.** If the same document is in other rolls, the page names them: handle each one. A sensitive
  category shows only if whoever downloads the page has the task “See the sensitive categories”; otherwise the page says there is one
  and that someone with that permission has to prepare it.
- **A correction or an erasure reaches the phones that already prepared the table** the next time they have signal: each one checks every
  5 minutes whether the roll of its table changed, and downloads it again. Uploading the roll again undoes neither corrections nor
  erasures.
- **Each phone deletes its roll when the election is closed,** as soon as it hears so and has sent everything. A phone that does not hear
  it, for lack of signal, deletes it after 6 in the morning of the day after the last voting day, plus the hours the security level allows:
  12 in a university election, 6 in a municipal or provincial one, none in a national one.
- **The law has cases where erasure does not apply** (art. 16, sec. 5). If someone asks to leave the roll during the vote, ask before
  touching anything.

## Consent

On the same person screen, under “Consent”, you enter the “Date” and “How it was given”, and tap “Save”. It goes into the log as
“Recorded a consent”.

- **When it is needed.** For the traffic light, if it notes political opinions. A roll with only name, document and address falls under the
  exception of art. 5; if it has a student number or other data, ask the lawyer.
- **What to write in “How it was given”.** Where the proof is, for example “signed form, at the office” or “message of 3 April to the
  party's phone”. The app keeps only the date and the means: the proof is kept elsewhere.
- **What to tell them when asking.** What it is used for, that the party is responsible, that they may refuse, and how to ask to see,
  correct or erase their data.
- **If they withdraw it.** Someone with the traffic light task removes the category with “Remove the category”, or use “Erase their data”,
  which also erases the mark.

## The traffic light and sensitive categories

The traffic light starts empty: each party defines its categories in **More**, **Traffic light**. When creating one, the box “It is
sensitive: it says something about their ideas or affiliation…” makes it:

- visible only to whoever has the task “See the sensitive categories”;
- logged as “Looked at sensitive categories” each time someone looks at it;
- changed or removed only by whoever has that task;
- stored encrypted in the database, with a key that is not in the database.

The safest choice is not to note the political opinions of anyone who has not consented. If you use sensitive categories, record each
person's consent before noting them down.

The box “Let each poll watcher see these categories in the roll of their table” can only be used with the university security level, and
never includes the sensitive ones.

## Purging after the election

Once the election is over, “Close the election” and then “Erase personal data”. The app asks “Erase names, documents and marks for good?
Only totals remain. This cannot be undone.” The election becomes “Finished, no personal data left”.

| Erased | Kept |
|---|---|
| Names, documents, student numbers and addresses of the roll, and each person's identifiers and order numbers | Each table's totals: envelopes and vote count |
| Traffic light marks and consents | The photos of the tally sheets |
| Who voted and at what time | The team: name and phone of each person |
| | The log, which names each person by a reference that no longer leads to anyone |
| | Backups made before, until they rotate |

- **Decide the date before the election,** with the lawyer: for example, once no claim about the result is possible anymore. The app does
  not remind you, so put it in your calendar.
- **Purging does not erase the team.** When you no longer need them, remove each person with “Remove from the team”. That cuts their
  access, but their name and phone stay in the database until you delete the server.
- **If the server was only for this election,** deleting it is the most thorough step: the
  [servers guide](servers.md#when-the-election-is-over) explains it.

## Backups

The server makes a backup every 6 hours, encrypted with the recovery key, and keeps the last 28: one week. They live on the same server,
in `/opt/urna-abierta/copias`, and the app cannot delete them. If you set up S3 storage, each backup also goes to the `backups/` folder
of the bucket, which keeps the newest 28 (the [servers guide](servers.md#backups-off-the-server) explains it). Each backup carries the
whole database, the photos on disk and the key that opens the sensitive categories.

**Purging or erasing a person does not touch the backups.** Their data stays there until those backups rotate, a week later, and in every
backup you downloaded to a computer, for good.

To avoid waiting that week, after purging and once you are sure you will not need to go back:

1. Connect to the server over SSH and list the backups: `sudo ls -l /opt/urna-abierta/copias`. The time in the name is UTC: three hours
   ahead of Argentina.
2. Delete the ones from before the purge, one by one: `sudo rm /opt/urna-abierta/copias/urna-YYYYMMDD-HHMMSS.tar.gpg`. If backups go to
   a bucket, delete them there too, from the provider's page.
3. Make a new backup, now without personal data: `sudo urna copia`.
4. Delete the backups you downloaded from the app, from your computer and from any cloud drive or trash where you put them.

The trade-off: without those backups you cannot go back to the state before the purge. How many backups are kept is set with the line
`URNA_BACKUPS_KEPT` in `/opt/urna-abierta/.env`.

If you restore a backup from before a person was erased, that person comes back: erase them again, with the record of the request you
already had.

## Security of the installation

- **Each person gets in with their own single-use link,** which expires after 14 days. There are no passwords to guess or share.
- **The security level** is chosen in **More**, **Security**. In a municipal, provincial or national election, everyone except poll
  watchers confirms with a code from an app such as Google Authenticator or Aegis, and the poll watcher sees only the last 3 digits of
  each document. While an election of that kind is open, the server applies at least that level and does not let anyone lower it.
- **The log cannot be changed from the app,** and the database refuses to edit, delete or empty it. It records downloads of the roll, of
  people's data and of backups, and who searched for or looked at whom, by a random reference, without names or documents.
- **Backups are encrypted,** and they do not open without the recovery key.
- **Tell poll watchers and chiefs that what they see is confidential** (art. 10), and remove from the team whoever no longer needs it.

## Limits of this version

This list is from November 2026. A new version may solve some of them: check its notes.

- Until the purge, the internal identifier of an erased person comes from their document with the field key, so that they are known
  again if the roll is uploaded again. Whoever has that key, which travels in the backups, can try every document until theirs matches.
  The erased row stays at its table and with its order number, without name or document, until the purge.
- Correcting a person's document does not change their internal identifier, which often carries the document the file had: the old one
  stays there until they are erased or the election is purged.
- A category can be marked sensitive only when it is created, and a person gets a single task from the app.
- Consent cannot be withdrawn or cleared from the app: it is replaced by another one, or the data is erased.
- The encryption of sensitive categories protects a copy of the database taken without the `.env` file. It does not protect a copy of the
  whole disk, nor a backup opened with the key, because the key travels with them.
- Backups leave the server by themselves only if you set up S3 storage, and one over 5 GB does not fit. Otherwise, to have one elsewhere,
  download it from the app.
