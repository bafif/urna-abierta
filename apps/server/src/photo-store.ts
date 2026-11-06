import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { s3Client, S3Error, type S3Client, type S3ClientOptions, type S3Config } from './s3.ts';

/**
 * Where the photos of the tally sheets live. On the disk of the server by default; in an S3
 * bucket when the party asks for it, encrypted before they leave.
 */

export type PhotoStatus = { storage: 'disk' } | { storage: 's3'; working: boolean | null };

export interface PhotoStore {
  put(sha: string, bytes: Buffer): Promise<void>;
  /** Null when this store does not have it. */
  get(sha: string): Promise<Buffer | null>;
  status(): PhotoStatus;
  /** For the log, in plain words. */
  readonly where: string;
  /** Tries a write and a read. It never throws: it says what happened in the log. */
  probe(): Promise<boolean>;
}

/** The storage did not answer: the phone keeps the photo and tries again later. */
export class PhotoStoreUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhotoStoreUnavailable';
  }
}

/** A setting that cannot work. The server does not start, and says why. */
export class PhotoConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhotoConfigError';
  }
}

export interface Logger {
  info(line: string): void;
  error(line: string): void;
}

export const DEFAULT_PHOTOS_DIR = '/tmp/urna-fotos';

export function diskPhotoStore(dir: string): PhotoStore {
  return {
    where: `en el disco, en ${dir}`,
    async put(sha, bytes) {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, sha), bytes);
    },
    async get(sha) {
      try {
        return await readFile(join(dir, sha));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    status: () => ({ storage: 'disk' }),
    probe: async () => true,
  };
}

/**
 * Two keys from the field key, each for one thing: one encrypts the photos and the other names
 * them, so that the provider sees neither the picture nor its hash. The field key is used as
 * the text it is, as the sealed fields use it: the installer writes 64 hex digits, but any
 * secret works.
 */
export function photoKeys(fieldKey: string): { encryption: Buffer; names: Buffer } {
  const derive = (info: string) => Buffer.from(hkdfSync('sha256', Buffer.from(fieldKey, 'utf8'), 'urna-abierta', info, 32));
  return { encryption: derive('fotos-s3/cifrado/v1'), names: derive('fotos-s3/nombres/v1') };
}

/** AES-256-GCM, laid out as nonce (12) | ciphertext | tag (16). The context ties it to its name. */
export function encryptPhoto(key: Buffer, plain: Buffer, context: string): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([nonce, body, cipher.getAuthTag()]);
}

/** Throws if the key is another one, or if anyone changed or swapped the object. */
export function decryptPhoto(key: Buffer, sealed: Buffer, context: string): Buffer {
  if (sealed.length < 28) throw new Error('too short to be an encrypted photo');
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12));
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  return Buffer.concat([decipher.update(sealed.subarray(12, sealed.length - 16)), decipher.final()]);
}

