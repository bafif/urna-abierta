import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decryptPhoto, diskPhotoStore, encryptPhoto, PhotoConfigError, photoKeys, photoStoreFromEnv, PhotoStoreUnavailable, s3PhotoStore, type Logger, type PhotoStore } from '../src/photo-store.ts';
import { s3Client } from '../src/s3.ts';
import { fakeS3, type FakeS3 } from './fake-s3.ts';

const FIELD_KEY = 'a1'.repeat(32);
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function quietLog(): Logger & { errors: string[]; infos: string[] } {
  const errors: string[] = [];
  const infos: string[] = [];
  return { errors, infos, error: (line) => errors.push(line), info: (line) => infos.push(line) };
}

describe('encrypting a photo', () => {
  const { encryption, names } = photoKeys(FIELD_KEY);
  const photo = Buffer.from('foto de prueba de un acta');

  it('comes back the same, and is laid out as nonce, ciphertext and tag', () => {
    const sealed = encryptPhoto(encryption, photo, 'foto:abc');
    expect(sealed.length).toBe(12 + photo.length + 16);
    expect(sealed.includes(photo)).toBe(false);
    expect(decryptPhoto(encryption, sealed, 'foto:abc').equals(photo)).toBe(true);
    // A new nonce each time.
    expect(encryptPhoto(encryption, photo, 'foto:abc').equals(sealed)).toBe(false);
  });

  it('does not open with another key, under another name, or after a change', () => {
    const sealed = encryptPhoto(encryption, photo, 'foto:abc');
    expect(() => decryptPhoto(photoKeys('otra clave').encryption, sealed, 'foto:abc')).toThrow();
    expect(() => decryptPhoto(encryption, sealed, 'foto:otra')).toThrow();
    const changed = Buffer.from(sealed);
    changed[14] = changed[14]! ^ 1;
    expect(() => decryptPhoto(encryption, changed, 'foto:abc')).toThrow();
    expect(() => decryptPhoto(encryption, sealed.subarray(0, 20), 'foto:abc')).toThrow();
  });

  it('derives two different keys, always the same ones for the same field key', () => {
    expect(encryption.length).toBe(32);
    expect(encryption.equals(names)).toBe(false);
    expect(photoKeys(FIELD_KEY).encryption.equals(encryption)).toBe(true);
    expect(photoKeys('otra clave').encryption.equals(encryption)).toBe(false);
  });
});

describe('choosing where the photos go', () => {
  const s3 = { URNA_S3_ENDPOINT: 'https://s3.us-east-1.amazonaws.com', URNA_S3_BUCKET: 'fotos-prueba', URNA_S3_ACCESS_KEY_ID: 'prueba', URNA_S3_SECRET_ACCESS_KEY: 'secreto', URNA_FIELD_KEY: FIELD_KEY };
  const choose = (env: NodeJS.ProcessEnv) => photoStoreFromEnv(env, quietLog());

  it('disk unless both the address and the bucket are there; empty counts as missing', () => {
    expect(choose({}).status()).toEqual({ storage: 'disk' });
    expect(choose({ URNA_S3_ENDPOINT: '', URNA_S3_BUCKET: ' ', URNA_PHOTOS_DIR: '/fotos' }).where).toBe('en el disco, en /fotos');
    expect(choose(s3).status()).toEqual({ storage: 's3', working: null });
    expect(choose({ ...s3, URNA_S3_PREFIX: '', URNA_S3_REGION: '' }).where).toContain('«fotos/»');
  });

  it('takes the prefix as a folder, with or without the last slash', () => {
    expect(choose({ ...s3, URNA_S3_PREFIX: 'urna' }).where).toContain('«urna/»');
    expect(choose({ ...s3, URNA_S3_PREFIX: 'urna/fotos' }).where).toContain('«urna/fotos/»');
    expect(choose({ ...s3, URNA_S3_PREFIX: 'urna/' }).where).toContain('«urna/»');
  });

  it('refuses to start with a setting that cannot work, and says which', () => {
    const refusal = (env: NodeJS.ProcessEnv) => {
      try {
        choose(env);
      } catch (error) {
        expect(error).toBeInstanceOf(PhotoConfigError);
        return (error as Error).message;
      }
      throw new Error('it started');
    };
    expect(refusal({ ...s3, URNA_S3_BUCKET: '' })).toContain('está solo URNA_S3_ENDPOINT');
    expect(refusal({ ...s3, URNA_S3_ENDPOINT: undefined })).toContain('está solo URNA_S3_BUCKET');
    expect(refusal({ ...s3, URNA_S3_SECRET_ACCESS_KEY: '' })).toContain('URNA_S3_SECRET_ACCESS_KEY');
    expect(refusal({ ...s3, URNA_S3_ACCESS_KEY_ID: undefined })).toContain('URNA_S3_ACCESS_KEY_ID');
    expect(refusal({ ...s3, URNA_FIELD_KEY: undefined })).toContain('URNA_FIELD_KEY');
    expect(refusal({ ...s3, URNA_S3_ENDPOINT: 's3.amazonaws.com' })).toContain('no es una dirección');
    expect(refusal({ ...s3, URNA_S3_ENDPOINT: 'https://s3.amazonaws.com/fotos-prueba' })).toContain('sin el bucket');
    expect(refusal({ ...s3, URNA_S3_ENDPOINT: 'ftp://s3.amazonaws.com' })).toContain('solo la dirección');
    expect(refusal({ ...s3, URNA_S3_BUCKET: 'mi bucket' })).toContain('URNA_S3_BUCKET');
    expect(refusal({ ...s3, URNA_S3_PREFIX: '/fotos/' })).toContain('URNA_S3_PREFIX');
    expect(refusal({ ...s3, URNA_S3_PREFIX: 'fotos/../otra/' })).toContain('URNA_S3_PREFIX');
  });

  it('warns about plain http outside this machine', () => {
    const log = quietLog();
    photoStoreFromEnv({ ...s3, URNA_S3_ENDPOINT: 'http://minio.interno:9000' }, log);
    expect(log.errors.join()).toContain('usá https');
    const local = quietLog();
    photoStoreFromEnv({ ...s3, URNA_S3_ENDPOINT: 'http://localhost:9000' }, local);
    expect(local.errors).toEqual([]);
  });
});

