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
sudo urna actualizar  # makes a backup and moves to the latest version
sudo urna reiniciar   # creates the containers again with what /opt/urna-abierta/.env says, keeping the data
```

What was running comes back by itself after a reboot.

### Updating

`sudo urna actualizar` downloads the latest published version, makes a backup, replaces the `urna` commands with that version's too,
and creates the containers again, keeping the data. To go to a particular version: `sudo urna actualizar v0.2.0`. Meanwhile, the site
stops answering for a minute or two. `sudo urna estado` says which version it is on.

Update before preparing an election or after closing it, never during voting or in the days before. If a new version brings a problem,
it has to show up in a [drill](drill.md), not on election day.

If the new version does not start, `urna actualizar` says so, with the last thing the server said, and explains how to go back: first
`sudo urna actualizar` with the previous version and, if it still does not start, restore the backup it made before updating.

The database stays in the new version's format. A backup made after updating restores on that version or a newer one.

### Restoring a backup

First upload the backup to the server. From your computer, in the folder where you downloaded it and with the server's SSH key:

```sh
scp -i your-ssh-key urna-20270406-063000.tar.gpg ubuntu@203.0.113.24:
```

On Windows the same command works in PowerShell; [WinSCP](https://winscp.net/) also does. The backup lands in your user's folder.
Then, on the server:

```sh
sudo urna restaurar urna-20270406-063000.tar.gpg YOUR-RECOVERY-KEY
```

Restoring replaces all the data on that server. It takes the recovery key of the installation that made the backup: if it is another
one, it says so, and if the file is not a backup or got cut while uploading, it says that too.

The backups the server makes afterwards open with **its own** recovery key, not with the one of the restored backup. Keep both.

If the photos went to S3 storage, also fill in the `URNA_S3_...` lines of `/opt/urna-abierta/.env` on the new server and run
`sudo urna reiniciar`: those settings are not in the backup, and without them the server stores on disk and cannot find the photos in
the bucket. `urna restaurar` reminds you.

### Backups off the server

Backups are made every 6 hours and stay on the server's disk: the last 28, one week. If the server is lost, or the cloud closes the
account, they are lost with it. To always have one elsewhere:

- **Download them from the app**, in **More**, **Backups**, now and then and above all before the election.
- **Send them to S3 storage.** If you set one up for the photos (below), each backup also goes to the bucket, to a `backups/` folder
  inside the photos one (`fotos/backups/`, unless you changed `URNA_S3_PREFIX`), and the 28 newest stay there. They are still encrypted with the recovery key: the provider keeps something it cannot open. To delete
  the old ones, the access key needs permission to list the bucket; without it they are still sent, but they pile up. A bucket from a
  different provider than the server's is better, so the backup survives if that account closes. A backup over 5 GB (because of the
  photos left on disk from before the bucket) does not fit in one upload: it stays only on the server, and `urna estado` flags it.

`urna estado` says whether the last backup reached the bucket. Without S3, it reminds you with an `aviso` line: the backups only live on
that server.

## Photos in S3 storage

The photos of the tally sheets are kept on the server's disk and go into every backup. For most elections that is enough. Sending them
to S3 storage is worth it if you expect many tables (each photo weighs up to 8 MB and every backup carries all of them), if the server's
disk is small, or if you want the photos kept apart from the machine.

Before leaving the server, each photo is encrypted with AES-256-GCM, with a key derived from `URNA_FIELD_KEY`. The provider keeps data it
cannot read, under names that do not say which photo they are either. The other side of it: without `URNA_FIELD_KEY` those photos cannot
be opened. That key travels inside every backup; the bucket settings (address, name and access keys) do not. To get everything back you need the
backup, the recovery key and those settings, which you set again on the new server.

| Variable | What it is |
| --- | --- |
| `URNA_S3_ENDPOINT` | The address of the service, without the bucket. Examples below. |
| `URNA_S3_BUCKET` | The name of the bucket. Create it first, private. |
| `URNA_S3_REGION` | The region of the bucket. If empty, `us-east-1`. |
| `URNA_S3_ACCESS_KEY_ID` | The public part of the access key. |
| `URNA_S3_SECRET_ACCESS_KEY` | The secret part. |
| `URNA_S3_PREFIX` | The folder inside the bucket. If empty, `fotos/`. If it does not end in `/`, one is added. If two installations use the same bucket, a trial one and the real one for example, each needs its own: otherwise they delete each other's backups. |

Photos go to the bucket only when both `URNA_S3_ENDPOINT` and `URNA_S3_BUCKET` are set; with both empty, they go to disk. With only one
of them, or without the access keys, the server does not start and says what is missing. Addresses are path-style
(`https://service/bucket/photo`), which every provider below accepts.

