import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const script = new URL('../../../deploy/server/urna', import.meta.url).pathname;
const has = (tool: string) => spawnSync(tool, ['--version']).status === 0;
const KEY = 'AAAAA-BBBBB-CCCCC-DDDDD-EEEEE';
const FIELD_KEY = 'ab'.repeat(32);
const PHOTO = 'c'.repeat(64);

/**
 * «urna restaurar» on the machine, with a backup that may come from someone else. Podman is a stand-in that does
 * nothing, so only what the script does on the machine itself runs, with the real gpg and tar.
 */
describe.skipIf(!has('gpg') || !has('tar'))('restoring a backup', () => {
  const root = mkdtempSync(join(tmpdir(), 'urna-restaurar-'));
  const gnupg = join(root, 'gnupg');
  mkdirSync(gnupg, { mode: 0o700 });
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'podman'), '#!/bin/sh\ncase "$1" in\n  unshare) shift; exec "$@" ;;\n  inspect) echo 0 ;;\n  *) exit 0 ;;\nesac\n', { mode: 0o755 });
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  let count = 0;
  const env = { ...process.env, GNUPGHOME: gnupg, PATH: `${bin}:${process.env.PATH}`, URNA_HEALTH_URL: 'file:///etc/hostname' };

  /** A server as the installation leaves it, with a photo of its own. */
  function server() {
    const home = join(root, `opt-${(count += 1)}`);
    mkdirSync(join(home, 'fotos'), { recursive: true });
    mkdirSync(join(home, '.config/systemd/user'), { recursive: true });
    copyFileSync(script, join(home, 'urna'));
    writeFileSync(join(home, '.env'), ['POSTGRES_PASSWORD=inventada', `URNA_FIELD_KEY=${'0'.repeat(64)}`, `URNA_BACKUP_KEY=${KEY}`, 'URNA_SITE=https://192.0.2.10', 'URNA_CERT=ip', 'URNA_IMAGE_SERVER=localhost/urna-server:v1', 'URNA_IMAGE_WEB=localhost/urna-web:v1', 'URNA_IMAGE_DB=localhost/postgres:18', ''].join('\n'), { mode: 0o600 });
    writeFileSync(join(home, 'fotos', 'propia'), 'foto de antes');
    const restore = (file: string) => {
      const done = spawnSync('sh', [join(home, 'urna'), 'restaurar', file, KEY], { env: { ...env, URNA_HOME: home }, encoding: 'utf8' });
      return { ok: done.status === 0, said: `${done.stdout}${done.stderr}` };
    };
    const untouched = () =>
      readFileSync(join(home, 'urna'), 'utf8') === readFileSync(script, 'utf8') &&
      readFileSync(join(home, '.env'), 'utf8').includes(`URNA_FIELD_KEY=${'0'.repeat(64)}\n`) &&
      !existsSync(join(home, '.config/systemd/user/urna-copia.service')) &&
      existsSync(join(home, 'fotos', 'propia'));
    return { home, restore, untouched };
  }

  /** A backup: its files as given, and fotos.tar made from what `photos` leaves in a folder. */
  function backup({ fieldKey = FIELD_KEY, photos = (_stage: string) => undefined as void, outer = (_payload: string) => [] as string[] } = {}): string {
    const payload = mkdtempSync(join(root, 'copia-'));
    const stage = join(payload, 'stage');
    mkdirSync(join(stage, 'fotos'), { recursive: true });
    writeFileSync(join(stage, 'fotos', PHOTO), 'foto de la copia');
    photos(stage);
    execFileSync('tar', ['-C', stage, '-cf', join(payload, 'fotos.tar'), ...execFileSync('ls', ['-A', stage], { encoding: 'utf8' }).trim().split('\n')]);
    writeFileSync(join(payload, 'base.dump'), 'no es una base de verdad');
    writeFileSync(join(payload, 'clave-campos'), fieldKey);
    const members = ['base.dump', 'fotos.tar', 'clave-campos', ...outer(payload)];
    execFileSync('tar', ['-C', payload, '-cf', join(payload, 'copia.tar'), ...members]);
    const file = join(payload, 'copia.tar.gpg');
    execFileSync('gpg', ['--batch', '--yes', '--quiet', '--pinentry-mode', 'loopback', '--passphrase', KEY, '--symmetric', '--cipher-algo', 'AES256', '-o', file, join(payload, 'copia.tar')], { env });
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