export interface S3PhotoStoreOptions {
  config: S3Config;
  prefix: string;
  fieldKey: string;
  /** The photos that were already on disk before switching keep being served from there. */
  previous?: PhotoStore;
  client?: S3ClientOptions;
  log?: Logger;
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** S3 has no folders, only names: «urna» would glue itself to every name instead of holding them. */
const asFolder = (prefix: string) => (prefix && !prefix.endsWith('/') ? `${prefix}/` : prefix);

/** Without permission to list the bucket, S3 answers a missing object like this instead of with a 404. */
const deniedRead = (error: unknown) => error instanceof S3Error && error.status === 403 && error.code === 'AccessDenied';

export function s3PhotoStore({ config, prefix: given, fieldKey, previous, client: clientOptions, log = console }: S3PhotoStoreOptions): PhotoStore {
  const keys = photoKeys(fieldKey);
  const client: S3Client = s3Client(config, clientOptions);
  const prefix = asFolder(given);
  const nameOf = (label: string) => createHmac('sha256', keys.names).update(label).digest('hex');
  const objectFor = (sha: string) => `${prefix}${nameOf(`foto:${sha}`)}`;
  const where = `en el bucket ${config.bucket} de ${config.endpoint}, con el prefijo «${prefix}», cifradas`;
  let working: boolean | null = null;

  const unavailable = (what: string, error: unknown) => {
    working = false;
    log.error(`FOTOS: no se pudo ${what} en el almacenamiento S3 (${reason(error)}). El teléfono la va a volver a mandar.`);
    return new PhotoStoreUnavailable(reason(error));
  };

  return {
    where,
    async put(sha, bytes) {
      try {
        await client.put(objectFor(sha), encryptPhoto(keys.encryption, bytes, `foto:${sha}`));
      } catch (error) {
        throw unavailable('guardar una foto', error);
      }
      working = true;
    },
    async get(sha) {
      // The disk first: the photos from before the switch are only there, and the new ones never go there.
      if (previous) {
        try {
          const old = await previous.get(sha);
          if (old) return old;
        } catch (error) {
          log.error(`fotos: no se pudo leer la carpeta de fotos del disco (${reason(error)}); se busca en el bucket.`);
        }
      }
      let sealed: Buffer | null;
      try {
        sealed = await client.get(objectFor(sha));
      } catch (error) {
        // A missing photo, as far as anyone can tell: storing keeps working, so it is not marked as failing.
        if (deniedRead(error)) {
          log.error(`fotos: el bucket no deja leer la foto ${sha}. O no está, o la clave no tiene permiso de leer (s3:GetObject); sin permiso de listar (s3:ListBucket), S3 contesta igual en los dos casos.`);
          return null;
        }
        working = false;
        log.error(`FOTOS: no se pudo leer una foto del almacenamiento S3 (${reason(error)}).`);
        throw new PhotoStoreUnavailable(reason(error));
      }
      working = true;
      if (!sealed) return null;
      try {
        return decryptPhoto(keys.encryption, sealed, `foto:${sha}`);
      } catch {
        log.error(`FOTOS: la foto ${sha} está en el bucket pero no se puede abrir. O cambió URNA_FIELD_KEY, o alguien tocó el objeto.`);
        throw new PhotoStoreUnavailable('unreadable');
      }
    },
    status: () => ({ storage: 's3', working }),
    async probe() {
      const object = `${prefix}sonda-${nameOf('sonda').slice(0, 16)}`;
      const content = randomBytes(16);
      try {
        await client.put(object, encryptPhoto(keys.encryption, content, object));
        const back = await client.get(object);
        if (!back) throw new Error('lo que se acaba de guardar no aparece');
        if (!decryptPhoto(keys.encryption, back, object).equals(content)) throw new Error('lo que volvió no es lo que se guardó');
      } catch (error) {
        working = false;
        log.error(
          [
            '',
            '########################################################################',
            `FOTOS: EL ALMACENAMIENTO S3 NO RESPONDE BIEN: ${reason(error)}`,
            `Las fotos se guardan ${where}.`,
            'El resto del sistema funciona. Mientras esto falle, cada teléfono guarda sus fotos',
            'y las vuelve a mandar solo. Revisá URNA_S3_ENDPOINT, URNA_S3_BUCKET, URNA_S3_REGION',
            'y las claves. En un servidor instalado están en /opt/urna-abierta/.env; después de',
            'corregirlas, «urna reiniciar».',
            '########################################################################',
            '',
          ].join('\n'),
        );
        return false;
      }
      working = true;
      try {
        await client.delete(object);
      } catch (error) {
        // Some parties give the server no permission to delete, which is fine: it is one small object, always the same.
        log.info(`fotos: no se pudo borrar el objeto de prueba ${object} (${reason(error)}); no hace falta para guardar fotos.`);
      }
      log.info(`fotos: el almacenamiento S3 responde bien (${config.bucket}).`);
      return true;
    },
  };
}

const NAME_IN_BUCKET = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;

/** Disk unless URNA_S3_ENDPOINT and URNA_S3_BUCKET are both set. Throws PhotoConfigError for a setting that cannot work. */
export function photoStoreFromEnv(env: NodeJS.ProcessEnv = process.env, log: Logger = console): PhotoStore {
  const value = (name: string) => env[name]?.trim() || undefined;
  const disk = diskPhotoStore(value('URNA_PHOTOS_DIR') ?? DEFAULT_PHOTOS_DIR);
  const endpoint = value('URNA_S3_ENDPOINT');
  const bucket = value('URNA_S3_BUCKET');
  if (!endpoint && !bucket) return disk;
  if (!endpoint || !bucket) {
    throw new PhotoConfigError(`Para guardar las fotos en un almacenamiento S3 hacen falta URNA_S3_ENDPOINT y URNA_S3_BUCKET, y está solo ${endpoint ? 'URNA_S3_ENDPOINT' : 'URNA_S3_BUCKET'}. Completá la otra, o borrá las dos para guardarlas en el disco.`);
  }
  const accessKeyId = value('URNA_S3_ACCESS_KEY_ID');
  const secretAccessKey = value('URNA_S3_SECRET_ACCESS_KEY');
  if (!accessKeyId || !secretAccessKey) {
    throw new PhotoConfigError('Las fotos van a un almacenamiento S3, pero faltan URNA_S3_ACCESS_KEY_ID o URNA_S3_SECRET_ACCESS_KEY: son la clave de acceso que da el proveedor para ese bucket.');
  }
  // The test mode would make up a new one on each start, and the photos already sent could not be opened again.
  if (!env.URNA_FIELD_KEY) {
    throw new PhotoConfigError('Las fotos van a un almacenamiento S3 y se cifran con URNA_FIELD_KEY, que falta. Definila (el instalador la genera) y guardala: sin ella, las fotos del bucket no se pueden abrir.');
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new PhotoConfigError(`URNA_S3_ENDPOINT no es una dirección: «${endpoint}». Tiene que ser algo como https://s3.us-east-1.amazonaws.com.`);
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new PhotoConfigError(`URNA_S3_ENDPOINT tiene que ser solo la dirección del servicio, sin el bucket ni una carpeta, como https://s3.us-east-1.amazonaws.com. Está «${endpoint}».`);
  }
  if (!NAME_IN_BUCKET.test(bucket)) throw new PhotoConfigError(`URNA_S3_BUCKET tiene que ser el nombre del bucket, solo con letras, números, puntos, guiones y guiones bajos. Está «${bucket}».`);
  const prefix = value('URNA_S3_PREFIX') ?? 'fotos/';
  if (!/^[\w.\-/]*$/.test(prefix) || prefix.startsWith('/') || prefix.split('/').some((part) => part === '.' || part === '..')) {
    throw new PhotoConfigError(`URNA_S3_PREFIX tiene que ser algo como fotos/, con letras, números, puntos, guiones y barras, sin empezar con una barra. Está «${prefix}».`);
  }
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    log.error(`fotos: URNA_S3_ENDPOINT usa http, sin cifrar (${url.origin}). Las fotos viajan cifradas igual, pero quien esté en el camino ve los pedidos firmados y los puede repetir. Fuera de una red propia, usá https.`);
  }
  return s3PhotoStore({
    config: { endpoint: url.origin, bucket, region: value('URNA_S3_REGION') ?? 'us-east-1', accessKeyId, secretAccessKey },
    prefix,
    fieldKey: env.URNA_FIELD_KEY,
    previous: disk,
    log,
  });
}
