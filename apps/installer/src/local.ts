import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { sleep } from './clouds/common.ts';
import { images, newSecrets, type Secrets } from './settings.ts';

const exec = promisify(execFile);
const PORT = Number(process.env.URNA_LOCAL_PORT ?? 8090);
/** When another program already uses the port, the next ones are tried. */
const PORTS_TO_TRY = 10;
const NAME = process.env.URNA_LOCAL_NAME ?? 'urna-local';
const TUNNEL_IMAGE = process.env.URNA_IMAGE_TUNNEL ?? 'docker.io/cloudflare/cloudflared:latest';
const S3_SETTINGS =['URNA_S3_ENDPOINT', 'URNA_S3_BUCKET', 'URNA_S3_REGION', 'URNA_S3_PREFIX', 'URNA_S3_ACCESS_KEY_ID', 'URNA_S3_SECRET_ACCESS_KEY'];

/** Podman or Docker, whichever this computer has. On a server it is always Podman; here it is up to the person. */
export async function findEngine(): Promise<string | null> {
  for (const engine of ['podman', 'docker']) {
    try {
      await exec(engine, ['info'], { timeout: 30_000 });
      return engine;
    } catch {
      // Missing, or installed and not running.
    }
  }
  return null;
}

/** Here the containers start from this computer, so it makes the keys a server would make for itself. */
type LocalSecrets = Secrets & { postgresPassword: string; fieldKey: string };

/** Trying it again keeps the same data and the same keys. */
function savedSecrets(): LocalSecrets {
  const folder = process.env.URNA_CONFIG_DIR ?? join(homedir(), '.urna-abierta');
  const file = join(folder, 'prueba-local.json');
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    const secrets = { ...newSecrets(), postgresPassword: randomBytes(24).toString('hex'), fieldKey: randomBytes(32).toString('hex') };
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
    return secrets;
  }
}

/**
 * Starts everything on this computer. It is only reachable from here, and it does not need a certificate, unless the
 * person asks for phones too.
 */
export async function startLocal(theme: string, log: (line: string) => void, phones = false): Promise<{ secrets: Secrets; url: string; phonesUrl?: string }> {
  const engine = await findEngine();
  if (!engine) throw new Error('no_engine');
  const secrets = savedSecrets();
  const chosen = images();
  const run = (...args: string[]) => exec(engine, args, { timeout: 600_000, maxBuffer: 16 * 1024 * 1024 });
  const remove = (...names: string[]) => run('rm', '-f', ...names).catch(() => undefined);

  for (const image of [chosen.db, chosen.server, chosen.web]) {
    log(`pull:${image}`);
    await run('image', 'exists', image).catch(() => run('pull', image));
  }
  await run('network', 'create', NAME).catch(() => undefined);
  await remove(`${NAME}-tunel`, `${NAME}-web`, `${NAME}-server`, `${NAME}-db`);

  log('start');
  await run('run', '-d', '--name', `${NAME}-db`, '--network', NAME, '--restart=unless-stopped', '-e', 'POSTGRES_USER=urna', '-e', 'POSTGRES_DB=urna', '-e', `POSTGRES_PASSWORD=${secrets.postgresPassword}`, '-v', `${NAME}-database:/var/lib/postgresql`, chosen.db);
  // The photos live in a volume, like the database, so that trying it again keeps them. A new
  // volume belongs to root under Docker, and the server runs as `node`.
  const photos = `${NAME}-fotos:/fotos`;
  await run('run', '--rm', '--user', '0', '-v', photos, chosen.server, 'chown', 'node', '/fotos');
  // Whoever wants to try photos in a bucket from here sets the same variables as on a server.
  const bucket = S3_SETTINGS.flatMap((name) => (process.env[name] ? ['-e', `${name}=${process.env[name]}`] : []));
  await run(
    'run', '-d', '--name', `${NAME}-server`, '--network', NAME, '--restart=unless-stopped', '-e', 'URNA_ACEPTO_RESPONSABILIDAD=si',
    '-e', `URNA_SETUP_CODE=${secrets.setupCode}`, '-e', `URNA_FIELD_KEY=${secrets.fieldKey}`, '-e', `URNA_TEMA=${theme}`,
    '-e', `DATABASE_URL=postgres://urna:${secrets.postgresPassword}@${NAME}-db:5432/urna`, '-e', 'URNA_PHOTOS_DIR=/fotos', '-v', photos, ...bucket, chosen.server,
  );
  const port = await publishWeb(run, remove, chosen.web);
  const url = `http://localhost:${port}`;
  return { secrets, url, ...(phones ? { phonesUrl: await openTunnel(run, log) } : {}) };
}

type Run = (...args: string[]) => Promise<{ stdout: string; stderr: string }>;

/**
 * The app answers on 8090 of this computer. If another program already has it, like another test of Urna Abierta,
 * it takes the next free one: the address at the end says which.
 */
async function publishWeb(run: Run, remove: (...names: string[]) => Promise<unknown>, image: string): Promise<number> {
  for (let port = PORT; ; port++) {
    try {
      await run('run', '-d', '--name', `${NAME}-web`, '--network', NAME, '--restart=unless-stopped', '-p', `127.0.0.1:${port}:80`, '-e', 'URNA_SITE=:80', '-e', `URNA_API=${NAME}-server:3000`, image);
      return port;
    } catch (error) {
      // Podman says the first, and Docker the second when the port is one of its own containers'.
      const taken = /address already in use|port is already allocated/i.test((error as Error).message);
      if (!taken || port >= PORT + PORTS_TO_TRY - 1) throw error;
      // The container was created even though it could not start.
      await remove(`${NAME}-web`);
    }
  }
}

/**
 * A phone needs an https address to keep the app without signal, and this computer has none. Cloudflare lends one
 * without an account, for as long as this computer is on: everything that goes through it, the roll included, crosses
 * Cloudflare. It does not restart on its own, because every start gets another address.
 */
async function openTunnel(run: Run, log: (line: string) => void): Promise<string> {
  log('tunnel');
  await run('image', 'exists', TUNNEL_IMAGE).catch(() => run('pull', TUNNEL_IMAGE));
  await run('run', '-d', '--name', `${NAME}-tunel`, '--network', NAME, TUNNEL_IMAGE, 'tunnel', '--no-autoupdate', '--url', `http://${NAME}-web:80`);
  for (let tries = 0; tries < 90; tries++) {
    const { stdout, stderr } = await run('logs', `${NAME}-tunel`);
    const address = `${stdout}${stderr}`.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (address) return address[0];
    await sleep(1_000);
  }
  throw new Error('no_tunnel');
}
