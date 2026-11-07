import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { s3Client, type S3Client } from './s3.ts';

/**
 * Sends one backup to the bucket of the photos, to backups/ inside the installation's folder, and leaves there only
 * the newest, as many as the server keeps. «urna copia» runs it inside the server container, which already has the
 * bucket's keys:
 *
 *   node apps/server/src/backup-upload.ts /copias/urna-20270406-063000.tar.gpg 28
 *
 * The backup is already encrypted with the recovery key: the provider keeps something it cannot open.
 */
const NAME = /^urna-\d{8}-\d{6}\.tar\.gpg$/;

/**
 * backups/ inside the folder that URNA_S3_PREFIX names, fotos/ when it is not set: two installations that share a
 * bucket with different prefixes never see, or delete, each other's copies.
 */
export function backupsFolder(prefix?: string): string {
  const folder = prefix?.trim() || 'fotos/';
  if (!/^[\w.\-/]*$/.test(folder) || folder.startsWith('/') || folder.split('/').some((part) => part === '.' || part === '..')) {
    throw new Error(`URNA_S3_PREFIX tiene que ser algo como fotos/, con letras, números, puntos, guiones y barras, sin empezar con una barra. Está «${folder}».`);
  }
  return `${folder.endsWith('/') ? folder : `${folder}/`}backups/`;
}

export interface Logger {
  info(message: string): void;
  error(message: string): void;
}

/**
 * `purgedBefore`, as a copy's stamp (20270406-063000): the copies made before the last purge still have the names it
 * erased, and go too.
 */
export async function uploadBackup(client: S3Client, file: string, keep: number, log: Logger = console, folder = backupsFolder(), purgedBefore = ''): Promise<{ key: string; removed: string[] }> {
  const name = basename(file);
  if (!NAME.test(name)) throw new Error(`${name} no es una copia de Urna Abierta.`);
  const key = `${folder}${name}`;
  // From the disk, a piece at a time: the photos taken before the bucket stay in every backup, and may weigh more than
  // the memory of a small server.
  await client.putFile(key, file, 'application/pgp-encrypted');
  log.info(`copia mandada al bucket: ${key}`);
  // It got there: from here on, a problem only leaves old copies behind. Only copies right in this folder count:
  // a folder inside it belongs to another installation.
  try {
    const names = await client.list(folder);
    const stampOf = (each: string) => each.slice(folder.length + 'urna-'.length, folder.length + 'urna-'.length + 15);
    const copies = names.filter((each) => NAME.test(each.slice(folder.length))).sort().reverse();
    const old = copies.filter((each, index) => each !== key && (index >= Math.max(1, keep) || (purgedBefore !== '' && stampOf(each) < purgedBefore)));
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
  const [file = '', keep = '28', purgedBefore = ''] = process.argv.slice(2);
  try {
    await uploadBackup(clientFromEnv(), file, Number(keep) || 28, console, backupsFolder(process.env.URNA_S3_PREFIX), /^\d{8}-\d{6}$/.test(purgedBefore) ? purgedBefore : '');
  } catch (error) {
    console.error(`El bucket no la tomó: ${(error as Error).message}`);
    process.exit(1);
  }
}
