/**
 * The text to paste, end to end: the block exactly as the installer gives it goes in as user data on an Alpine
 * machine in a container, and tiny-cloud runs it as root on the first boot, as it does on Alpine's cloud images. Around the machine,
 * a small internet of its own, so that the block needs no change: the public address it asks for, the registries
 * its images come from, and an ACME server (Pebble) in place of Let's Encrypt. Then it opens the app at that
 * address as a browser does, checking its certificate, and asks «urna estado».
 *
 *   node apps/installer/e2e/texto.ts
 *
 * URNA_E2E_NAME and URNA_E2E_PORT (the first of two ports) let it run next to another copy.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { install } from '../src/job.ts';
import { images as installerImages } from '../src/settings.ts';
import { attempt, buildImages, finish, podman, record, sleep } from './maquinas.ts';

const work = mkdtempSync(join(tmpdir(), 'urna-texto-'));
const name = process.env.URNA_E2E_NAME ?? 'urna-texto';
const port = Number(process.env.URNA_E2E_PORT ?? 2231);
const network = `${name}-red`;
const machine = `${name}-1`;
const internet = `${name}-internet`;
// A documentation address (RFC 5737): what the machine finds out is its public one, and nobody's.
const PUBLIC_IP = '203.0.113.10';
const THEME = 'mate';
const local = { server: `localhost/${name}-server`, web: `localhost/${name}-web`, machine: `localhost/${name}-prueba`, cloud: `localhost/${name}-nube` };

// The block a person gets, with the images that are published: nothing here may name others.
for (const variable of ['URNA_IMAGE_DB', 'URNA_IMAGE_SERVER', 'URNA_IMAGE_WEB']) delete process.env[variable];
process.env.URNA_CONFIG_DIR = work;
const published = installerImages();

function cleanup(): void {
  for (const each of [machine, internet, `${name}-pebble`, `${name}-registro`]) attempt('rm', '-f', each);
  attempt('volume', 'rm', '-f', `${machine}-datos`);
  attempt('network', 'rm', network);
}

console.log('Armando las imágenes y la máquina…');
buildImages(local);
// The same machine, with tiny-cloud reading its user data from a folder, as it would from a cloud. Its containers
// will trust the certificates of the internet below, through Podman's settings.
const cloudBuild = mkdtempSync(join(work, 'nube-'));
writeFileSync(join(cloudBuild, '90-prueba.conf'), '[containers]\nenv = ["SSL_CERT_FILE=/etc/urna-prueba/ca.crt"]\nvolumes = ["/etc/urna-prueba:/etc/urna-prueba:ro"]\n');
writeFileSync(join(cloudBuild, 'Containerfile'), [
  `FROM ${local.machine}`,
  'RUN apk add -q --no-cache tiny-cloud-openrc tiny-cloud-nocloud && tiny-cloud --enable && mkdir -p /var/lib/cloud /etc/urna-prueba /usr/local/share/ca-certificates',
  'COPY 90-prueba.conf /etc/containers/containers.conf.d/',
].join('\n'));
podman('build', '-q', '-t', local.cloud, cloudBuild);

// In Spanish, as the checks below read what «urna» says.
const result = await install({ where: { kind: 'text' }, theme: THEME, vision: 'later', language: 'es' }, () => undefined);
const block = result.text ?? '';
record('el instalador da un bloque, sin dirección todavía, y su llave', block.startsWith('#!/bin/sh\n') && result.address === '' && Boolean(result.recoveryKey), { bytes: block.length });

cleanup();
podman('network', 'create', network);

// The registries: the published names point here, with this checkout's images under them.
podman('run', '-d', '--name', `${name}-registro`, '--network', network, '-p', `127.0.0.1:${port + 1}:5000`, 'docker.io/library/registry:3');
podman('pull', '-q', published.db);
const registryHosts = new Set<string>();
const serving = [[published.db, published.db], [local.server, published.server], [local.web, published.web]] as const;
for (let tries = 0; ; tries += 1) {
  if (attempt('exec', `${name}-registro`, 'wget', '-qO-', 'http://localhost:5000/v2/').ok) break;
  if (tries > 30) throw new Error('el registro no arrancó');
  await sleep(1_000);
}
for (const [from, as] of serving) {
  const [host, ...path] = as.split('/');
  // Podman asks Docker Hub at this address.
  registryHosts.add(host === 'docker.io' ? 'registry-1.docker.io' : host!);
  podman('push', '-q', '--tls-verify=false', from, `127.0.0.1:${port + 1}/${path.join('/')}`);
}

// Let's Encrypt, as Pebble, which signs without checking the address: nothing from outside reaches this machine.
podman('run', '-d', '--name', `${name}-pebble`, '--network', network, '-e', 'PEBBLE_VA_ALWAYS_VALID=1', '-e', 'PEBBLE_VA_NOSLEEP=1', '-e', 'PEBBLE_WFE_NONCEREJECT=0', 'ghcr.io/letsencrypt/pebble:latest');

// And the rest of that internet, behind one Caddy with certificates of its own, which the machine is told to trust.
const caddyfile = join(work, 'Caddyfile');
writeFileSync(caddyfile, `{
	admin off
	local_certs
	skip_install_trust
}

checkip.amazonaws.com, api.ipify.org {
	respond "${PUBLIC_IP}"
}

${[...registryHosts].join(', ')} {
	reverse_proxy ${name}-registro:5000
}

acme-v02.api.letsencrypt.org, acme-staging-v02.api.letsencrypt.org {
	rewrite /directory /dir
	reverse_proxy https://${name}-pebble:14000 {
		# Pebble writes its addresses with the name it is asked by.
		header_up Host {host}
		transport http {
			tls_insecure_skip_verify
		}
	}
}
`);
podman('create', '--name', internet, '--network', network, 'docker.io/library/caddy:2-alpine');
podman('cp', caddyfile, `${internet}:/etc/caddy/Caddyfile`);
podman('start', internet);
let authority = '';
for (let tries = 0; !authority; tries += 1) {
  authority = attempt('exec', internet, 'cat', '/data/caddy/pki/authorities/local/root.crt').said;
  if (!authority.includes('BEGIN CERTIFICATE')) authority = '';
  if (tries > 30) throw new Error('el Caddy de la internet de prueba no armó sus certificados');
  if (!authority) await sleep(1_000);
}
const internetIp = podman('inspect', '-f', `{{(index .NetworkSettings.Networks "${network}").IPAddress}}`, internet);

// The machine, created as a cloud would: the block as its user data, read on the first boot. Its names of that
// internet lead to the Caddy above, also the staging one of Let's Encrypt, which Caddy tries after a failure.
const names = ['checkip.amazonaws.com', 'api.ipify.org', 'acme-v02.api.letsencrypt.org', 'acme-staging-v02.api.letsencrypt.org', ...registryHosts];
// As in servidor.ts: /run a tmpfs, and the home of the containers a disk of its own.
podman('create', '--name', machine, '--hostname', machine, '--network', network, '--privileged', '--stop-timeout', '60', '--tmpfs', '/run', '-v', `${machine}-datos:/opt/urna-abierta`, '--device', '/dev/fuse',
  '-p', `127.0.0.1:${port}:443`, ...names.flatMap((each) => ['--add-host', `${each}:${internetIp}`]), local.cloud);
const seed = mkdtempSync(join(work, 'seed-'));
writeFileSync(join(seed, 'user-data'), block);
writeFileSync(join(seed, 'meta-data'), `instance-id: ${machine}\nlocal-hostname: ${machine}\n`);
// A cloud hands them over on a disk labeled cidata, which a container cannot have: already read, they are where
// tiny-cloud keeps them.
writeFileSync(join(seed, '.nocloud_loaded'), '');
podman('cp', `${seed}/.`, `${machine}:/var/lib/cloud/`);
// Its programs trust that internet's certificates, and so do its containers.
const bundle = join(work, 'ca-certificates.crt');
podman('cp', `${machine}:/etc/ssl/certs/ca-certificates.crt`, bundle);
writeFileSync(bundle, `${readFileSync(bundle, 'utf8').trimEnd()}\n${authority}`);
podman('cp', bundle, `${machine}:/etc/ssl/certs/ca-certificates.crt`);
const ca = join(work, 'ca.crt');
writeFileSync(ca, authority);
podman('cp', ca, `${machine}:/etc/urna-prueba/ca.crt`);
// Where Alpine rebuilds that bundle from, if installing something rebuilds it.
podman('cp', ca, `${machine}:/usr/local/share/ca-certificates/urna-prueba.crt`);
const started = Date.now();
podman('start', machine);

// tiny-cloud writes how the block ended once it is done, also when it failed.
let exit = '';
for (const until = Date.now() + 25 * 60_000; !exit && Date.now() < until; ) {
  await sleep(5_000);
  const done = attempt('exec', machine, 'cat', '/var/log/user-data.exit');
  if (done.ok) exit = done.said.trim();
}
const output = attempt('exec', machine, 'cat', '/var/log/user-data.log').said;
const said = output.split('\n').filter((line) => line.startsWith('urna-abierta: ')).map((line) => line.slice(14));
const ready = exit === '0' && said.at(-1) === `ready https://${PUBLIC_IP}` && !said.includes('waiting_system');
record('tiny-cloud corre el bloque como root en el primer arranque, sin esperarse a sí mismo, y queda listo en la dirección pública', ready, { said, salida: exit, minutos: Math.round((Date.now() - started) / 6_000) / 10 });
if (!ready) console.log(output.split('\n').slice(-40).join('\n'));

// As a browser opens it: by the bare address, which names no site, and checking the certificate it was given.
const pebbleRoot = join(work, 'pebble.pem');
writeFileSync(pebbleRoot, attempt('exec', machine, 'curl', '-sk', `https://${name}-pebble:15000/roots/0`).said);
function browser(method: string, path: string, body?: unknown): any {
  const args = ['-s', '--max-time', '30', '--cacert', pebbleRoot, '--connect-to', `${PUBLIC_IP}:443:127.0.0.1:${port}`, '-X', method, `https://${PUBLIC_IP}/api${path}`];
  if (body !== undefined) args.push('-H', 'content-type: application/json', '-d', JSON.stringify(body));
  try {
    return JSON.parse(execFileSync('curl', args, { encoding: 'utf8' }) || '{}');
  } catch (error) {
    return { error: String((error as Error).message).split('\n')[0] };
  }
}
const pub = browser('GET', '/public');
record('la app responde en esa dirección con un certificado válido para ella, y pide el primer administrador con el tema elegido', pub.setupNeeded === true && pub.party?.theme === THEME, pub);
const { token } = browser('POST', '/setup', { code: result.setupCode, name: 'Laura', accepted: true });
record('el código que mostró el instalador es el que deja entrar al primer administrador', Boolean(token));

// The install makes the first backup in the background, once the server answers: in a few seconds it is all green.
let state = '';
for (let tries = 0; tries < 10 && !state.includes('Todo en orden'); tries += 1) {
  if (tries) await sleep(3_000);
  state = attempt('exec', machine, 'urna', 'estado').said;
}
record('recién instalado, «urna estado» dice que está todo bien: responde, tiene certificado, la versión publicada y ya una copia', state.includes('Todo en orden') && state.includes('bien   el servidor responde') && state.includes('bien   certificado hasta:') && state.includes('bien   hay una copia de las últimas 7 horas') && state.includes(`bien   versión: ${published.server.split(':').at(-1)}`), state.split('\n'));

// A slow certificate, as while the cloud's firewall keeps 80 and 443 closed: Let's Encrypt is out of reach and the
// certificate is gone. Starting through the service must not wait for it, so that a slow start never holds the boot,
// and «urna estado» says what is missing. When Let's Encrypt is back, it goes on by itself.
const asUrna = (...args: string[]) => attempt('exec', machine, 'sh', '-c', 'cd / && runuser -u urna -- env XDG_RUNTIME_DIR=/run/user/$(id -u urna) HOME=/opt/urna-abierta "$@"', 'sh', ...args);
podman('pause', `${name}-pebble`);
asUrna('podman', 'rm', '-f', 'urna-web');
asUrna('podman', 'volume', 'rm', 'urna-caddy-data');
const restartFrom = Date.now();
const restarted = attempt('exec', machine, 'rc-service', 'urna-abierta', 'restart');
const restartSeconds = Math.round((Date.now() - restartFrom) / 1_000);
await sleep(20_000);
const unit = attempt('exec', machine, 'rc-service', 'urna-abierta', 'status').said.includes('started') ? 'active' : 'inactive';
const running = asUrna('podman', 'ps', '--format', '{{.Names}}').said.split('\n').filter((each) => /^urna-(db|server|web)$/.test(each)).length;
const waiting = attempt('exec', machine, 'urna', 'estado').said;
record('sin certificado, OpenRC arranca todo sin esperarlo y no frena nada, y «urna estado» dice que faltan los puertos 80 y 443',
  restarted.ok && restartSeconds < 120 && unit === 'active' && running === 3 && waiting.includes('espera el servidor responde: sin certificado') && waiting.includes('FALLA  certificado: todavía no hay') && waiting.includes('puertos 80 y 443') && !waiting.includes('podman logs'),
  { segundos: restartSeconds, unidad: unit, contenedores: running, estado: waiting.split('\n') });
podman('unpause', `${name}-pebble`);
let back: any = {};
for (const until = Date.now() + 6 * 60_000; Date.now() < until && back.setupNeeded === undefined; ) {
  await sleep(10_000);
  back = browser('GET', '/public');
}
const after = attempt('exec', machine, 'urna', 'estado').said;
record('cuando Let\'s Encrypt vuelve, llega el certificado solo y todo queda en orden', back.setupNeeded === false && after.includes('Todo en orden'), { minutos: Math.round((Date.now() - restartFrom) / 6_000) / 10, estado: after.split('\n') });

finish(() => {
  cleanup();
  rmSync(work, { recursive: true, force: true });
});
