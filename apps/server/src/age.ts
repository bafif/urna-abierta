import { createCipheriv, createDecipheriv, createHmac, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, timingSafeEqual, type KeyObject } from 'node:crypto';

/**
 * Backups encrypted to a public key, in the format of age (https://age-encryption.org/v1): the server keeps only the
 * public key («age1…»), and only the recovery key («AGE-SECRET-KEY-1…»), which never reaches the server, opens them.
 * Being age, a backup also opens anywhere with `age -d -i llave.txt copia.tar.age`, without Urna Abierta.
 *
 * Only what a backup needs: one X25519 recipient, streamed in and out. Node only (node:crypto).
 */

export class AgeError extends Error {
  /** `key`: the recovery key does not open it; `format`: it is not age, or it is incomplete or changed. */
  readonly kind: 'key' | 'format';
  constructor(message: string, kind: 'key' | 'format') {
    super(message);
    this.kind = kind;
  }
}

const INTRO = 'age-encryption.org/v1';
const CHUNK = 64 * 1024;
const TAG = 16;
const MAX_HEADER = 64 * 1024;

// Bech32 (BIP 173) without its length limit, as age uses it.
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let check = 1;
  for (const value of values) {
    const top = check >>> 25;
    check = ((check & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) check ^= GENERATOR[i]!;
  }
  return check;
}

const expand = (hrp: string) => [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];

function regroup(data: Uint8Array | number[], from: number, to: number, pad: boolean): number[] | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const max = (1 << to) - 1;
  for (const value of data) {
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & max);
    }
  }
  if (pad && bits > 0) out.push((acc << (to - bits)) & max);
  else if (!pad && (bits >= from || ((acc << (to - bits)) & max) !== 0)) return null;
  return out;
}

function bech32Encode(hrp: string, bytes: Uint8Array): string {
  const data = regroup(bytes, 8, 5, true)!;
  const mod = polymod([...expand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = [0, 1, 2, 3, 4, 5].map((i) => (mod >> (5 * (5 - i))) & 31);
  return `${hrp}1${[...data, ...checksum].map((value) => CHARSET[value]).join('')}`;
}

function bech32Decode(text: string, hrp: string): Buffer | null {
  if (text !== text.toLowerCase() && text !== text.toUpperCase()) return null;
  const lower = text.toLowerCase();
  const split = lower.lastIndexOf('1');
  if (lower.slice(0, split) !== hrp || lower.length - split < 7) return null;
  const data = [...lower.slice(split + 1)].map((c) => CHARSET.indexOf(c));
  if (data.some((value) => value < 0) || polymod([...expand(hrp), ...data]) !== 1) return null;
  const bytes = regroup(data.slice(0, -6), 5, 8, false);
  return bytes ? Buffer.from(bytes) : null;
}

const PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex');
const SPKI = Buffer.from('302a300506032b656e032100', 'hex');
const privateFrom = (raw: Buffer) => createPrivateKey({ key: Buffer.concat([PKCS8, raw]), format: 'der', type: 'pkcs8' });
const publicFrom = (raw: Buffer) => createPublicKey({ key: Buffer.concat([SPKI, raw]), format: 'der', type: 'spki' });
const rawPublic = (key: KeyObject) => (key.export({ format: 'der', type: 'spki' }) as Buffer).subarray(SPKI.length);
const rawPrivate = (key: KeyObject) => (key.export({ format: 'der', type: 'pkcs8' }) as Buffer).subarray(PKCS8.length);

/** A new pair: what the server keeps, and the recovery key for whoever installs it. */
export function ageKeyPair(): { recipient: string; identity: string } {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  return { recipient: bech32Encode('age', rawPublic(publicKey)), identity: bech32Encode('age-secret-key-', rawPrivate(privateKey)).toUpperCase() };
}

/** The public key of a recovery key, to tell whether it is the one of a server. */
export function ageRecipientOf(identity: string): string {
  return bech32Encode('age', rawPublic(createPublicKey(privateFrom(parseIdentity(identity)))));
}

export const isAgeRecipient = (text: string) => bech32Decode(text.trim(), 'age')?.length === 32;

function parseIdentity(identity: string): Buffer {
  const raw = bech32Decode(identity.trim(), 'age-secret-key-');
  if (raw?.length !== 32 || !identity.trim().startsWith('AGE-SECRET-KEY-1')) throw new AgeError('not a recovery key', 'key');
  return raw;
}

const hkdf = (ikm: Buffer, salt: Buffer, info: string) => Buffer.from(hkdfSync('sha256', ikm, salt, info, 32));
const b64 = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');
function unb64(text: string): Buffer {
  const bytes = Buffer.from(text, 'base64');
  if (!/^[A-Za-z0-9+/]*$/.test(text) || b64(bytes) !== text) throw new AgeError('bad base64 in the header', 'format');
  return bytes;
}

function seal(key: Buffer, nonce: Buffer, plain: Buffer): Buffer {
  const cipher = createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: TAG });
  return Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
}

function open(key: Buffer, nonce: Buffer, sealed: Buffer): Buffer | null {
  if (sealed.length < TAG) return null;
  const decipher = createDecipheriv('chacha20-poly1305', key, nonce, { authTagLength: TAG });
  decipher.setAuthTag(sealed.subarray(sealed.length - TAG));
  try {
    return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG)), decipher.final()]);
  } catch {
    return null;
  }
}

