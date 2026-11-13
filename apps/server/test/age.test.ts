import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ageDecrypt, ageEncrypt, AgeError, ageKeyPair, ageRecipientOf, isAgeRecipient } from '../src/age.ts';

async function collect(source: AsyncIterable<Buffer>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const part of source) parts.push(part);
  return Buffer.concat(parts);
}
/** Comes in pieces of odd sizes, as from a pipe. */
async function* pieces(data: Buffer, size = 7_001): AsyncGenerator<Buffer> {
  for (let at = 0; at < data.length; at += size) yield data.subarray(at, at + size);
}
const encrypt = (recipient: string, data: Buffer) => collect(ageEncrypt(recipient, pieces(data)));
const decrypt = (identity: string, data: Buffer) => collect(ageDecrypt(identity, pieces(data)));
const failure = async (work: Promise<unknown>) => work.then(() => null, (error: unknown) => (error instanceof AgeError ? error.kind : 'other'));

describe('backups encrypted to a public key', () => {
  const pair = ageKeyPair();

  it('a pair is a public key and the recovery key that goes with it', () => {
    expect(pair.recipient).toMatch(/^age1[a-z0-9]{58}$/);
    expect(pair.identity).toMatch(/^AGE-SECRET-KEY-1[A-Z0-9]{58}$/);
    expect(ageRecipientOf(pair.identity)).toBe(pair.recipient);
    expect(isAgeRecipient(pair.recipient)).toBe(true);
    expect(isAgeRecipient(pair.recipient.replace(/.$/, (c) => (c === 'q' ? 'p' : 'q')))).toBe(false);
  });

  it('opens what it encrypted, whatever its size: chunks end where they should', async () => {
    for (const size of [0, 1, 65_535, 65_536, 65_537, 3 * 65_536, 200_003]) {
      const data = Buffer.alloc(size, size % 251);
      expect((await decrypt(pair.identity, await encrypt(pair.recipient, data))).equals(data)).toBe(true);
    }
  });

  it('another recovery key does not open it, and says so apart from a broken file', async () => {
    const sealed = await encrypt(pair.recipient, Buffer.from('padrón'));
    expect(await failure(decrypt(ageKeyPair().identity, sealed))).toBe('key');
    expect(await failure(decrypt('AAAAA-BBBBB-CCCCC-DDDDD-EEEEE', sealed))).toBe('key');
  });

  it('a backup cut short, changed or that is not one gives nothing out', async () => {
    const data = Buffer.alloc(150_000, 7);
    const sealed = await encrypt(pair.recipient, data);
    for (const broken of [
      sealed.subarray(0, sealed.length - 1),
      // Cut exactly where a chunk ends: what is left looks whole, but its last chunk does not say it is the last.
      sealed.subarray(0, sealed.length - (sealed.length - sealed.indexOf('\n', sealed.indexOf('---')) - 1 - 16 - 2 * 65_552)),
      Buffer.concat([sealed.subarray(0, 200), Buffer.from([sealed[200]! ^ 1]), sealed.subarray(201)]),
      Buffer.concat([sealed, Buffer.from('más')]),
      Buffer.from('no es una copia'),
    ]) {
      const parts: Buffer[] = [];
      const kind = await failure((async () => { for await (const part of ageDecrypt(pair.identity, pieces(broken))) parts.push(part); })());
      expect(kind).toBe('format');
      // What came out before it noticed is only what passed its check.
      expect(data.subarray(0, Buffer.concat(parts).length).equals(Buffer.concat(parts))).toBe(true);
    }
  });

  const age = spawnSync('age', ['--version']).status === 0;
  it.skipIf(!age)('the age program opens our backups, and we open its own', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'urna-age-'));
    try {
      const data = Buffer.alloc(100_000, 3);
      writeFileSync(join(folder, 'llave.txt'), `${pair.identity}\n`);
      writeFileSync(join(folder, 'copia.tar.age'), await encrypt(pair.recipient, data));
      const opened = spawnSync('age', ['-d', '-i', join(folder, 'llave.txt'), join(folder, 'copia.tar.age')]);
      expect(opened.status).toBe(0);
      expect(opened.stdout.equals(data)).toBe(true);
      const theirs = spawnSync('age', ['-r', pair.recipient], { input: data });
      expect((await decrypt(pair.identity, theirs.stdout)).equals(data)).toBe(true);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