To turn it on in a server that is already installed:

1. Edit `/opt/urna-abierta/.env` (for example with `sudo nano /opt/urna-abierta/.env`) and fill in the `URNA_S3_...` lines. If your server
   was installed with an earlier version, those lines are not there: add them at the end. Write the values without quotes or spaces.
2. `sudo urna reiniciar`, so that the server takes the new settings. The data stays.
3. `sudo urna estado` should say `bien   fotos: en el bucket ...`. If it says `espera`, the server is still testing the bucket: run it
   again in a minute.

Each time it starts, the server writes, reads and deletes a test object. If something fails, it writes so in plain sight in its log and
`urna estado` marks it as `FALLA`, but everything else keeps working: a photo that cannot be stored is not stored anywhere else, and each
phone keeps it and sends it again until it gets in. Deleting the test object needs permission to delete; without it, a single object
remains, always the same one.

Better decide this before the election. The photos already on disk can still be seen and still go into the backup; the new ones go to
the bucket. If you later go back to disk, the ones left in the bucket can no longer be seen in the app.

**The photos in the bucket are not in the backup.** The backup carries the database and the photo folder on disk, which with S3 stays
empty or holds the older ones. The photos in the bucket are looked after by the provider; for more safety, turn on versioning for the
bucket. The backups themselves do go to the bucket, to `fotos/backups/`: see [Backups off the server](#backups-off-the-server).

Address and region for each provider:

- **AWS S3:** `https://s3.<region>.amazonaws.com`, for example `https://s3.sa-east-1.amazonaws.com` with the region `sa-east-1`. It has to
  be the region of the bucket. For the keys, create an IAM user that can only `s3:PutObject`, `s3:GetObject` and `s3:DeleteObject` on
  `arn:aws:s3:::YOUR-BUCKET/*`, and `s3:ListBucket` on `arn:aws:s3:::YOUR-BUCKET` (without `/*`). Without permission to list, AWS answers
  "access denied" instead of "not found" when asked for a photo it does not have, and the server cannot tell a missing photo from a key
  without permission.
- **Oracle Object Storage:** use its S3 compatibility API, `https://<namespace>.compat.objectstorage.<region>.oci.customer-oci.com`, with
  the Oracle region, for example `sa-saopaulo-1`. The namespace shows in the bucket details. The keys are a **Customer Secret Key**, from
  your profile: Oracle shows the secret part only once.
  [Oracle's documentation](https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/s3compatibleapi.htm).
- **Cloudflare R2:** `https://<account-id>.r2.cloudflarestorage.com`, with the region `auto`. The keys are an R2 API token with object read
  and write permission on that bucket. [Cloudflare's documentation](https://developers.cloudflare.com/r2/api/s3/api/).
- **Your own MinIO:** its address, for example `https://minio.your-domain.org`, with the region `us-east-1` unless you set another one. Use
  `https`: with `http` the photos still travel encrypted, but anyone on the way sees the signed requests. Only inside your own network it
  makes no difference.

**Status.** I tested it against MinIO and against a simulation that checks every signature; not yet against AWS, Oracle or R2.

## When the election is over

The server is seasonal. Purge the data from the app, download the last backup if needed and delete the machine, the disk and the address
in the cloud's console. If you do not delete them, they may keep charging.

If the photos went to S3 storage, neither purging nor deleting the server touches them: they stay in the bucket, along with the backups
in `fotos/backups/`, and the provider keeps charging for them. When you no longer need them, empty the bucket in the provider's console (every version, if you turned on
versioning), delete it and delete the access key you created for the server.