/** 11 bytes of counter, big endian, and one that says whether it is the last chunk. */
function chunkNonce(counter: number, last: boolean): Buffer {
  const nonce = Buffer.alloc(12);
  nonce.writeUIntBE(counter, 5, 6);
  nonce[11] = last ? 1 : 0;
  return nonce;
}

/** Encrypts what comes in to the public key «age1…». */
export async function* ageEncrypt(recipient: string, input: AsyncIterable<Uint8Array>): AsyncGenerator<Buffer> {
  const theirs = bech32Decode(recipient.trim(), 'age');
  if (theirs?.length !== 32) throw new AgeError('not a public key', 'key');
  const fileKey = randomBytes(16);
  const ephemeral = generateKeyPairSync('x25519');
  const share = rawPublic(ephemeral.publicKey);
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: publicFrom(theirs) });
  const wrapped = seal(hkdf(shared, Buffer.concat([share, theirs]), 'age-encryption.org/v1/X25519'), Buffer.alloc(12), fileKey);
  const header = `${INTRO}\n-> X25519 ${b64(share)}\n${b64(wrapped)}\n---`;
  const mac = createHmac('sha256', hkdf(fileKey, Buffer.alloc(0), 'header')).update(header).digest();
  const nonce = randomBytes(16);
  yield Buffer.concat([Buffer.from(`${header} ${b64(mac)}\n`), nonce]);
  const key = hkdf(fileKey, nonce, 'payload');
  let pending = Buffer.alloc(0);
  let counter = 0;
  for await (const piece of input) {
    pending = Buffer.concat([pending, piece]);
    // A full chunk goes only once something comes after it: the last one says it is the last.
    while (pending.length > CHUNK) {
      yield seal(key, chunkNonce(counter++, false), pending.subarray(0, CHUNK));
      pending = pending.subarray(CHUNK);
    }
  }
  yield seal(key, chunkNonce(counter, true), pending);
}

/** Opens a backup with the recovery key «AGE-SECRET-KEY-1…». Nothing comes out that did not pass its check. */
export async function* ageDecrypt(identity: string, input: AsyncIterable<Uint8Array>): AsyncGenerator<Buffer> {
  const mine = privateFrom(parseIdentity(identity));
  const minePublic = rawPublic(createPublicKey(mine));
  const source = input[Symbol.asyncIterator]();
  let buffered = Buffer.alloc(0);
  let ended = false;
  const more = async () => {
    const next = await source.next();
    if (next.done) ended = true;
    else buffered = Buffer.concat([buffered, next.value]);
  };

  // The header: text lines up to the one of the MAC.
  let end = -1;
  while (end < 0) {
    const mark = buffered.indexOf('\n---');
    if (mark >= 0) end = buffered.indexOf('\n', mark + 1);
    if (end >= 0) break;
    if (ended || buffered.length > MAX_HEADER) throw new AgeError('no age header', 'format');
    await more();
  }
  const lines = buffered.subarray(0, end).toString('latin1').split('\n');
  buffered = buffered.subarray(end + 1);
  if (lines[0] !== INTRO) throw new AgeError('no age header', 'format');
  const last = lines.at(-1)!;
  if (!last.startsWith('--- ')) throw new AgeError('no MAC line', 'format');
  let fileKey: Buffer | null = null;
  for (let i = 1; i < lines.length - 1; ) {
    const args = lines[i]!.split(' ');
    if (args[0] !== '->' || args.length < 2) throw new AgeError('bad stanza', 'format');
    const body: string[] = [];
    for (i += 1; i < lines.length - 1; i += 1) {
      body.push(lines[i]!);
      if (lines[i]!.length < 64) break;
    }
    i += 1;
    if (fileKey || args[1] !== 'X25519' || args.length !== 3) continue;
    const share = unb64(args[2]!);
    const wrapped = unb64(body.join(''));
    if (share.length !== 32 || wrapped.length !== 32) throw new AgeError('bad X25519 stanza', 'format');
    const shared = diffieHellman({ privateKey: mine, publicKey: publicFrom(share) });
    if (shared.every((byte) => byte === 0)) throw new AgeError('bad X25519 share', 'format');
    fileKey = open(hkdf(shared, Buffer.concat([share, minePublic]), 'age-encryption.org/v1/X25519'), Buffer.alloc(12), wrapped);
  }
  if (!fileKey) throw new AgeError('this recovery key does not open it', 'key');
  const header = lines.join('\n').slice(0, -(last.length - 3));
  const expected = createHmac('sha256', hkdf(fileKey, Buffer.alloc(0), 'header')).update(header, 'latin1').digest();
  const mac = unb64(last.slice(4));
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) throw new AgeError('the header was changed', 'format');

  while (buffered.length < 16 && !ended) await more();
  if (buffered.length < 16) throw new AgeError('incomplete', 'format');
  const key = hkdf(fileKey, buffered.subarray(0, 16), 'payload');
  buffered = buffered.subarray(16);
  let counter = 0;
  for (;;) {
    while (buffered.length <= CHUNK + TAG && !ended) await more();
    if (buffered.length > CHUNK + TAG) {
      const plain = open(key, chunkNonce(counter++, false), buffered.subarray(0, CHUNK + TAG));
      if (!plain) throw new AgeError('a part was changed or is missing', 'format');
      buffered = buffered.subarray(CHUNK + TAG);
      yield plain;
      continue;
    }
    const plain = open(key, chunkNonce(counter, true), buffered);
    // Only a backup with nothing in it ends in an empty chunk, and only as its first.
    if (!plain || (plain.length === 0 && counter > 0)) throw new AgeError('incomplete, or a part was changed', 'format');
    yield plain;
    return;
  }
}
