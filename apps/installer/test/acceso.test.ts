import { describe, expect, it } from 'vitest';
import { accessFile, readme } from '../src/access.ts';
import { newSecrets, renderScript } from '../src/settings.ts';

const access = { address: 'https://203.0.113.24', setupLink: 'https://203.0.113.24/#setup=ABC', recoveryKey: 'AAAAA-BBBBB', user: 'urna-admin', key: '-----BEGIN OPENSSH PRIVATE KEY-----\nclave\n-----END OPENSSH PRIVATE KEY-----\n' };

/** The names and contents of a zip without compression, read from its central directory. */
function unzip(file: Buffer): Record<string, string> {
  const end = file.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let at = file.readUInt32LE(end + 16);
  const found: Record<string, string> = {};
  for (let entry = 0; entry < file.readUInt16LE(end + 10); entry++) {
    const size = file.readUInt32LE(at + 20);
    const nameLength = file.readUInt16LE(at + 28);
    const local = file.readUInt32LE(at + 42);
    const name = file.subarray(at + 46, at + 46 + nameLength).toString();
    const start = local + 30 + file.readUInt16LE(local + 26) + file.readUInt16LE(local + 28);
    found[name] = file.subarray(start, start + size).toString();
    at += 46 + nameLength;
  }
  return found;
}

describe('the access file', () => {
  it('brings the instructions and the key apart, in the language of the installer', () => {
    const files = unzip(accessFile(access, 'es'));
    expect(Object.keys(files)).toEqual(['LEEME.txt', 'urna-abierta.key']);
    expect(files['urna-abierta.key']).toBe(access.key);
    expect(files['LEEME.txt']).toContain('ssh -i urna-abierta.key urna-admin@203.0.113.24');
    expect(files['LEEME.txt']).toContain('Llave de recuperación: AAAAA-BBBBB');
    expect(files['LEEME.txt']).not.toContain('PRIVATE KEY');
    expect(Object.keys(unzip(accessFile(access, 'en')))).toEqual(['README.txt', 'urna-abierta.key']);
  });

  it('says where to connect even before a pasted server has an address', () => {
    expect(readme({ ...access, address: '', setupLink: '' }, 'es')).toContain('urna-admin@LA-DIRECCIÓN-DE-TU-SERVIDOR');
  });

  it('the server gets only the public half, and turns passwords off only for whoever came in with one', () => {
    const secrets = newSecrets();
    const settings = { secrets, site: 'https://203.0.113.24', cert: 'ip' as const, theme: 'aula' };
    const script = renderScript(settings);
    expect(script).toContain(`URNA_ADMIN_KEY=${secrets.adminKey!.public.split(' ')[1]}`);
    expect(script).not.toContain('PRIVATE KEY');
    expect(script).not.toMatch(/^URNA_SOLO_LLAVES=/m);
    expect(renderScript({ ...settings, keysOnly: true })).toContain('URNA_SOLO_LLAVES=si');
  });
});
