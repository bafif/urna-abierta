/**
 * The real installation, over SSH, on two Ubuntu machines in containers, with invented data:
 * installs on the first, uses the app through its API, makes an encrypted backup, restores it on
 * the second and checks that everything is there. Then it reboots a machine and looks again.
 *
 *   node apps/installer/e2e/servidor.ts
 */
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newSecrets, renderScript, type Secrets } from '../src/settings.ts';
import { checkSsh, runScript, type SshTarget } from '../src/ssh.ts';

const root = new URL('../../../', import.meta.url).pathname;
const work = mkdtempSync(join(tmpdir(), 'urna-servidor-'));
const IMAGE = 'localhost/urna-maquina-prueba';
const results: { step: string; ok: boolean; detail?: unknown }[] = [];

const podman = (...args: string[]) => execFileSync('podman', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function record(step: string, ok: boolean, detail?: unknown): void {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'ok   ' : 'FALLA'} ${step}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
}

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
function opensshPublic(pem: string): string {
  // ssh-rsa from the key's own numbers, so that the test does not depend on ssh-keygen.
  const jwk = (execFileSync(process.execPath, ['-e', `const c=require('node:crypto');process.stdout.write(JSON.stringify(c.createPublicKey(${JSON.stringify(pem)}).export({format:'jwk'})))`], { encoding: 'utf8' }));
  const { n, e } = JSON.parse(jwk) as { n: string; e: string };
  const part = (data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, data]);
  };
  const positive = (value: string) => {
    const bytes = Buffer.from(value, 'base64url');
    return bytes[0]! & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes;
  };
  return `ssh-rsa ${Buffer.concat([part(Buffer.from('ssh-rsa')), part(positive(e)), part(positive(n))]).toString('base64')} prueba`;
}

async function machine(name: string, sshPort: number, webPort: number): Promise<{ target: SshTarget; name: string; web: number }> {
  podman('rm', '-f', name);
  podman('run', '-d', '--name', name, '--hostname', name, '--privileged', '--systemd=always', '--device', '/dev/fuse', '-p', `127.0.0.1:${sshPort}:22`, '-p', `127.0.0.1:${webPort}:443`, IMAGE);
  podman('exec', '-i', name, 'sh', '-c', `echo '${opensshPublic(publicKey)}' > /home/ubuntu/.ssh/authorized_keys; chown ubuntu:ubuntu /home/ubuntu/.ssh/authorized_keys; chmod 600 /home/ubuntu/.ssh/authorized_keys`);
  const target: SshTarget = { host: '127.0.0.1', port: sshPort, user: 'ubuntu', privateKey };
  for (let attempt = 0; ; attempt += 1) {
    try {
      if ((await checkSsh(target)) === 'ok') break;
    } catch (error) {
      if (attempt > 30) throw error;
    }
    await sleep(2_000);
  }
  return { target, name, web: webPort };
}

const imageFile = join(work, 'imagenes.tar');
const inside = '/tmp/imagenes.tar';
const images = { db: 'docker.io/library/postgres:18-alpine', server: 'localhost/urna-server:latest', web: 'localhost/urna-web:latest' };

async function installOn(m: { target: SshTarget; name: string }, secrets: Secrets, theme = 'mate'): Promise<string[]> {
  podman('cp', imageFile, `${m.name}:${inside}`);
  podman('exec', m.name, 'chmod', '644', inside);
  const script = renderScript({
    secrets, site: 'https://localhost', cert: 'internal', theme, images, imagesTar: inside,
    extraEnv: ['URNA_NETWORK=host', 'URNA_PORTS='],
  }).replace('URNA_EXTRA_ENV=', 'URNA_NO_SWAP=si\nURNA_EXTRA_ENV=');
  const lines: string[] = [];
  await runScript(m.target, script, (line) => {
    if (line.startsWith('urna-abierta:')) lines.push(line.slice(14));
  });
  return lines;
}

/** Asks the server from inside its machine, where the certificate does not get in the way. */
function api(m: { name: string }, method: string, path: string, { token, body }: { token?: string; body?: unknown } = {}): any {
  const args = ['exec', m.name, 'curl', '-sk', '--max-time', '30', '-X', method, `https://localhost/api${path}`];
  if (token) args.push('-H', `authorization: Bearer ${token}`);
  if (body !== undefined) args.push('-H', 'content-type: application/json', '-d', JSON.stringify(body));
  const out = podman(...args);
  return out ? JSON.parse(out) : {};
}

const urna = (m: { name: string }, ...args: string[]) => podman('exec', m.name, 'urna', ...args);

console.log('Armando las imágenes y la máquina…');
execFileSync('bash', ['-c', `podman build -q -t urna-server -f deploy/server.Containerfile . >/dev/null && podman build -q -t urna-web -f deploy/web.Containerfile . >/dev/null && podman build -q -t urna-maquina-prueba -f deploy/maquina-prueba.Containerfile deploy >/dev/null`], { cwd: root, stdio: 'inherit' });
podman('pull', '-q', images.db);
podman('save', '-q', '--multi-image-archive', '-o', imageFile, images.db, images.server, images.web);

