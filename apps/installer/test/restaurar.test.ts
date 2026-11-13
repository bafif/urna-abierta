import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ageKeyPair } from '../../server/src/age.ts';

const script = new URL('../../../deploy/server/urna', import.meta.url).pathname;
const has = (tool: string) => spawnSync(tool, ['--version']).status === 0;
const { identity: KEY, recipient: PUBLIC_KEY } = ageKeyPair();
/** The key of an installation from before the public key, which encrypted with gpg. */
const OLD_KEY = 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEE';
const repo = new URL('../../../', import.meta.url).pathname;
const FIELD_KEY = 'ab'.repeat(32);
const PHOTO = 'c'.repeat(64);

/**
 * «urna restaurar» on the machine, with a backup that may come from someone else. Podman is a stand-in that does
 * nothing but open the backup, as the server's image does, so only what the script does on the machine itself runs,
 * with the real tar, and gpg for a backup from before the public key.
 */
describe.skipIf(!has('gpg') || !has('tar'))('restoring a backup', () => {
  const root = mkdtempSync(join(tmpdir(), 'urna-restaurar-'));
  const gnupg = join(root, 'gnupg');
  mkdirSync(gnupg, { mode: 0o700 });
  const bin = join(root, 'bin');
  mkdirSync(bin);
  // What reaches pg_restore is kept, with what the restore had in its temporary folder by then. With PRUEBA_BASE_FALLA,
  // the database refuses to be emptied, as one that asks for a password the command does not have.
  writeFileSync(join(bin, 'podman'), [
    '#!/bin/sh',
    'case "$1" in',
    '  unshare) shift; exec "$@" ;;',
    '  inspect) echo 0 ;;',
    '  run) while [ "$1" != node ]; do shift; done; shift; program=$1; shift; exec node "$PRUEBA_REPO/$program" "$@" ;;',
    '  exec)',
    '    case "$*" in',
    '      *pg_restore*) cat >"$PRUEBA_VOLCADO"; find "$TMPDIR" -type f >"$PRUEBA_VOLCADO.temporales" ;;',
    '      *DROP*) [ -z "${PRUEBA_BASE_FALLA:-}" ] || { echo "psql: error: fe_sendauth: no password supplied" >&2; exit 2; } ;;',
    '    esac ;;',
    'esac',
    'exit 0',
    '',
  ].join('\n'), { mode: 0o755 });
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  let count = 0;
  // What it says is checked in Spanish; one test checks the English.
  const env = { ...process.env, PRUEBA_REPO: repo, GNUPGHOME: gnupg, PATH: `${bin}:${process.env.PATH}`, URNA_HEALTH_URL: 'file:///etc/hostname', URNA_IDIOMA: 'es' };

  /** A server as the installation leaves it, with a photo of its own. */
  function server() {
    const home = join(root, `opt-${(count += 1)}`);
    mkdirSync(join(home, 'fotos'), { recursive: true });
    mkdirSync(join(home, '.config/systemd/user'), { recursive: true });
    copyFileSync(script, join(home, 'urna'));
    writeFileSync(join(home, '.env'), ['POSTGRES_PASSWORD=inventada', `URNA_FIELD_KEY=${'0'.repeat(64)}`, `URNA_BACKUP_PUBLIC_KEY=${PUBLIC_KEY}`, 'URNA_SITE=https://192.0.2.10', 'URNA_CERT=ip', 'URNA_IMAGE_SERVER=localhost/urna-server:v1', 'URNA_IMAGE_WEB=localhost/urna-web:v1', 'URNA_IMAGE_DB=localhost/postgres:18', ''].join('\n'), { mode: 0o600 });
    writeFileSync(join(home, 'fotos', 'propia'), 'foto de antes');
    const temporary = join(root, `tmp-${count}`);
    mkdirSync(temporary);
    const dump = join(root, `volcado-${count}`);
    const restore = (file: string, more: Record<string, string> = {}, key = KEY) => {
      const done = spawnSync('sh', [join(home, 'urna'), 'restaurar', file, key], { env: { ...env, URNA_HOME: home, TMPDIR: temporary, PRUEBA_VOLCADO: dump, ...more }, encoding: 'utf8' });
      return { ok: done.status === 0, said: `${done.stdout}${done.stderr}` };
    };
    const untouched = () =>
      readFileSync(join(home, 'urna'), 'utf8') === readFileSync(script, 'utf8') &&
      readFileSync(join(home, '.env'), 'utf8').includes(`URNA_FIELD_KEY=${'0'.repeat(64)}\n`) &&
      !existsSync(join(home, '.config/systemd/user/urna-copia.service')) &&
      existsSync(join(home, 'fotos', 'propia'));
    return { home, restore, untouched, dump };
  }

  /** A backup: its files as given, and fotos.tar made from what `photos` leaves in a folder. */
  function backup({ fieldKey = FIELD_KEY, photos = (_stage: string) => undefined as void, outer = (_payload: string) => [] as string[], leave = [] as string[], gpg = false } = {}): string {
    const payload = mkdtempSync(join(root, 'copia-'));
    const stage = join(payload, 'stage');
    mkdirSync(join(stage, 'fotos'), { recursive: true });
    writeFileSync(join(stage, 'fotos', PHOTO), 'foto de la copia');
    photos(stage);
    execFileSync('tar', ['-C', stage, '-cf', join(payload, 'fotos.tar'), ...execFileSync('ls', ['-A', stage], { encoding: 'utf8' }).trim().split('\n')]);
    writeFileSync(join(payload, 'base.dump'), 'no es una base de verdad');
    writeFileSync(join(payload, 'clave-campos'), fieldKey);
    const members = [...['base.dump', 'fotos.tar', 'clave-campos'].filter((member) => !leave.includes(member)), ...outer(payload)];
    execFileSync('tar', ['-C', payload, '-cf', join(payload, 'copia.tar'), ...members]);
    if (gpg) {
      const file = join(payload, 'copia.tar.gpg');
      execFileSync('gpg', ['--batch', '--yes', '--quiet', '--pinentry-mode', 'loopback', '--passphrase', OLD_KEY, '--symmetric', '--cipher-algo', 'AES256', '-o', file, join(payload, 'copia.tar')], { env });
      return file;
    }
    // As «urna copia» does it: to the public key, with the program of the server's image.
    const file = join(payload, 'copia.tar.age');
    writeFileSync(file, execFileSync('node', [join(repo, 'apps/server/src/backup-key.ts'), 'cifrar', PUBLIC_KEY], { input: readFileSync(join(payload, 'copia.tar')) }));
    return file;
  }

  it('puts a backup in place: its data, its field key and its photos', () => {
    const { home, restore } = server();
    const done = restore(backup());
    expect(done.said).toContain('Copia restaurada');
    expect(readFileSync(join(home, '.env'), 'utf8')).toContain(`URNA_FIELD_KEY=${FIELD_KEY}\n`);
    expect(readFileSync(join(home, 'fotos', PHOTO), 'utf8')).toBe('foto de la copia');
    expect(existsSync(join(home, 'fotos', 'propia'))).toBe(false);
  });

  it('another key does not open it, and says which one does', () => {
    const { restore, untouched } = server();
    for (const key of [ageKeyPair().identity, OLD_KEY]) {
      const done = restore(backup(), {}, key);
      expect([done.ok, done.said.includes('Esa llave no abre esta copia'), done.said.includes('AGE-SECRET-KEY-1'), untouched()]).toEqual([false, true, true, true]);
    }
  });

  it('a backup from before the public key, made with gpg, still opens with its key', () => {
    const { home, restore } = server();
    expect(restore(backup({ gpg: true }), {}, OLD_KEY).said).toContain('Copia restaurada');
    expect(readFileSync(join(home, 'fotos', PHOTO), 'utf8')).toBe('foto de la copia');
    expect(restore(backup({ gpg: true }), {}, 'OTRA-LLAVE').said).toContain('Esa llave no abre esta copia');
  });

  it('says the same in English when the server is in English', () => {
    const { restore } = server();
    const done = restore(backup(), { URNA_IDIOMA: '', LANG: 'en_US.UTF-8', LC_ALL: '', LC_MESSAGES: '', LANGUAGE: '' });
    expect(done.said).toContain('Backup restored');
    const refused = server().restore(backup({ leave: ['clave-campos'] }), { URNA_IDIOMA: 'en' });
    expect([refused.ok, refused.said.includes('it is incomplete')]).toEqual([false, true]);
  });

  it('reads each file out of the backup as it goes: nothing of it is copied to the temporary folder but the backup itself', () => {
    const { restore, dump } = server();
    expect(restore(backup()).said).toContain('Copia restaurada');
    expect(readFileSync(dump, 'utf8')).toBe('no es una base de verdad');
    const there = readFileSync(`${dump}.temporales`, 'utf8').trim().split('\n');
    expect(there.some((file) => file.endsWith('/copia.tar'))).toBe(true);
    expect(there.filter((file) => /base\.dump|fotos\.tar|clave-campos|\/fotos\//.test(file))).toEqual([]);
  });

  it('says so when the database does not let its data go, and leaves the field key and the photos as they were', () => {
    const { restore, untouched, dump } = server();
    const done = restore(backup(), { PRUEBA_BASE_FALLA: 'si' });
    expect(done.ok).toBe(false);
    expect(done.said).toContain('no restauré nada');
    expect(done.said).toContain('fe_sendauth: no password supplied');
    expect(untouched()).toBe(true);
    expect(existsSync(dump)).toBe(false);
  });

  it('refuses a backup with one of its files twice, or with one missing', () => {
    const twice = server();
    const repeated = twice.restore(backup({ outer: () => ['base.dump'] }));
    expect([repeated.ok, repeated.said.includes('no restauré nada'), twice.untouched()]).toEqual([false, true, true]);
    const short = server();
    const missing = short.restore(backup({ leave: ['clave-campos'] }));
    expect([missing.ok, missing.said.includes('incompleto'), short.untouched()]).toEqual([false, true, true]);
  });

  const crafted: [string, Parameters<typeof backup>[0]][] = [
    ['photos that write outside their folder: the commands and a service', {
      photos: (stage) => {
        writeFileSync(join(stage, 'urna'), '#!/bin/sh\necho otro\n', { mode: 0o755 });
        mkdirSync(join(stage, '.config/systemd/user'), { recursive: true });
        writeFileSync(join(stage, '.config/systemd/user/urna-copia.service'), '[Service]\nExecStart=/bin/true\n');
      },
    }],
    ['a photo that is a link', { photos: (stage) => symlinkSync('../urna', join(stage, 'fotos', 'enlace')) }],
    ['a field key that is a command once .env is read', { fieldKey: 'x$(touch ../marca)' }],
    ['a file a backup does not hold', { outer: (payload) => (writeFileSync(join(payload, 'urna'), '#!/bin/sh\n'), ['urna']) }],
    ['one of its files as a link', { outer: (payload) => (symlinkSync('/etc/hostname', join(payload, 'enlace')), ['enlace']) }],
  ];
  for (const [what, parts] of crafted) {
    it(`refuses a backup with ${what}, and changes nothing`, () => {
      const { home, restore, untouched } = server();
      const done = restore(backup(parts));
      expect(done.ok).toBe(false);
      expect(done.said).toContain('no restauré nada');
      expect(untouched()).toBe(true);
      chmodSync(join(home, '.env'), 0o600);
      execFileSync('sh', ['-c', 'set -a; . ./.env'], { cwd: home });
      expect(existsSync(join(root, 'marca'))).toBe(false);
    });
  }
});
