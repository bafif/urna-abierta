/**
 * The real installation, over SSH, on two Ubuntu machines in containers, with invented data:
 * installs on the first, uses the app through its API, makes an encrypted backup that also goes to
 * a bucket, updates it to a next version, goes back from one that changes the database and does not
 * start, restores the backup on the second and checks that
 * everything is there. Then it reboots a machine and looks again.
 *
 *   node apps/installer/e2e/servidor.ts
 *
 * URNA_E2E_NAME and URNA_E2E_PORT (the first of five ports) let it run next to another copy.
 */
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EMPTY_SHA256, amzDate, s3Client, signS3 } from '../../server/src/s3.ts';
import { newSecrets, renderScript, type Secrets } from '../src/settings.ts';
import { checkSsh, runScript, type SshTarget } from '../src/ssh.ts';
import { attempt, buildImages, finish, podman, record, sleep } from './maquinas.ts';

const work = mkdtempSync(join(tmpdir(), 'urna-servidor-'));
const name = process.env.URNA_E2E_NAME ?? 'urna-maquina';
const port = Number(process.env.URNA_E2E_PORT ?? 2221);
const IMAGE = `localhost/${name}-prueba`;
const network = `${name}-red`;

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
  podman('run', '-d', '--name', name, '--hostname', name, '--network', network, '--privileged', '--systemd=always', '--device', '/dev/fuse', '-p', `127.0.0.1:${sshPort}:22`, '-p', `127.0.0.1:${webPort}:443`, IMAGE);
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
const nextFile = join(work, 'imagenes-nuevas.tar');
const inside = '/tmp/imagenes.tar';
// Installed as version «anterior», and updated to «nueva»: the same build, plus a migration and a line in its commands.
const images = { db: 'docker.io/library/postgres:18-alpine', server: `localhost/${name}-server:anterior`, web: `localhost/${name}-web:anterior` };
const next = { server: `localhost/${name}-server:nueva`, web: `localhost/${name}-web:nueva` };
// And then to «rota», which changes the database and stops right after, as a version with a bug would.
const brokenFile = join(work, 'imagenes-rotas.tar');
const broken = { server: `localhost/${name}-server:rota`, web: `localhost/${name}-web:rota` };

// A bucket, as a party would have it with another provider, that the first machine reaches by name.
const bucket = { endpoint: `http://127.0.0.1:${port + 4}`, inside: `http://${name}-minio:9000`, name: 'urna-prueba', region: 'us-east-1', accessKeyId: 'urnaprueba', secretAccessKey: 'secreto-de-prueba' };
const s3Settings = [`URNA_S3_ENDPOINT=${bucket.inside}`, `URNA_S3_BUCKET=${bucket.name}`, `URNA_S3_ACCESS_KEY_ID=${bucket.accessKeyId}`, `URNA_S3_SECRET_ACCESS_KEY=${bucket.secretAccessKey}`];

