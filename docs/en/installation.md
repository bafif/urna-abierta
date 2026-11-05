# Installation

[Español](../es/instalacion.md) · [Back to the README](../../README.en.md)

**It cannot be used in a real election yet.** Today's version has no login and uses invented people. This page explains how to try
it, and what installation will be like once it is ready.

## Try it today

You need Node 24 and Podman.

```sh
git clone https://github.com/bafif/urna-abierta
cd urna-abierta
corepack pnpm install
deploy/serve.sh
```

Open `http://localhost:8090`. To see it as on a phone, turn on device mode with F12, or follow the
[test on an Android emulator](phone-tests.md).

To see the design proposal, just open `design/index.html` in a browser.

## What it will be like

You will download an installer from the GitHub releases page, for Windows, macOS or Linux. It asks three questions and does the rest.

**1. Where will your Urna Abierta live?** Any of these options works:

| Option | What you need |
|---|---|
| Create a new server | An account on Oracle Cloud, AWS or Google Cloud. We guide you through creating it |
| I already have a server | Its address and an SSH key |
| Paste a text | Paste a block when creating the server, without giving the installer any credential |
| Try it on this computer | Nothing. It can only be seen from there |

**2. How do we read scanned rolls?** On your computer, which is recommended because a roll holds personal data; with your own AI,
pasting your key; or you decide later.

**3. How do you want it to look?** You choose one of the themes, seeing them first in light and dark. Each person can change it later on
their phone.

At the end it gives you your server's address and a recovery key for the backups, and opens the app. An assistant then continues with
the party, the team and the first election.

## Which server to choose

I checked this on 4 November 2026. These plans change often, so confirm it on their page before deciding.

| Provider | Cost | Keep in mind |
|---|---|---|
| [Oracle Cloud](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) | Free, with no time limit | It may reclaim idle instances, and sometimes has no capacity to create them |
| [AWS](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-plans.html) | Free for up to 6 months | When the plan ends the account closes, and the data is deleted after 90 days |
| [Google Cloud](https://docs.cloud.google.com/free/docs/free-cloud-features) | About USD 3.65 a month, for the IP address | Its free plan is only in the United States |

Two things matter more than the provider:

- **The IP address must be fixed.** Each phone keeps its data tied to that address. If it changes, each poll watcher prepares the
  table again and whatever had not been sent becomes unreachable.
- **Free servers are usually outside Argentina.** That has legal consequences, which are up to the party. They are in the
  [legal information](../../LEGAL.en.md).

## System warnings

The installer may be unsigned, so your computer will warn you. That is expected:

- **Windows:** tap “More info”, then “Run anyway”.
- **macOS:** it blocks it the first time. Go to Settings, Privacy & Security, and tap “Open Anyway”.
- **Linux:** no warning.

Download it only from the releases page, and check that its SHA-256 matches the published one. A fake installer is the easiest way to
steal a party's data.
