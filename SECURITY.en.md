# Security

[Español](SECURITY.md) · [Back to the README](README.en.md)

## How to report a flaw

Privately, never in a public issue: a flaw published before it is fixed puts at risk the data of the parties that already use the app.

Use GitHub's private reporting: in the repository's **Security** tab, **Report a vulnerability**, or straight at
[github.com/bafif/urna-abierta/security/advisories/new](https://github.com/bafif/urna-abierta/security/advisories/new). Only you and I
see what you write there.

Say which part it is, in which version or commit, how to reproduce it and what whoever exploits it gets. Use invented people: never send a
real roll, nor parts of one.

If that option does not show up, open an issue saying only that you want to report a security flaw, with no details at all, and I will
answer to continue privately.

## What happens next

I do this alone, so there are no guaranteed deadlines. I confirm that I got it, fix it privately and publish the advisory together with
the version that fixes it, with your name if you want. Please do not disclose it until then.

## In scope

- The server and the app: `apps/server`, `apps/web` and `packages/domain`.
- The installer, `apps/installer`, and what it leaves on the server: `deploy/server/instalar.sh`, `deploy/server/urna`, Caddy and the
  containers.
- The release process: any way for someone to receive an installer or an image that did not come from this repository.
- Someone seeing or changing something their task does not allow: a poll watcher who sees another table, someone who reads a sensitive
  category without the permission, a log that can be erased.
- What stays stored on a poll watcher's phone, for example if it is lost or stolen.
- The landing page, `landing/`.

The roll reader has its own repository, [urna-abierta-padrones](https://github.com/bafif/urna-abierta-padrones): report there, the same
way.

## Out of scope

- **The project has no servers or data of its own.** There is no central server, no telemetry and no project accounts: there is nothing
  of the project to attack. Each server belongs to a party, so do not test against one that is not yours. For testing there is
  `deploy/serve.sh`, with invented people, or the installer's “Try it on this computer” option.
- Each party's configuration: their cloud account, their keys, a hand-edited `.env` or a leaked recovery key.
- Flaws of the cloud providers, of GitHub or of a dependency that are already public: tell them. If they affect Urna Abierta in a way of its
  own, do report here.
- What anyone holding an unlocked phone with the app open can see: it is the same as its poll watcher sees.
- Flooding a server with traffic.
- Reports from automated tools without a concrete case.

## Versions

There is no published version yet. Fixes always go to the `main` branch and to the latest published version.