const first = await machine('urna-maquina-1', 2221, 8441);
const secrets = newSecrets();
const said = await installOn(first, secrets);
record('instala por SSH en un Ubuntu', said.at(-1)?.startsWith('listo en') === true, said);

const pub = api(first, 'GET', '/public');
record('la app responde, pide el primer administrador y usa el tema elegido', pub.setupNeeded === true && pub.party.theme === 'mate', pub);

const refused = api(first, 'POST', '/setup', { body: { code: 'otro', name: 'Laura', accepted: true } });
const { token } = api(first, 'POST', '/setup', { body: { code: secrets.setupCode, name: 'Laura', accepted: true } });
record('el primer administrador entra solo con el código', refused.error === 'wrong_code' && Boolean(token));

api(first, 'PUT', '/party', { token, body: { name: 'Agrupación Ejemplo', theme: 'mate' } });
const { id: election } = api(first, 'POST', '/elections', { token, body: { name: 'Simulacro', kind: 'estudiantil', days: ['2027-04-06'], categories: [] } });
const category = api(first, 'POST', '/semaphore/categories', { token, body: { name: 'Milita', color: '#D93A3A', sensitive: true } });
const roll = join(work, 'padron.csv');
writeFileSync(roll, `nombre,dni\n${Array.from({ length: 30 }, (_, i) => `Inventada ${i},${90000000 + i}`).join('\n')}\n`);
podman('cp', roll, `${first.name}:/tmp/padron.csv`);
podman('exec', first.name, 'curl', '-sk', '-X', 'POST', '-H', `authorization: Bearer ${token}`, '-H', 'content-type: text/csv', '--data-binary', '@/tmp/padron.csv', `https://localhost/api/elections/${election}/roll`);
const proposed = api(first, 'POST', `/elections/${election}/tables/propose`, { token, body: { size: 10 } });
const people = api(first, 'GET', `/elections/${election}/people?q=inventada%201`, { token }).people;
// A sensitive category needs its own permission, which not even whoever coordinates has by default.
const me = api(first, 'GET', '/me', { token });
api(first, 'POST', `/users/${me.user.id}/roles`, { token, body: { role: 'semaforo_sensible' } });
const noted = api(first, 'PUT', `/elections/${election}/people/${encodeURIComponent(people[0].id)}/semaphore`, { token, body: { category: category.id } });
record('se puede cargar una elección de verdad', proposed.created === 3 && people.length > 0 && noted.ok === true, { mesas: proposed.created });

const backup = urna(first, 'copia').split('\n').at(-1)!;
const encrypted = podman('exec', first.name, 'head', '-c', '2000000', backup);
record('hace una copia cifrada: no se lee ningún nombre', !encrypted.includes('Inventada'), { archivo: backup });
const listed = api(first, 'GET', '/backups', { token });
record('la copia se puede bajar desde la app', listed.backups?.length === 1, listed.backups?.[0]);

const state = urna(first, 'estado');
record('«urna estado» dice que está todo bien', state.includes('Todo en orden'), state.split('\n'));

const copy = join(work, 'copia.tar.gpg');
podman('cp', `${first.name}:${backup}`, copy);

// The drill: the first server is gone, and everything has to be recovered on another one.
const second = await machine('urna-maquina-2', 2222, 8442);
await installOn(second, newSecrets());
podman('cp', copy, `${second.name}:/tmp/copia.tar.gpg`);
podman('exec', second.name, 'chmod', '644', '/tmp/copia.tar.gpg');
let wrongKey = false;
try {
  urna(second, 'restaurar', '/tmp/copia.tar.gpg', 'LLAVE-EQUIVOCADA');
} catch {
  wrongKey = true;
}
record('con otra llave, la copia no se abre', wrongKey);
const restored = urna(second, 'restaurar', '/tmp/copia.tar.gpg', secrets.recoveryKey);
record('restaura la copia en otro servidor', restored.includes('Copia restaurada'));
const elections = api(second, 'GET', '/elections', { token }).elections;
record('en el otro servidor está todo, y las mismas sesiones siguen valiendo', elections?.[0]?.name === 'Simulacro' && elections[0].people === 30 && elections[0].tables === 3, elections?.[0]);
const again = api(second, 'GET', `/elections/${election}/people?q=inventada%201`, { token }).people.find((item: { id: string }) => item.id === people[0].id);
record('las categorías sensibles se pueden leer después de restaurar', again?.category === category.id);

// A reboot: everything has to come back by itself.
podman('restart', first.name);
await sleep(15_000);
let back = false;
for (let attempt = 0; attempt < 60 && !back; attempt += 1) {
  try {
    back = api(first, 'GET', '/health').ok === true;
  } catch {
    // Still starting.
  }
  if (!back) await sleep(5_000);
}
record('después de reiniciar la máquina vuelve sola', back);

if (!process.env.URNA_DEJAR_MAQUINAS) {
  podman('rm', '-f', first.name, second.name);
}
const failed = results.filter((item) => !item.ok);
console.log(failed.length ? `Fallaron ${failed.length} de ${results.length}.` : `Pasaron las ${results.length}.`);
process.exit(failed.length ? 1 : 0);
