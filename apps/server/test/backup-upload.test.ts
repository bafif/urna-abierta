import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uploadBackup } from '../src/backup-upload.ts';
import { s3Client } from '../src/s3.ts';
import { fakeS3, type FakeS3 } from './fake-s3.ts';

const credentials = { region: 'us-east-1', accessKeyId: 'prueba', secretAccessKey: 'secreto de prueba' };
const quiet = { info: () => undefined, error: () => undefined };

describe('backups to the bucket', () => {
  let folder: string;
  let server: FakeS3;
  const client = () => s3Client({ ...credentials, endpoint: server.endpoint, bucket: 'fotos-prueba' }, { wait: async () => undefined });
  const backup = async (name: string, content = 'cifrado') => {
    const file = join(folder, name);
    await writeFile(file, content);
    return file;
  };
  const stored = () => [...server.objects.keys()].sort();

  beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), 'urna-copias-'));
  });
  afterAll(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it('sends the copy under backups/ and leaves only the newest, without touching anything else', async () => {
    server = await fakeS3(credentials, ['fotos-prueba'], { pageSize: 2 });
    try {
      for (const name of ['backups/urna-20270401-003000.tar.gpg', 'backups/urna-20270402-003000.tar.gpg', 'backups/urna-20270403-003000.tar.gpg', 'backups/notas.txt', 'fotos/abc']) {
        server.objects.set(`/fotos-prueba/${name}`, Buffer.from('viejo'));
      }
      const result = await uploadBackup(client(), await backup('urna-20270404-003000.tar.gpg', 'la copia'), 2, quiet);
      expect(result.key).toBe('backups/urna-20270404-003000.tar.gpg');
      expect(server.objects.get('/fotos-prueba/backups/urna-20270404-003000.tar.gpg')?.toString()).toBe('la copia');
      expect(result.removed).toEqual(['backups/urna-20270402-003000.tar.gpg', 'backups/urna-20270401-003000.tar.gpg']);
      expect(stored()).toEqual(['/fotos-prueba/backups/notas.txt', '/fotos-prueba/backups/urna-20270403-003000.tar.gpg', '/fotos-prueba/backups/urna-20270404-003000.tar.gpg', '/fotos-prueba/fotos/abc']);
      expect(server.badSignatures).toBe(0);
    } finally {
      await server.close();
    }
  });

  it('without permission to list, the copy still gets there and it says why the old ones stay', async () => {
    server = await fakeS3(credentials);
    try {
      server.objects.set('/fotos-prueba/backups/urna-20270401-003000.tar.gpg', Buffer.from('viejo'));
      server.denyListing(true);
      const said: string[] = [];
      const result = await uploadBackup(client(), await backup('urna-20270405-003000.tar.gpg'), 1, { info: () => undefined, error: (line) => said.push(line) });
      expect(result.removed).toEqual([]);
      expect(stored()).toEqual(['/fotos-prueba/backups/urna-20270401-003000.tar.gpg', '/fotos-prueba/backups/urna-20270405-003000.tar.gpg']);
      expect(said.join(' ')).toMatch(/s3:ListBucket/);
    } finally {
      await server.close();
    }
  });

  it('refuses a file that is not a backup, and fails when the bucket does not take it', async () => {
    server = await fakeS3(credentials);
    try {
      await expect(uploadBackup(client(), await backup('padron.csv'), 28, quiet)).rejects.toThrow(/no es una copia/);
      server.failNext(10, 500);
      await expect(uploadBackup(client(), await backup('urna-20270406-003000.tar.gpg'), 28, quiet)).rejects.toThrow(/500/);
    } finally {
      await server.close();
    }
  });

  it('runs as a command with the settings of the server, as «urna copia» calls it', async () => {
    server = await fakeS3(credentials);
    try {
      const file = await backup('urna-20270407-003000.tar.gpg', 'por comando');
      const env = { ...process.env, URNA_S3_ENDPOINT: server.endpoint, URNA_S3_BUCKET: 'fotos-prueba', URNA_S3_ACCESS_KEY_ID: credentials.accessKeyId, URNA_S3_SECRET_ACCESS_KEY: credentials.secretAccessKey };
      const script = new URL('../src/backup-upload.ts', import.meta.url).pathname;
      const { stdout } = await promisify(execFile)(process.execPath, [script, file, '28'], { env });
      expect(stdout).toContain('backups/urna-20270407-003000.tar.gpg');
      expect(server.objects.get('/fotos-prueba/backups/urna-20270407-003000.tar.gpg')?.toString()).toBe('por comando');
      const missing = promisify(execFile)(process.execPath, [script, file], { env: { ...process.env, URNA_S3_ENDPOINT: '', URNA_S3_BUCKET: '' } });
      await expect(missing).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('urna reiniciar') });
    } finally {
      await server.close();
    }
  });
});
