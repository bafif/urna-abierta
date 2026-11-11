# Legal information

[Español](LEGAL.md) · [Back to the README](README.en.md)

> **Draft.** A lawyer still has to review it before the app is used in an election. This is not legal advice. If you are going to use
> Urna Abierta, consult a professional about your case.

## License

Urna Abierta is published under the [GNU AGPL-3.0-or-later](LICENSE), whose official English text is what applies. This document helps
to understand it and does not replace it.

**No warranty and no liability.** The license states that the program is provided “as is”, with no warranty of any kind, and that its
authors are not liable for damages resulting from its use, to the extent permitted by applicable law. Sections 15 and 16 of the license
have the details.

**If you modify it.** If you offer a modified version over a network, you must offer its source to whoever uses it, including your poll
watchers.

## The project does not touch your data

Urna Abierta is a program each party installs on its own server. The project and its author:

- host no data from any party;
- have no central server and no telemetry, and the app sends them nothing;
- have no access to your server or your rolls;
- do not control what each party enters.

The example screens in this repository show invented people. No real roll is part of the project.

## Who is responsible

**The party or group that installs the app is responsible for its database and for complying with the law.** Its administrator accepts
this when installing it. That includes deciding what is entered, who sees it, where the server is and when it gets deleted.

## Personal data in Argentina

A roll holds names and identity documents. The traffic light may also record how a person votes. These points are not exhaustive, but they
are worth knowing:

- [Law 25.326](https://www.argentina.gob.ar/normativa/nacional/ley-25326-64790) treats political opinions as sensitive data (art. 2) and
  forbids creating files that reveal them (art. 7), except for the records of a political organization's own members.
- The AAIP guide for electoral purposes (Resolution 86/2019) allows processing them with the consent of the data subject. Keeping the data
  private changes none of this.
- People have the right to access, correct and delete their data (arts. 14 to 16).
- International data transfers are limited (art. 12). **Free servers are usually outside Argentina**, and the United States, Brazil and
  Chile are not on the list of adequate countries in Disposition 60-E/2016.
- The database may have to be registered with the AAIP.

How to register it, how to handle each request and what the backups keep is in the
[personal data guide](docs/en/personal-data.md).

## Tools to comply

The app brings optional tools. Using them is up to each party, and having them does not guarantee legal compliance:

- recording each person's consent, with date and means;
- marking traffic light categories as sensitive, with a separate permission;
- finding, exporting, correcting and deleting everything about a person;
- deleting or anonymizing the roll after the election;
- a log of who saw and changed what.

The traffic light starts empty: each party defines its categories.

## External artificial intelligence

The roll scanner reads on your computer by default, and for now that is the only option. If you later choose an external
AI, the data of the roll goes through that company, with your account and under its terms, and some free plans train on
what they receive. No roll goes through an account or a server of the project.

## Third parties

Cloud providers are named only for guidance: the project has no relationship with them. You accept their terms, with your account. The fonts
are under the SIL OFL, included next to each one in `apps/web/src/lib/fuentes/` and `landing/fuentes/`.