describe('photos in an S3 bucket (a fake one, inside the test)', () => {
  const credentials = { region: 'sa-east-1', accessKeyId: 'prueba', secretAccessKey: 'secreto de prueba' };
  let server: FakeS3;
  let folder: string;
  beforeAll(async () => {
    server = await fakeS3(credentials);
    folder = await mkdtemp(join(tmpdir(), 'urna-fotos-'));
  });
  afterAll(async () => {
    await server.close();
    await rm(folder, { recursive: true, force: true });
  });
  const store = (overrides: { secretAccessKey?: string; fieldKey?: string; bucket?: string; prefix?: string; previous?: PhotoStore } = {}, log = quietLog()) =>
    s3PhotoStore({
      config: { ...credentials, endpoint: server.endpoint, bucket: overrides.bucket ?? 'fotos-prueba', ...(overrides.secretAccessKey ? { secretAccessKey: overrides.secretAccessKey } : {}) },
      prefix: overrides.prefix ?? 'urna/fotos/',
      fieldKey: overrides.fieldKey ?? FIELD_KEY,
      previous: overrides.previous ?? diskPhotoStore(folder),
      client: { wait: async () => undefined },
      log,
    });

  it('stores them encrypted, under a name that does not give their hash away, and reads them back', async () => {
    server.objects.clear();
    const photo = randomBytes(5000);
    const hash = sha(photo);
    const photos = store();
    await photos.put(hash, photo);
    expect(server.badSignatures).toBe(0);
    const put = server.requests.at(-1)!;
    expect(put.method).toBe('PUT');
    expect(put.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=prueba\/\d{8}\/sa-east-1\/s3\/aws4_request,SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date,Signature=[0-9a-f]{64}$/);
    expect(put.headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
    expect(put.headers['x-amz-content-sha256']).toMatch(/^[0-9a-f]{64}$/);
    expect(put.path).toMatch(/^\/fotos-prueba\/urna\/fotos\/[0-9a-f]{64}$/);
    expect(put.path).not.toContain(hash);

    const [stored] = [...server.objects.values()];
    expect(stored!.length).toBe(12 + photo.length + 16);
    expect(stored!.includes(photo.subarray(0, 64))).toBe(false);
    expect(decryptPhoto(photoKeys(FIELD_KEY).encryption, stored!, `foto:${hash}`).equals(photo)).toBe(true);

    expect((await photos.get(hash))!.equals(photo)).toBe(true);
    expect(await photos.get('0'.repeat(64))).toBeNull();
    expect(photos.status()).toEqual({ storage: 's3', working: true });
  });

  it('when the bucket fails, it says so and stores nothing anywhere else', async () => {
    const log = quietLog();
    const photos = store({}, log);
    const photo = Buffer.from('otra foto');
    server.failNext(3, 503);
    await expect(photos.put(sha(photo), photo)).rejects.toBeInstanceOf(PhotoStoreUnavailable);
    expect(log.errors.join()).toContain('no se pudo guardar una foto');
    expect(photos.status()).toEqual({ storage: 's3', working: false });
    expect(await diskPhotoStore(folder).get(sha(photo))).toBeNull();
    server.failNext(3, 503);
    await expect(photos.get(sha(photo))).rejects.toBeInstanceOf(PhotoStoreUnavailable);
    // It comes back by itself.
    await photos.put(sha(photo), photo);
    expect(photos.status()).toEqual({ storage: 's3', working: true });
  });

  it('an object that does not open with this key is not served', async () => {
    const photo = Buffer.from('foto con otra clave');
    await store({ fieldKey: 'otra clave' }).put(sha(photo), photo);
    // The name depends on the key too, so with this one it is simply not there.
    expect(await store().get(sha(photo))).toBeNull();
    // Swapping the contents of two objects is noticed.
    const first = Buffer.from('primera');
    const second = Buffer.from('segunda');
    const photos = store();
    await photos.put(sha(first), first);
    await photos.put(sha(second), second);
    const keys = [...server.objects.keys()].slice(-2);
    const [a, b] = keys.map((key) => server.objects.get(key)!);
    server.objects.set(keys[0]!, b!);
    server.objects.set(keys[1]!, a!);
    await expect(photos.get(sha(first))).rejects.toBeInstanceOf(PhotoStoreUnavailable);
  });

  it('the photos that were on disk before the switch are still served, without asking the bucket', async () => {
    const old = Buffer.from('foto vieja, del disco');
    await writeFile(join(folder, sha(old)), old);
    const photos = store();
    const asked = server.requests.length;
    expect((await photos.get(sha(old)))!.equals(old)).toBe(true);
    expect(server.requests.length).toBe(asked);
    // Also when the bucket could not have answered for it, as AWS without permission to list.
    server.denyListing(true);
    try {
      expect((await photos.get(sha(old)))!.equals(old)).toBe(true);
    } finally {
      server.denyListing(false);
    }
    expect(photos.status()).toEqual({ storage: 's3', working: null });
  });

  it('a disk that cannot be read does not hide the photos in the bucket', async () => {
    const log = quietLog();
    const brokenDisk: PhotoStore = { ...diskPhotoStore(folder), get: async () => Promise.reject(new Error('EACCES de prueba')) };
    const photos = store({ previous: brokenDisk }, log);
    const photo = Buffer.from('foto en el bucket, con el disco roto');
    await photos.put(sha(photo), photo);
    expect((await photos.get(sha(photo)))!.equals(photo)).toBe(true);
    expect(log.errors.join()).toContain('EACCES de prueba');
  });

  it('without permission to list the bucket, a missing photo is missing, not a failure', async () => {
    const log = quietLog();
    const photos = store({}, log);
    const photo = Buffer.from('foto que sí está');
    await photos.put(sha(photo), photo);
    server.denyListing(true);
    try {
      // AWS answers 403 AccessDenied for a name that is not there.
      expect(await photos.get('0'.repeat(64))).toBeNull();
      expect(photos.status()).toEqual({ storage: 's3', working: true });
      expect(log.errors.join()).toContain('s3:ListBucket');
      expect((await photos.get(sha(photo)))!.equals(photo)).toBe(true);
    } finally {
      server.denyListing(false);
    }
    // Any other refusal is still a failure: the phone hears 503 and tries again.
    server.failNext(3, 500);
    await expect(photos.get('1'.repeat(64))).rejects.toBeInstanceOf(PhotoStoreUnavailable);
    expect(photos.status()).toEqual({ storage: 's3', working: false });
  });

  it('puts the photos inside the prefix as a folder, and right at the top with no prefix', async () => {
    const photo = Buffer.from('foto con prefijo sin barra');
    await store({ prefix: 'urna' }).put(sha(photo), photo);
    expect(server.requests.at(-1)!.path).toMatch(/^\/fotos-prueba\/urna\/[0-9a-f]{64}$/);
    const probe = store({ prefix: 'urna' });
    expect(await probe.probe()).toBe(true);
    expect(server.requests.filter((r) => r.method === 'PUT').at(-1)!.path).toMatch(/^\/fotos-prueba\/urna\/sonda-[0-9a-f]{16}$/);
    await store({ prefix: '' }).put(sha(photo), photo);
    expect(server.requests.at(-1)!.path).toMatch(/^\/fotos-prueba\/[0-9a-f]{64}$/);
  });

  it('the startup check writes, reads and deletes, and says loudly when it fails', async () => {
    const before = server.objects.size;
    const log = quietLog();
    const photos = store({}, log);
    expect(await photos.probe()).toBe(true);
    expect(server.objects.size).toBe(before);
    expect(server.requests.slice(-3).map((r) => r.method)).toEqual(['PUT', 'GET', 'DELETE']);
    expect(log.infos.join()).toContain('responde bien');

    const failing = quietLog();
    const wrong = store({ secretAccessKey: 'otra' }, failing);
    expect(await wrong.probe()).toBe(false);
    expect(failing.errors.join()).toContain('EL ALMACENAMIENTO S3 NO RESPONDE BIEN');
    expect(failing.errors.join()).toContain('SignatureDoesNotMatch');
    expect(wrong.status()).toEqual({ storage: 's3', working: false });
    expect(await store({ bucket: 'no-existe' }, quietLog()).probe()).toBe(false);
  });
});

// Against a real MinIO (or any S3) only when these point to one with an empty bucket for tests.
const minio = {
  URNA_S3_ENDPOINT: process.env.URNA_TEST_S3_ENDPOINT,
  URNA_S3_BUCKET: process.env.URNA_TEST_S3_BUCKET,
  URNA_S3_REGION: process.env.URNA_TEST_S3_REGION,
  URNA_S3_ACCESS_KEY_ID: process.env.URNA_TEST_S3_ACCESS_KEY_ID,
  URNA_S3_SECRET_ACCESS_KEY: process.env.URNA_TEST_S3_SECRET_ACCESS_KEY,
  URNA_S3_PREFIX: `prueba-${randomBytes(4).toString('hex')}/`,
  URNA_FIELD_KEY: FIELD_KEY,
};

describe.skipIf(!minio.URNA_S3_ENDPOINT)('photos in a real S3 (URNA_TEST_S3_ENDPOINT)', () => {
  it('the startup check passes, and a photo goes encrypted and comes back', async () => {
    const photos = photoStoreFromEnv(minio, quietLog());
    expect(photos.status()).toEqual({ storage: 's3', working: null });
    expect(await photos.probe()).toBe(true);
    const photo = randomBytes(300_000);
    const hash = sha(photo);
    await photos.put(hash, photo);
    expect((await photos.get(hash))!.equals(photo)).toBe(true);
    expect(await photos.get('0'.repeat(64))).toBeNull();

    // What the provider keeps is not the photo, and not under its hash.
    const raw = s3Client({ endpoint: minio.URNA_S3_ENDPOINT!, bucket: minio.URNA_S3_BUCKET!, region: minio.URNA_S3_REGION || 'us-east-1', accessKeyId: minio.URNA_S3_ACCESS_KEY_ID!, secretAccessKey: minio.URNA_S3_SECRET_ACCESS_KEY! });
    expect(await raw.get(`${minio.URNA_S3_PREFIX}${hash}`)).toBeNull();
    const name = (await import('node:crypto')).createHmac('sha256', photoKeys(FIELD_KEY).names).update(`foto:${hash}`).digest('hex');
    const stored = await raw.get(`${minio.URNA_S3_PREFIX}${name}`);
    expect(stored!.length).toBe(photo.length + 28);
    expect(stored!.includes(photo.subarray(0, 64))).toBe(false);
    await raw.delete(`${minio.URNA_S3_PREFIX}${name}`);
  });

  it('with a wrong secret, the check fails loudly and an upload is refused', async () => {
    const log = quietLog();
    const photos = photoStoreFromEnv({ ...minio, URNA_S3_SECRET_ACCESS_KEY: 'no-es-la-clave' }, log);
    expect(await photos.probe()).toBe(false);
    expect(log.errors.join()).toContain('NO RESPONDE BIEN');
    await expect(photos.put('a'.repeat(64), Buffer.from('x'))).rejects.toBeInstanceOf(PhotoStoreUnavailable);
  });
});
