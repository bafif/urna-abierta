import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { s3Client, type S3Client } from './s3.ts';

/**
 * Sends one backup to the bucket of the photos, under backups/, and leaves there only the newest, as many as the
 * server keeps. «urna copia» runs it inside the server container, which already has the bucket's keys:
 *
 *   node apps/server/src/backup-upload.ts /copias/urna-20270406-063000.tar.gpg 28
 *
 * The backup is already encrypted with the recovery key: the provider keeps something it cannot open.
 */
export const BACKUPS_PREFIX = 'backups/';
const NAME = /^urna-\d{8}-\d{6}\.tar\.gpg$/;

export interface Logger {
  info(message: string): void;
  error(message: string): void;
}

export async function uploadBackup(client: S3Client, file: string, keep: number, log: Logger = console): Promise<{ key: string; removed: string[] }> {
  const name = basename(file);
  if (!NAME.test(name)) throw new Error(`${name} no es una copia de Urna Abierta.`);
  const key = `${BACKUPS_PREFIX}${name}`;
  // With the photos in the bucket, a backup is the database and little else: it fits in memory.
  await client.put(key, await readFile(file), 'application/pgp-encrypted');
  log.info(`copia mandada al bucket: ${key}`);
  // It got there: from here on, a problem only leaves old copies behind.
  try {
    const names = await client.list(BACKUPS_PREFIX);
    const old = names.filter((each) => NAME.test(each.slice(BACKUPS_PREFIX.length))).sort().reverse().slice(Math.max(1, keep));
    for (const each of old) await client.delete(each);
    if (old.length) log.info(`copias viejas borradas del bucket: ${old.length}`);
    return { key, removed: old };
  } catch (error) {
    log.error(`No se pudieron borrar las copias viejas del bucket, que van a quedar ahí (${(error as Error).message}). Para borrarlas, la clave necesita permiso de listar el bucket (s3:ListBucket).`);
    return { key, removed: [] };
  }
}

function clientFromEnv(env: NodeJS.ProcessEnv = process.env): S3Client {
  const value = (name: string) => env[name]?.trim() || undefined;
  const [endpoint, bucket, accessKeyId, secretAccessKey] = ['URNA_S3_ENDPOINT', 'URNA_S3_BUCKET', 'URNA_S3_ACCESS_KEY_ID', 'URNA_S3_SECRET_ACCESS_KEY'].map(value);
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('el servidor no tiene los datos del bucket. Si los cambiaste en .env, corré «urna reiniciar».');
  }
  // A backup is bigger than a photo, and may go over a slow connection.
  return s3Client({ endpoint: new URL(endpoint).origin, bucket, region: value('URNA_S3_REGION') ?? 'us-east-1', accessKeyId, secretAccessKey }, { timeoutMs: 300_000 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file = '', keep = '28'] = process.argv.slice(2);
  try {
    await uploadBackup(clientFromEnv(), file, Number(keep) || 28);
  } catch (error) {
    console.error(`El bucket no la tomó: ${(error as Error).message}`);
    process.exit(1);
  }
}
