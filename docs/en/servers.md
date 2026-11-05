# Creating a server

[Español](../es/servidores.md) · [Back to installation](installation.md)

The installer creates the server for you, on any of these three clouds. It asks for a credential, which it uses once and does not store.
This is how to get it. If you would rather not hand it over, choose **I prefer to paste a text** and create the server by hand: the end of
this page explains how.

These plans and their screens change often: when in doubt, each provider's documentation prevails.

**Status.** Automatic server creation was tested against simulations of each API, and the AWS signature against its official suite, but
not yet against the real clouds. What was tested end to end is the SSH installation on Ubuntu, including restoring a backup on another
server. Until then, if automatic creation fails, the paste a text option does the same by hand.

## Oracle Cloud

This is the recommended one: free with no time limit. Machines are ARM and sometimes none are available: the installer tries each zone,
and if there are none, it creates a smaller x86 one. Oracle may reclaim idle instances of free accounts, so do not leave it unused.

1. Create an account at [oracle.com/cloud/free](https://www.oracle.com/cloud/free/). It asks for a card to verify you.
2. Top right, your profile, **My profile**, **API keys**, **Add API key**. Download the private key.
3. Oracle shows you a block with everything the installer asks for: `user`, `fingerprint`, `tenancy` and `region`.
4. Paste that data in the installer, along with the contents of the private key file.

[Oracle's documentation on API keys](https://docs.oracle.com/en-us/iaas/Content/API/Concepts/apisigningkey.htm).

When you are done, delete that API key: the installer no longer needs it.

## AWS

Free for up to 6 months, or until the credits run out: enough for one election. When the plan ends the account closes and data is
deleted after 90 days, so leave nothing there.

1. Create an account at [aws.amazon.com/free](https://aws.amazon.com/free/).
2. Go to **IAM**, **Users**, **Create user**. Give it the `AmazonEC2FullAccess` permission.
3. In that user, **Security credentials**, **Create access key**. Copy both parts.
4. Paste them in the installer. Region `sa-east-1` is São Paulo, the closest one.

[AWS documentation on access keys](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html).

When you are done, delete the user: the installer no longer needs it.

## Google Cloud

The machine is free, but the IP address is charged: about USD 3.65 a month. The free plan only exists in the United States, and that is
where the installer creates it.

1. Create an account and a project at [console.cloud.google.com](https://console.cloud.google.com/), and enable billing.
2. Enable the **Compute Engine API** in that project.
3. **IAM & Admin**, **Service accounts**, **Create service account**. Give it the **Compute Admin** role.
4. In that account, **Keys**, **Add key**, **JSON**. A file gets downloaded.
5. Paste the contents of that file in the installer.

[Google's documentation on service accounts](https://cloud.google.com/iam/docs/service-account-creds).

When you are done, delete that key.

## Without giving the installer any key

Choose **I prefer to paste a text**. At the end, the installer gives you a block. Create the server yourself, on any provider:

- **System:** Ubuntu 24.04.
- **Size:** 1 GB of memory and 20 GB of disk are enough.
- **Fixed address:** reserved IP on Oracle, Elastic IP on AWS, static IP on Google. It has to be in place before it starts.
- **Open ports:** 80 and 443 on TCP, and 443 on UDP. Port 22 only if you are going to get in to maintain it.
- **Block:** paste it in the startup field. It is called *user data*, *cloud-init* or *startup script*, depending on the provider.

The server installs itself in a few minutes, and asks a public service what its address is. Go back to the installer and type it.

The block holds the keys of your installation. It stays stored in that cloud account: do not share it.

## Maintaining it

With SSH on the server:

```sh
sudo urna estado      # says whether everything is fine and what to do if not
sudo urna copia       # makes an encrypted backup now
sudo urna actualizar  # gets the latest version
```

What was running comes back by itself after a reboot. Backups are made every 6 hours, and are downloaded from the app, in **More**,
**Backups**. To put one back on a new server:

```sh
sudo urna restaurar /path/to/the/backup.tar.gpg YOUR-RECOVERY-KEY
```

## When the election is over

The server is seasonal. Purge the data from the app, download the last backup if needed and delete the machine, the disk and the address
in the cloud's console. If you do not delete them, they may keep charging.
