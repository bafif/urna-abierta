# Installation

[Español](../es/instalacion.md) · [Back to the README](../../README.en.md)

**There is no published version yet, and it has not been used in a real election.** Before using it, run a [drill](drill.md).

## Try it with invented people

You need Node 24 and Podman.

```sh
git clone https://github.com/bafif/urna-abierta
cd urna-abierta
corepack pnpm install
deploy/serve.sh
```

It gives you a link for each role: poll watcher, district chief, coordination, traffic light and statistics. Each link works once. To
see it as on a phone, turn on device mode with F12, or follow the [test on an Android emulator](phone-tests.md).

To see the design proposal, just open `design/index.html` in a browser.

## The installer

It is downloaded from the GitHub releases page, for Windows, macOS or Linux. It opens in your browser and can only be seen from your
computer. Until a version is published, run it from the source with `node apps/installer/src/main.ts`, with the container images built.

It asks three questions and does the rest.

**1. Where will your Urna Abierta live?** Any of these options works:

| Option | What you need |
|---|---|
| Create a new server | An account on Oracle Cloud, AWS or Google Cloud. [This is how to create it](servers.md) |
| I already have a server | Ubuntu or Debian, its address and an SSH key of a user with passwordless `sudo` |
| Paste a text | Paste a block when creating the server, without giving the installer any credential |
| Try it on this computer | Podman or Docker running. It can only be seen from there |

**2. How do we read scanned rolls?** On your computer, with the roll reader, which is the recommended way because a roll has people's
data, or you decide later. Using your own AI is not available yet. The reader is a separate download and is only needed for scanned PDFs:
see [Loading the roll](#loading-the-roll).

**3. How do you want it to look?** You choose one of the themes, seeing them first in light and dark. Each person can change it later on
their phone. You can also [make your own](themes.md) and load it here, by dragging the file.

At the end it gives you your server's address and a recovery key for the backups, and opens the app. An assistant then continues with
the party, the team and the first election.

**Keep that key.** It is the only thing that opens your backups, and it cannot be generated again.

## Loading the roll

In each election, at the “Roll” step, tap “Upload the roll” and choose the file. Before loading anything, the app shows you how many
people it understood and what changes from what was already there.

| What you have | What to do |
|---|---|
| An Excel (`.xlsx`) or CSV spreadsheet | Upload it directly. The first sheet is used, and the heading row can sit below a title. It needs a “Apellido y nombre”, “Nombre” or “Apellido” column (or “Name”), and it can have “Nombres”, “DNI” or “Documento”, “Legajo”, “N°” or “Orden”, “Mesa” and “Domicilio”. Other columns are not read |
| An `.xls` or `.ods` spreadsheet | Open it and save it as `.xlsx` or CSV |
| A scanned PDF | First open it with the [roll reader](https://github.com/bafif/urna-abierta-padrones/blob/main/README.en.md#download), which runs on your computer without sending the roll anywhere. It gives you a `.padron` file |
| A `.padron` file | Upload it directly |

Until the first version of the reader is published on its Releases page, the reader runs from a terminal: its
[README](https://github.com/bafif/urna-abierta-padrones/blob/main/README.en.md) explains how.

An Excel spreadsheet becomes a `.padron` on your phone or computer, before it is sent to the server. If a PDF is uploaded directly, the
app does not send it and explains how to read it.

If something cannot be read, the app says where the problem is (the row, or the line of the file) and what is wrong with it, without
showing what that row says. Problems of the same kind come together on one line. In a spreadsheet, a row without a name, or with the
DNI or legajo of an earlier row, is left out, and the rest can still be loaded. A row whose document does not have 7 or 8 digits is
loaded anyway, marked for review.

When the reader is not sure about a row, it marks it for review. Those people are loaded like everyone else, and the election shows
“N people of the roll need a look”. Tapping it shows each one with their name and document: you correct what is wrong, or confirm it
is fine.

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

## Downloading and opening it

On the [releases page](https://github.com/bafif/urna-abierta/releases/latest), download the one for your computer. The installer may be
unsigned, so your computer will warn you. That is expected:

| Your computer | The file | How to open it |
|---|---|---|
| Windows | `urna-abierta-instalador-windows.exe` | Double-click. If “Windows protected your PC” shows up, tap “More info”, then “Run anyway” |
| Mac with an Apple chip | `urna-abierta-instalador-mac-apple.zip` | Double-click the `.zip`, then `urna-abierta-instalador`. The first time macOS blocks it: go to Settings, Privacy & Security, and tap “Open Anyway” |
| Mac with Intel | `urna-abierta-instalador-mac-intel.zip` | Same as on a Mac with an Apple chip |
| Linux | `urna-abierta-instalador-linux.tar.gz` | Unpack it and, in a terminal open in that folder, run `./urna-abierta-instalador`. No warning |

To know which Mac you have: Apple menu, “About This Mac”. It says “Chip Apple M…” or “Processor Intel”.

Along with the browser, a window with text on a black background opens. **Leave it open until it finishes:** if you close it, the
installer stops.

Download it only from the releases page, and check that its SHA-256 matches the published one. A fake installer is the easiest way to
steal a party's data.