/** `variables` go where the installation reads them, as the settings of a bucket would be written by hand. */
async function installOn(m: { target: SshTarget; name: string }, secrets: Secrets, { theme = 'mate', variables = [] as string[] } = {}): Promise<string[]> {
  podman('cp', imageFile, `${m.name}:${inside}`);
  podman('exec', m.name, 'chmod', '644', inside);
  const script = renderScript({
    secrets, site: 'https://localhost', cert: 'internal', theme, images, imagesTar: inside,
    extraEnv: ['URNA_NETWORK=host', 'URNA_PORTS='],
  }).replace('URNA_EXTRA_ENV=', ['URNA_NO_SWAP=si', ...variables, 'URNA_EXTRA_ENV='].join('\n'));
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
/** As the user that owns the containers, the way `urna` runs them. */
const asUrna = (m: { name: string }, ...args: string[]) =>
  podman('exec', m.name, 'sh', '-c', 'runuser -u urna -- env XDG_RUNTIME_DIR=/run/user/$(id -u urna) HOME=/opt/urna-abierta "$@"', 'sh', ...args);
/** A container next to the database, in the same pod, as the web one is, that asks it for something with that password or none. */
const fromThePod = (m: { name: string }, password?: string) =>
  attempt('exec', m.name, 'sh', '-c', 'runuser -u urna -- env XDG_RUNTIME_DIR=/run/user/$(id -u urna) HOME=/opt/urna-abierta "$@"', 'sh',
    'podman', 'run', '--rm', '--pod', 'urna', ...(password ? ['-e', `PGPASSWORD=${password}`] : []), images.db, 'psql', '-h', '127.0.0.1', '-U', 'urna', '-w', '-tAc', 'SELECT 1');
const raw = s3Client({ endpoint: bucket.endpoint, bucket: bucket.name, region: bucket.region, accessKeyId: bucket.accessKeyId, secretAccessKey: bucket.secretAccessKey });

/** A backup made by hand, opened by `key`, whose photos would replace the commands and add a service, with that field key. */
function craftedBackup(key: string, fieldKey: string): string {
  const folder = mkdtempSync(join(work, 'trucha-'));
  const gnupg = mkdtempSync(join(work, 'gnupg-'));
  const stage = join(folder, 'stage');
  mkdirSync(join(stage, 'fotos'), { recursive: true });
  mkdirSync(join(stage, '.config/systemd/user'), { recursive: true });
  writeFileSync(join(stage, 'fotos', 'a'.repeat(64)), 'foto');
  writeFileSync(join(stage, 'urna'), '#!/bin/sh\ntouch /tmp/marca-trucha-urna\n', { mode: 0o755 });
  writeFileSync(join(stage, '.config/systemd/user/urna-copia.service'), '[Service]\nExecStart=/bin/touch /tmp/marca-trucha-servicio\n');
  execFileSync('tar', ['-C', stage, '-cf', join(folder, 'fotos.tar'), 'fotos', 'urna', '.config']);
  writeFileSync(join(folder, 'base.dump'), 'no es una base');
  writeFileSync(join(folder, 'clave-campos'), fieldKey);
  execFileSync('tar', ['-C', folder, '-cf', join(folder, 'copia.tar'), 'base.dump', 'fotos.tar', 'clave-campos']);
  const file = join(folder, 'copia.tar.gpg');
  execFileSync('gpg', ['--batch', '--yes', '--quiet', '--pinentry-mode', 'loopback', '--passphrase', key, '--symmetric', '--cipher-algo', 'AES256', '-o', file, join(folder, 'copia.tar')], { env: { ...process.env, GNUPGHOME: gnupg } });
  return file;
}

function cleanup(): void {
  for (const each of [`${name}-1`, `${name}-2`, `${name}-minio`]) attempt('rm', '-f', each);
  attempt('network', 'rm', network);
}

console.log('Armando las imágenes y la máquina…');
buildImages({ server: images.server, web: images.web, machine: IMAGE });
const nextBuild = mkdtempSync(join(work, 'nueva-'));
writeFileSync(join(nextBuild, 'Containerfile'), [
  `FROM ${images.server}`,
  'USER root',
  `RUN printf 'CREATE TABLE prueba_actualizacion (id int);\\n' > apps/server/src/migrations/9999-prueba-actualizacion.sql && echo '# versión nueva' >> urna`,
  'USER node',
].join('\n'));
podman('build', '-q', '-t', next.server, nextBuild);
podman('tag', images.web, next.web);
const brokenBuild = mkdtempSync(join(work, 'rota-'));
writeFileSync(join(brokenBuild, 'Containerfile'), [
  `FROM ${next.server}`,
  'USER root',
  `RUN printf 'CREATE TABLE prueba_rota (id int);\\n' > apps/server/src/migrations/9998-prueba-rota.sql && sed -i 's/^  const migrated = await migrate(pool);$/& process.exit(3);/' apps/server/src/main.ts && grep -q 'process.exit(3)' apps/server/src/main.ts`,
  'USER node',
].join('\n'));
podman('build', '-q', '-t', broken.server, brokenBuild);
podman('tag', images.web, broken.web);
podman('pull', '-q', images.db);
podman('save', '-q', '--multi-image-archive', '-o', imageFile, images.db, images.server, images.web);
podman('save', '-q', '--multi-image-archive', '-o', nextFile, next.server, next.web);
podman('save', '-q', '--multi-image-archive', '-o', brokenFile, broken.server, broken.web);

cleanup();
podman('network', 'create', network);
podman('run', '-d', '--name', `${name}-minio`, '--network', network, '-p', `127.0.0.1:${port + 4}:9000`, '-e', `MINIO_ROOT_USER=${bucket.accessKeyId}`, '-e', `MINIO_ROOT_PASSWORD=${bucket.secretAccessKey}`, 'docker.io/pgsty/minio:latest', 'server', '/data');
for (let attempt = 0; ; attempt += 1) {
  const date = amzDate(new Date());
  const signed = signS3({ method: 'PUT', host: `127.0.0.1:${port + 4}`, path: `/${bucket.name}`, payloadHash: EMPTY_SHA256, region: bucket.region, accessKeyId: bucket.accessKeyId, secretAccessKey: bucket.secretAccessKey, date });
  const made = await fetch(`${bucket.endpoint}${signed.path}`, { method: 'PUT', headers: signed.headers }).catch(() => null);
  if (made?.ok) break;
  if (attempt > 30) throw new Error(`no se pudo crear el bucket: ${made?.status}`);
  await sleep(1_000);
}

const first = await machine(`${name}-1`, port, port + 2);
const secrets = newSecrets();
const said = await installOn(first, secrets, { variables: s3Settings });
record('instala por SSH en un Ubuntu', said.at(-1)?.startsWith('ready ') === true, said);
const madeThere = podman('exec', first.name, 'cat', '/opt/urna-abierta/.env');
record('la clave de la base y la de los campos se hacen en el servidor, y el código de instalación queda solo como resumen', /^POSTGRES_PASSWORD=[0-9a-f]{48}$/m.test(madeThere) && /^URNA_FIELD_KEY=[0-9a-f]{64}$/m.test(madeThere) && /^URNA_SETUP_CODE_HASH=[0-9a-f]{64}$/m.test(madeThere) && !madeThere.includes(secrets.setupCode));

const pub = api(first, 'GET', '/public');
record('la app responde, pide el primer administrador y usa el tema elegido', pub.setupNeeded === true && pub.party.theme === 'mate', pub);

const refused = api(first, 'POST', '/setup', { body: { code: 'otro', name: 'Laura', accepted: true } });
const { token } = api(first, 'POST', '/setup', { body: { code: secrets.setupCode, name: 'Laura', accepted: true } });
record('el primer administrador entra solo con el código', refused.error === 'wrong_code' && Boolean(token));
const noPassword = fromThePod(first);
const wrongPassword = fromThePod(first, 'otra');
record('dentro del pod, la base pide su clave: un contenedor vecino, como el de la web, no entra sin ella', !noPassword.ok && noPassword.said.includes('no password supplied') && !wrongPassword.ok && wrongPassword.said.includes('password authentication failed'), [noPassword.said.trim(), wrongPassword.said.trim()]);

api(first, 'PUT', '/party', { token, body: { name: 'Agrupación Ejemplo', theme: 'mate' } });
const { id: election } = api(first, 'POST', '/elections', { token, body: { name: 'Simulacro', kind: 'estudiantil', days: ['2027-04-06'], categories: [] } });
const category = api(first, 'POST', '/semaphore/categories', { token, body: { name: 'Milita', color: '#D93A3A', sensitive: true } });
const roll = join(work, 'padron.csv');
writeFileSync(roll, `nombre,dni\n${Array.from({ length: 30 }, (_, i) => `Inventada ${i},${90000000 + i}`).join('\n')}\n`);
podman('cp', roll, `${first.name}:/tmp/padron.csv`);
podman('exec', first.name, 'curl', '-sk', '-X', 'POST', '-H', `authorization: Bearer ${token}`, '-H', 'content-type: text/csv', '--data-binary', '@/tmp/padron.csv', `https://localhost/api/elections/${election}/roll`);
const proposed = api(first, 'POST', `/elections/${election}/tables/propose`, { token, body: { size: 10 } });
const people = api(first, 'GET', `/elections/${election}/people?q=90000001`, { token }).people;
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
const sent = await raw.list('fotos/backups/');
const inBucket = sent.length === 1 ? await raw.get(sent[0]!) : null;
record('la copia también sale del servidor, al bucket, cifrada', sent[0] === `fotos/backups/${backup.split('/').pop()}` && inBucket !== null && !inBucket.includes('Inventada'), sent);

const state = attempt('exec', first.name, 'urna', 'estado').said;
record('«urna estado» dice que está todo bien, y que las copias van al bucket', state.includes('Todo en orden') && state.includes(`bien   las copias también van al bucket ${bucket.name}`) && state.includes('versión: anterior'), state.split('\n'));

const copy = join(work, 'copia.tar.gpg');
podman('cp', `${first.name}:${backup}`, copy);

// A database as installations from before have it, which trusts whoever connects from inside the pod.
asUrna(first, 'podman', 'exec', '-u', 'postgres', 'urna-db', 'sh', '-c', 'sed -i -- "s/scram-sha-256$/trust/" "$PGDATA/pg_hba.conf" && kill -HUP 1');
await sleep(2_000);
const trusting = fromThePod(first);
// And a database password in .env that is not the database's, as an older installer run again on the machine leaves
// it: the server got in only because the pod was trusted.
const oldPassword = /^POSTGRES_PASSWORD=(\S+)$/m.exec(madeThere)![1]!;
const newPassword = randomBytes(24).toString('hex');
asUrna(first, 'sed', '-i', `s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=${newPassword}/`, '/opt/urna-abierta/.env');

// Updating: the next version is already on the machine, as if it had been downloaded.
podman('cp', nextFile, `${first.name}:/tmp/nuevas.tar`);
podman('exec', first.name, 'chmod', '644', '/tmp/nuevas.tar');
asUrna(first, 'podman', 'load', '-q', '-i', '/tmp/nuevas.tar');
const updated = attempt('exec', first.name, 'urna', 'actualizar', 'nueva');
record('«urna actualizar» pasa a la versión que se le pide', updated.ok && updated.said.includes('Listo: está en la versión nueva'), updated.said.split('\n'));
const env = podman('exec', first.name, 'cat', '/opt/urna-abierta/.env');
const commands = podman('exec', first.name, 'tail', '-n', '1', '/opt/urna-abierta/urna');
const migrations = asUrna(first, 'podman', 'exec', 'urna-db', 'psql', '-U', 'urna', '-tAc', 'SELECT max(version) FROM schema_migrations');
record('trae las imágenes y los comandos de esa versión, y la base se pone al día', env.includes(`URNA_IMAGE_SERVER=${next.server}`) && env.includes(`URNA_IMAGE_WEB=${next.web}`) && commands === '# versión nueva' && migrations === '9999', { commands, migrations });
const afterUpdate = api(first, 'GET', '/elections', { token }).elections;
const backupsNow = api(first, 'GET', '/backups', { token }).backups;
record('después de actualizar están los datos, siguen las sesiones y hay una copia de antes', afterUpdate?.[0]?.name === 'Simulacro' && afterUpdate[0].people === 30 && backupsNow?.length === 2, afterUpdate?.[0]);
const closedNow = fromThePod(first);
record('«urna actualizar» le pide la clave también a una base que confiaba en el pod', trusting.ok && trusting.said.trim() === '1' && !closedNow.ok && closedNow.said.includes('no password supplied'), [trusting.said.trim(), closedNow.said.trim()]);
const withNew = fromThePod(first, newPassword);
const withOld = fromThePod(first, oldPassword);
// What an older «urna» runs, after going back to an older version: inside the database's container, with no password.
const olderCopy = attempt('exec', first.name, 'sh', '-c', 'runuser -u urna -- env XDG_RUNTIME_DIR=/run/user/$(id -u urna) HOME=/opt/urna-abierta "$@"', 'sh',
  'podman', 'exec', 'urna-db', 'sh', '-c', 'unset PGPASSWORD; pg_dump -w -U urna -Fc urna | wc -c && psql -w -q -U urna -d urna -tAc "SELECT 1"');
record('la base toma la clave que dice .env, y adentro de su contenedor sigue sin pedirla, como lo necesita un «urna» anterior', withNew.ok && withNew.said.trim() === '1' && !withOld.ok && olderCopy.ok && /^\s*[1-9]\d*\s*\n1\s*$/.test(olderCopy.said), [withNew.said.trim(), withOld.said.trim(), olderCopy.said.trim()]);
const same = attempt('exec', first.name, 'urna', 'actualizar', 'nueva');
const missing = attempt('exec', first.name, 'urna', 'actualizar', 'v0.0.0-no-existe');
const unchanged = podman('exec', first.name, 'grep', '^URNA_IMAGE_SERVER=', '/opt/urna-abierta/.env');
record('si ya está en esa versión lo dice, y si la versión no existe no cambia nada', same.said.includes('Ya está en la versión nueva') && !missing.ok && missing.said.includes('No se pudo bajar la versión v0.0.0-no-existe') && unchanged === `URNA_IMAGE_SERVER=${next.server}`, missing.said.split('\n'));

// A version that changes the database and does not start. Going back is two steps, and the backup to restore is
// the one from before that update, even after going back made another one, which the older version cannot open.
podman('cp', brokenFile, `${first.name}:/tmp/rotas.tar`);
podman('exec', first.name, 'chmod', '644', '/tmp/rotas.tar');
asUrna(first, 'podman', 'load', '-q', '-i', '/tmp/rotas.tar');
const toBroken = attempt('exec', first.name, 'urna', 'actualizar', 'rota');
const copyBefore = /«urna actualizar nueva» y después «urna restaurar (\S+) TU-LLAVE-DE-RECUPERACION»/.exec(toBroken.said)?.[1];
record('si la versión nueva no arranca, dice que se vuelve con «urna actualizar» y después «urna restaurar» con la copia de antes', !toBroken.ok && Boolean(copyBefore), toBroken.said.split('\n'));
const goingBack = attempt('exec', first.name, 'urna', 'actualizar', 'nueva');
record('volver no abre la base que cambió, y vuelve a nombrar esa copia, no la que hizo al volver', !goingBack.ok && goingBack.said.includes(`«urna restaurar ${copyBefore} TU-LLAVE-DE-RECUPERACION»`) && goingBack.said.includes('no abre la base'), goingBack.said.split('\n'));
const restoredFirst = attempt('exec', first.name, 'urna', 'restaurar', copyBefore ?? '-', secrets.recoveryKey);
const afterBack = api(first, 'GET', '/elections', { token }).elections;
const backMigrations = asUrna(first, 'podman', 'exec', 'urna-db', 'psql', '-U', 'urna', '-tAc', `SELECT max(version) || ' ' || coalesce(to_regclass('prueba_rota')::text, 'sin-rota') FROM schema_migrations`);
record('con esa copia vuelve a andar la versión anterior, con sus datos y sus sesiones', restoredFirst.ok && afterBack?.[0]?.name === 'Simulacro' && afterBack[0].people === 30 && backMigrations === '9999 sin-rota' && attempt('exec', first.name, 'urna', 'estado').said.includes('versión: nueva'), { said: restoredFirst.said.split('\n'), backMigrations });

// The drill: the first server is gone, and everything has to be recovered on another one. The backup is
// uploaded the usual way, to the home of the user that connects, which the user `urna` cannot read.
const second = await machine(`${name}-2`, port + 1, port + 3);
await installOn(second, newSecrets());
podman('cp', copy, `${second.name}:/home/ubuntu/copia.tar.gpg`);
podman('exec', second.name, 'sh', '-c', 'chown ubuntu:ubuntu /home/ubuntu/copia.tar.gpg && chmod 600 /home/ubuntu/copia.tar.gpg && chmod 750 /home/ubuntu');
const asUbuntu = (...args: string[]) => attempt('exec', '--user', 'ubuntu', '-w', '/home/ubuntu', second.name, 'sudo', 'urna', 'restaurar', ...args);
const notThere = asUbuntu('no-esta.tar.gpg', secrets.recoveryKey);
const notBackup = asUbuntu('/etc/hostname', secrets.recoveryKey);
const wrongKey = asUbuntu('copia.tar.gpg', 'LLAVE-EQUIVOCADA');
record('dice si el archivo no está, si no es una copia, o si la llave es otra', !notThere.ok && notThere.said.includes('No encuentro el archivo') && !notBackup.ok && notBackup.said.includes('no es una copia de Urna Abierta') && !wrongKey.ok && wrongKey.said.includes('Esa llave no abre esta copia'), [notThere.said, notBackup.said, wrongKey.said]);
// A backup someone hands over, with the right key, made to write outside the photos: the commands of the server and
// one of its services, and a field key that runs a command once .env is read. Nothing of it may land.
const fingerprint = () => podman('exec', second.name, 'sh', '-c', 'cd /opt/urna-abierta && sha256sum urna .env .config/systemd/user/urna-copia.service && ls fotos | wc -l');
const beforeCrafted = fingerprint();
const crafted = ['x$(touch /tmp/marca-trucha-env)', 'ab'.repeat(32)].map((fieldKey, index) => {
  podman('cp', craftedBackup(secrets.recoveryKey, fieldKey), `${second.name}:/home/ubuntu/trucha-${index}.tar.gpg`);
  podman('exec', second.name, 'sh', '-c', `chown ubuntu:ubuntu /home/ubuntu/trucha-${index}.tar.gpg && chmod 600 /home/ubuntu/trucha-${index}.tar.gpg`);
  return asUbuntu(`trucha-${index}.tar.gpg`, secrets.recoveryKey);
});
const marked = attempt('exec', second.name, 'sh', '-c', 'ls /tmp/marca-trucha* /opt/urna-abierta/marca-trucha* 2>/dev/null').said.trim();
record('no restaura una copia que escribiría fuera de las fotos, y deja todo como estaba', crafted.every((each) => !each.ok && each.said.includes('no restauré nada')) && crafted[1]!.said.includes('fuera de la carpeta de las fotos') && fingerprint() === beforeCrafted && marked === '' && api(second, 'GET', '/health').ok === true, crafted.map((each) => each.said.trim()));
const restored = asUbuntu('copia.tar.gpg', secrets.recoveryKey);
record('restaura la copia desde la carpeta de quien entra, con su ruta corta', restored.ok && restored.said.includes('Copia restaurada') && restored.said.includes('URNA_S3_'), restored.said.split('\n'));
const elections = api(second, 'GET', '/elections', { token }).elections;
record('en el otro servidor está todo, y las mismas sesiones siguen valiendo', elections?.[0]?.name === 'Simulacro' && elections[0].people === 30 && elections[0].tables === 3, elections?.[0]);
const again = api(second, 'GET', `/elections/${election}/people?q=90000001`, { token }).people.find((item: { id: string }) => item.id === people[0].id);
record('las categorías sensibles se pueden leer después de restaurar', again?.category === category.id);
urna(second, 'copia');
const alone = attempt('exec', second.name, 'urna', 'estado').said;
record('sin bucket, «urna estado» avisa que las copias quedan solo en el servidor', alone.includes('Todo en orden') && alone.includes('aviso  las copias quedan solo en este servidor'), alone.split('\n'));

// A reboot: everything has to come back by itself, in the version it was updated to.
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
record('después de reiniciar la máquina vuelve sola', back && attempt('exec', first.name, 'urna', 'estado').said.includes('versión: nueva'));

finish(cleanup);
